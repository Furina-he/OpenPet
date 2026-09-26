/**
 * 记忆编译器 v3（⑲ spec §3，取代 memory-extractor）：LLM 是 wiki 的编译器与维护者。
 *
 * 杂务模型 resolveTarget；仅 'openai' adapter。输出经 MemoryOpsSchema 严格校验 → wiki.applyOps
 * （任一非法 → 整批丢弃、旧页不动）→ 变更页重算向量（异步）→ memory.changed。status 记上次
 * 时间/结果/失败原因（F3 工具条 + spec §8 判据 7）。
 *
 * §4 迁移模式 compileFacts(facts)：输入是旧 memory_fact 事实列表而非对话（prompt 变体），
 * 由 memory-migrate 分批调用。
 *
 * ㉒ v3.1（spec 2026-09-24-memory-graph-design §2.1）：页面文件名 = 标题（不再发明 slug）；链接规则
 * （写 [[页面名]]，落盘前另有确定性规范化兜底）；时间规则（相对时间换算成具体日期）；口吻规则
 * （经历与「亲密度叙事」用角色第一人称，user/ 页保持中性）；set_props 示例。
 *
 * ㉔ 记忆 v3（spec 2026-09-26-memory-v3-design §1 / §5）：进程内计数器 → 库里的进度账本
 * （memory_compile_state：水位 upto + 待重试段 pending_to，重启 / 崩溃不丢）。轮末：有待重试段且距上次
 * 尝试 ≥ 60s / 有 remember 便签 / 未整理 ≥ 2 × turnsPerCompile 条 → 整理一段（≤ 24 条，前情 ≤ 4 条只供
 * 理解）；调 LLM 前先锁段落库。失败分类：暂时类（模型不可用 / 网络 / HTTP）不计次、原段下次重试；
 * 输出类（非 JSON / schema / 护栏拒）计次，满 3 次放弃该段。全部编译（聊天 / 迁移 / 立即整理）走一条
 * 全局串行链，同一会话已在队列里不重复排队。成功后逐条写来源日志（memory_op_log）。
 */
import type { Prefs, MemoryOp } from '@openpet/protocol';
import { activateLorebook, MEMORY_QUOTAS, MemoryOpsSchema } from '@openpet/protocol';
import type { ConversationStore, MemoryNoteRow, StoredRow } from './db/index.js';
import { cosineTopK } from './kb-search.js';
import { type AppliedOp, MemoryOpError, MemoryWiki, pagePaths } from './memory-wiki.js';
import type { FetchLike } from './rerank-client.js';

export interface MemoryCompilerDeps {
  store: ConversationStore;
  wiki: MemoryWiki;
  embed: (inputs: string[]) => Promise<number[][]>;
  fetchImpl: FetchLike;
  getPrefs: () => Prefs;
  resolveTarget: () => { apiBase: string; model: string; key: string; adapter: string } | null;
  /**
   * 当前角色；㉒ name / persona（生效人设前 600 字）/ userName 只用于定经历口吻，缺省只给 id。
   */
  character: () => CompilerCharacter;
  /** ㉒ §5.4 当前嵌入目标指纹；相关页向量只用指纹一致的行。缺省 ''。 */
  embedModelKey?: () => string;
  /** 变更页向量重算（memory-service.reindexVectors）；缺省不算。 */
  reindex?: ((paths: readonly string[]) => Promise<void>) | undefined;
  /** 变更通知（broadcast 'memory.changed'）。 */
  onChanged?: ((pages: string[]) => void) | undefined;
  /** 轮末触发阈值 = 2 × turnsPerCompile 条未整理消息（缺省 8 轮 = 16 条）。 */
  turnsPerCompile?: number;
  now?: () => number;
}

export interface CompilerCharacter {
  id: string;
  /** manifest.name；缺省用 id。 */
  name?: string;
  /** 生效人设 systemPrompt（调用方已截 600 字）；空 = prompt 只给名字。 */
  persona?: string;
  /** chat.userName；空 = 回落「ta」。 */
  userName?: string;
}

/** 人设摘要上限（只定口吻，不进记忆）。 */
export const PERSONA_EXCERPT_CHARS = 600;

export interface CompileResult {
  ok: boolean;
  ops: number;
  error?: string;
  changed: string[];
  /** ㉔ 没有新对话可整理（立即整理连点不再重复整理）。 */
  idle?: boolean;
}

/** status 记录：㉒ merged = 撞名并入 [新标题, 并入页]（F3 状态行「合并了 N 个重复人物」）。 */
export interface CompileStatus {
  at: number;
  ok: boolean;
  ops: number;
  error?: string;
  merged?: Array<[string, string]>;
}

/** ㉔ 暂时类失败（杂务模型未配置 / 非 openai 兼容、网络错误、HTTP 非 2xx）：不计次，原段稍后重试。 */
export class MemoryCompileUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MemoryCompileUnavailable';
  }
}

const FLUSH_DEBOUNCE_MS = 60_000;
/** 待重试段两次尝试的最小间隔。 */
const RETRY_INTERVAL_MS = 60_000;
/** 单条消息进编译输入的上限字数。 */
const MESSAGE_CHARS = 800;
/** 一次排队最多连续整理的段数（追赶积压；剩下的下次触发接着来）。 */
const MAX_SEGMENTS_PER_RUN = 10;
const VECTOR_TOP = 3;

type Mode = 'turn' | 'flush' | 'now';
const MODE_RANK: Record<Mode, number> = { turn: 0, flush: 1, now: 2 };

function rules(who: CompilerCharacter): string {
  const pp = pagePaths(who.id);
  const name = who.name || who.id;
  const call = who.userName ? `「${who.userName}」` : '';
  return [
    '规则：',
    `- 页面：用户档案 user/profile.md（固定节：一句话档案/身份/工作学习/习惯作息/喜好厌恶/近况/杂项）；人物 user/people/<标题>.md；话题 user/topics/<标题>.md（文件名就是标题）；关系 ${pp.relationship}（固定节：称呼/约定/禁忌/亲密度叙事）；经历 ${pp.timeline}。`,
    '- upsert_section 是整节替换：先看清该节现有内容，把新旧信息合并、矛盾以最新对话为准后写出完整新节；不要丢失仍然成立的旧事实。',
    '- 节首行含 <!-- locked --> 的节是用户锁定的，不得操作。',
    '- create_page 只能建 people/topics：title 用人名或话题的原名，aliases 给 1-5 个别称（昵称/简称），tags 给 0-3 个语义标签（如 家人、同事、爱好；不要写「人物」「话题」这类类别）。「记忆索引」里已有的人物/话题（名字或别名相同也算）不要重建，改用 upsert_section（无标题页的节名是「正文」）或 set_props。',
    '- set_props 整组替换某页的 aliases / tags / summary：先看「相关页面」里的现值，合并后写出完整列表。',
    '- 链接：提到「记忆索引」里已有或本批新建的人物/话题时写 [[页面名]]（页面名 = 索引里 [[ ]] 内的文字）；用别名称呼时写 [[页面名|别名]]；经历条目里的人物/话题同样加链接；不要链接索引里没有、本批也不建的东西——值得记就建页。',
    '- 时间：对话里的相对时间（今天/明天/下周/上个月……）一律按「今天是 X」换算成具体日期再写（如今天是 2026-09-24，「下周三面试」写成「2026-09-30 面试」）；「近况」里已经过去的计划改写成结果，值得留的移入经历，其余删掉。',
    `- 口吻：经历条目（append_timeline / merge_timeline）和关系页「亲密度叙事」节用你（${name}）本人的第一人称写，「我」就是${name}，语气贴合你的人设；提到用户不写「用户」，写称呼（关系页「称呼」节里的叫法${call ? ` > ${call}` : ''} > 「ta」）。user/ 下的档案/人物/话题页所有角色共用，保持中性客观，不带任何角色口吻；关系页其余节（称呼/约定/禁忌）是条目式事实，也保持中性。`,
    '- 「用户明确要求记住」里的内容必须写进记忆（放进最合适的节或页；已记过则核对一致）。',
    `- 配额：档案总量 ≤ ${MEMORY_QUOTAS.profileChars} 字，单页 ≤ ${MEMORY_QUOTAS.pageChars} 字，经历 ≤ ${MEMORY_QUOTAS.timelineEntries} 条（超出先 merge_timeline 合并旧条目）。`,
    '- 「一句话档案」节是每轮常驻注入的精简视图（≤600 字），只写最核心的身份/职业/关系/近况。',
    '- 只记稳定、长期有用、关于用户与我们关系的事；一次性闲聊、寒暄、已记录且未变化的内容不产生操作。',
    `- 最多 ${MEMORY_QUOTAS.opsPerBatch} 个操作；同一批不要对同页同节重复操作。`,
    '- 只输出 JSON 数组本身；无需操作输出 []。',
  ].join('\n');
}

/** 口吻输入：角色名 + 人设摘要（只定口吻；无生效人设只给名字）。 */
function voice(who: CompilerCharacter): string {
  const name = who.name || who.id;
  const persona = (who.persona ?? '').trim().slice(0, PERSONA_EXCERPT_CHARS);
  return persona
    ? `你是 ${name}，下面是你的人设摘要（只用来定经历的口吻，不要把人设内容写进记忆）：\n${persona}`
    : `你是 ${name}。`;
}

export function systemPrompt(who: CompilerCharacter, mode: 'chat' | 'migrate'): string {
  const head =
    mode === 'chat'
      ? '你是角色的记忆编译器。阅读「本段新对话」（「此前对话」已整理过，只用来理解上下文）、「用户明确要求记住」「会话摘要」「记忆索引」与「相关页面」，输出 0-5 个维护 markdown 记忆库的操作（JSON 数组）。'
      : '你是角色的记忆编译器。这是一次初始化整理：把「旧记忆事实列表」整理进 markdown 记忆库（若页面已有内容则合并而非覆盖），输出 0-5 个操作（JSON 数组）。';
  const ops = [
    '操作格式：',
    '{"op":"upsert_section","page":"user/profile.md","section":"工作学习","content":"完整新节内容，提到人物写 [[王小明]]"}',
    '{"op":"append_timeline","date":"YYYY-MM-DD","text":"一条共同经历（≤200 字，第一人称）"}',
    '{"op":"create_page","kind":"people"|"topics","title":"王小明","aliases":["小王"],"tags":["同事"],"content":"页面正文"}',
    '{"op":"set_props","page":"user/people/王小明.md","aliases":["小王","王工"],"tags":["同事"],"summary":"一句话简介"}',
    '{"op":"remove_line","page":"...","section":"...","match":"要删除的行包含的文字"}',
    '{"op":"merge_timeline","before":"YYYY-MM-DD","text":"该日期前经历的合并摘要（第一人称）"}',
  ].join('\n');
  return `${head}\n${voice(who)}\n${ops}\n${rules(who)}`;
}

function formatMessages(rows: ReadonlyArray<StoredRow>): string {
  return rows
    .map((m) => `${m.role === 'user' ? '用户' : '助手'}: ${m.text.slice(0, MESSAGE_CHARS)}`)
    .join('\n');
}

interface ExecResult extends CompileResult {
  applied: AppliedOp[];
  /** 暂时类失败（不计次）。 */
  transient?: boolean;
}

export function createMemoryCompiler(deps: MemoryCompilerDeps) {
  const threshold = 2 * (deps.turnsPerCompile ?? 8);
  const now = deps.now ?? Date.now;
  const store = deps.store;
  const lastSession = new Map<string, string>();
  let lastFlushAt = -Infinity;
  let last: CompileStatus | null = null;
  let gaveUp: { at: number; messages: number; error: string } | null = null;

  // ---------- 全局串行链 ----------
  let chain: Promise<unknown> = Promise.resolve();
  function enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const p = chain.then(fn);
    chain = p.catch(() => undefined);
    return p;
  }
  /** 还没开跑的排队项：同会话再触发只升级模式（turn < flush < now），不重复排队。 */
  const queued = new Map<string, { mode: Mode; promise: Promise<CompileResult> }>();
  const keyOf = (cid: string, sid: string): string => JSON.stringify([cid, sid]);

  function schedule(cid: string, sid: string, mode: Mode): Promise<CompileResult> {
    const key = keyOf(cid, sid);
    const hit = queued.get(key);
    if (hit) {
      if (MODE_RANK[mode] > MODE_RANK[hit.mode]) hit.mode = mode;
      return hit.promise;
    }
    const entry = {
      mode,
      promise: Promise.resolve<CompileResult>({ ok: true, ops: 0, changed: [] }),
    };
    queued.set(key, entry);
    entry.promise = enqueue(async () => {
      queued.delete(key);
      return compileSession(cid, sid, entry.mode);
    });
    return entry.promise;
  }

  /** 是否该整理（在排队前与开跑时各判一次）。 */
  function due(cid: string, sid: string, mode: Mode): boolean {
    const st = store.compileStateGet(cid, sid);
    const backlog = store.messageCountAfter(cid, sid, st.upto);
    const notes = store.memoryNotes(cid, sid).length;
    if (backlog === 0 && notes === 0) return false;
    if (mode === 'now') return true;
    if (st.pendingTo !== null) return now() - (st.lastAttemptAt ?? 0) >= RETRY_INTERVAL_MS;
    return mode === 'flush' || notes > 0 || backlog >= threshold;
  }

  async function relatedPages(cid: string, probe: string): Promise<string> {
    const wiki = deps.wiki;
    const book = wiki.projectToLorebook(cid);
    const hitContents = book.entries.length
      ? activateLorebook({ ...book, tokenBudget: 8000 }, { history: [], current: probe })
      : [];
    const paths = new Set<string>(
      book.entries.filter((e) => hitContents.includes(e.content)).map((e) => e.name ?? ''),
    );
    try {
      const key = deps.embedModelKey?.() ?? '';
      const index = store.pageIndexList().filter((r) => r.vector.length > 0 && r.model === key);
      if (index.length > 0) {
        const qv = (await deps.embed([probe.slice(0, 4000)]))[0];
        if (qv && qv.length > 0)
          for (const t of cosineTopK(
            index.map((r) => ({ meta: r.path, vector: r.vector })),
            qv,
            VECTOR_TOP,
          ))
            paths.add(t.meta);
      }
    } catch {
      /* 无 embedding：只靠关键词 */
    }
    // 固定页永远在（编译器要看到全节才能整节改写）
    const pp = pagePaths(cid);
    const ordered = ['user/profile.md', pp.relationship, pp.timeline, ...paths];
    const seen = new Set<string>();
    const blocks: string[] = [];
    let chars = 0;
    for (const p of ordered) {
      if (!p || seen.has(p)) continue;
      seen.add(p);
      const raw = wiki.readRaw(p);
      if (raw === null) continue;
      const nonFixed = blocks.length - 3;
      if (nonFixed >= MEMORY_QUOTAS.compilerPages) break;
      if (chars + raw.length > MEMORY_QUOTAS.compilerPageChars && blocks.length >= 3) break;
      blocks.push(`<<< ${p}\n${raw}\n>>>`);
      chars += raw.length;
    }
    return blocks.join('\n\n');
  }

  async function callLlm(
    who: CompilerCharacter,
    mode: 'chat' | 'migrate',
    user: string,
  ): Promise<MemoryOp[]> {
    const target = deps.resolveTarget();
    if (!target || target.adapter !== 'openai')
      throw new MemoryCompileUnavailable('杂务模型不可用（需 openai 兼容）');
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await deps.fetchImpl(`${target.apiBase}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(target.key ? { authorization: `Bearer ${target.key}` } : {}),
        },
        body: JSON.stringify({
          model: target.model,
          stream: false,
          messages: [
            { role: 'system', content: systemPrompt(who, mode) },
            { role: 'user', content: user },
          ],
        }),
      });
    } catch (e) {
      throw new MemoryCompileUnavailable(`网络错误：${e instanceof Error ? e.message : String(e)}`);
    }
    if (!res.ok) throw new MemoryCompileUnavailable(`LLM HTTP ${res.status}`);
    let json: { choices?: Array<{ message?: { content?: string } }> };
    try {
      json = (await res.json()) as typeof json;
    } catch {
      throw new MemoryOpError('LLM 响应不是 JSON');
    }
    const raw = (json.choices?.[0]?.message?.content ?? '').replace(/```(?:json)?|```/g, '').trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new MemoryOpError('LLM 输出不是 JSON');
    }
    const r = MemoryOpsSchema.safeParse(parsed);
    if (!r.success) throw new MemoryOpError(`操作非法：${r.error.issues[0]?.message ?? ''}`);
    return r.data;
  }

  async function execute(cid: string, mode: 'chat' | 'migrate', user: string): Promise<ExecResult> {
    try {
      deps.wiki.ensureLayout(cid);
      const cur = deps.character();
      const ops = await callLlm(cur.id === cid ? cur : { id: cid }, mode, user);
      if (ops.length === 0) {
        last = { at: now(), ok: true, ops: 0 };
        return { ok: true, ops: 0, changed: [], applied: [] };
      }
      const { changed, merged, applied } = deps.wiki.applyOps(ops, cid);
      last = { at: now(), ok: true, ops: ops.length, ...(merged.length ? { merged } : {}) };
      if (changed.length > 0) {
        void deps.reindex?.(changed);
        deps.onChanged?.(changed);
      }
      return { ok: true, ops: ops.length, changed, applied };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      last = { at: now(), ok: false, ops: 0, error };
      console.warn('[memory] compile failed:', error);
      return {
        ok: false,
        ops: 0,
        error,
        changed: [],
        applied: [],
        ...(e instanceof MemoryCompileUnavailable ? { transient: true } : {}),
      };
    }
  }

  function writeLog(
    cid: string,
    sid: string | null,
    range: [number, number] | null,
    applied: readonly AppliedOp[],
  ): void {
    if (applied.length === 0) return;
    const at = now();
    try {
      store.opLogAdd(
        applied.map((a) => ({
          at,
          characterId: cid,
          sessionId: sid,
          msgFrom: range?.[0] ?? null,
          msgTo: range?.[1] ?? null,
          path: a.path,
          op: a.op,
          detail: a.detail || null,
        })),
      );
    } catch (e) {
      console.warn('[memory] op log failed:', e);
    }
  }

  /** 整理一段：取段 → 先锁段落库 → LLM → 按结果推进水位 / 计次 / 放弃。 */
  async function compileSegment(
    cid: string,
    sid: string,
    notes: readonly MemoryNoteRow[],
  ): Promise<ExecResult> {
    const st = store.compileStateGet(cid, sid);
    const unprocessed = store.messagesBetween(cid, sid, st.upto, Number.MAX_SAFE_INTEGER);
    const cap = Math.min(unprocessed.length, MEMORY_QUOTAS.compileSegmentMessages);
    const to = st.pendingTo ?? (cap > 0 ? unprocessed[cap - 1]!.id : st.upto);
    const segment = unprocessed.filter((m) => m.id <= to);
    store.compileStatePut(cid, sid, { pendingTo: to, lastAttemptAt: now() });

    let r: ExecResult;
    try {
      const lead =
        st.upto > 0 ? store.messagesBefore(cid, sid, st.upto, MEMORY_QUOTAS.compileLeadIn) : [];
      const segText = formatMessages(segment);
      const noteText = notes.map((n) => `- ${n.text}`).join('\n');
      const { summary } = store.sessionSummaryGet(cid, sid);
      deps.wiki.ensureLayout(cid);
      const pages = await relatedPages(cid, [segText, noteText].filter(Boolean).join('\n'));
      const user = [
        `今天是 ${deps.wiki.today()}。`,
        lead.length ? `此前对话（已整理过，只用来理解上下文）：\n${formatMessages(lead)}` : '',
        `本段新对话（整理这一段）：\n${segText || '（无）'}`,
        notes.length ? `用户明确要求记住（必须写进记忆）：\n${noteText}` : '',
        `会话摘要：${summary ?? '（无）'}`,
        `记忆索引：\n${deps.wiki.readIndex(cid) || '（空）'}`,
        `相关页面：\n${pages || '（无）'}`,
      ]
        .filter(Boolean)
        .join('\n\n');
      r = await execute(cid, 'chat', user);
    } catch (e) {
      // 拼输入时读盘失败等：与模型无关，按暂时类处理（不计次，原段稍后重试）
      const error = e instanceof Error ? e.message : String(e);
      last = { at: now(), ok: false, ops: 0, error };
      r = { ok: false, ops: 0, error, changed: [], applied: [], transient: true };
    }

    // 段在编译途中被删消息打断（重试 / 编辑重发把 pending_to 清了）→ 不推进水位，下次重整。
    const cur = store.compileStateGet(cid, sid);
    const intact = cur.pendingTo === to;
    const noteIds = notes.map((n) => n.id);
    if (r.ok) {
      store.compileStatePut(cid, sid, {
        ...(intact ? { upto: Math.max(cur.upto, to) } : {}),
        pendingTo: null,
        retries: 0,
        lastError: null,
      });
      store.memoryNotesDelete(noteIds); // 只删本次读到的；编译途中新写的便签留给下一次
      writeLog(cid, sid, [st.upto, to], r.applied);
    } else if (!intact) {
      /* 段已作废：状态已由删消息复位 */
    } else if (r.transient) {
      store.compileStatePut(cid, sid, { lastError: r.error ?? '' });
    } else {
      const retries = cur.retries + 1;
      if (retries >= MEMORY_QUOTAS.compileMaxRetries) {
        store.compileStatePut(cid, sid, { upto: to, pendingTo: null, retries: 0, lastError: null });
        store.memoryNotesDelete(noteIds); // 原话仍在对话里
        gaveUp = { at: now(), messages: segment.length, error: r.error ?? '' };
        console.warn(`[memory] gave up a segment of ${segment.length} messages:`, r.error);
      } else {
        store.compileStatePut(cid, sid, { retries, lastError: r.error ?? '' });
      }
    }
    return r;
  }

  async function compileSession(cid: string, sid: string, mode: Mode): Promise<CompileResult> {
    const total: CompileResult = { ok: true, ops: 0, changed: [] };
    let ran = 0;
    for (; ran < MAX_SEGMENTS_PER_RUN; ran++) {
      if (ran === 0) {
        if (!due(cid, sid, mode)) break;
      } else {
        // 追赶积压：剩余消息仍 ≥ 阈值（立即整理 = 剩余 > 0）→ 接着整理下一段（便签随段带上）
        const st = store.compileStateGet(cid, sid);
        const rest = store.messageCountAfter(cid, sid, st.upto);
        if (!(mode === 'now' ? rest > 0 : rest >= threshold)) break;
      }
      const r = await compileSegment(cid, sid, store.memoryNotes(cid, sid));
      total.ops += r.ops;
      total.changed.push(...r.changed.filter((p) => !total.changed.includes(p)));
      if (!r.ok) {
        total.ok = false;
        if (r.error !== undefined) total.error = r.error;
        ran++;
        break;
      }
    }
    return ran === 0 ? { ...total, idle: true } : total;
  }

  function sessionOf(cid: string, sessionId?: string): string {
    return (
      sessionId ??
      lastSession.get(cid) ??
      deps.getPrefs()['chat.activeSessions']?.[cid] ??
      'default'
    );
  }

  /** 不进记忆的轮：水位推到本会话最后一条、清待重试段（之后打开总闸也不补整理）。 */
  function skip(sessionId: string): Promise<void> {
    const cid = deps.character().id; // 同步捕获（切角色不串）
    return enqueue(async () => {
      const { lastId } = store.messageStats(cid, sessionId);
      store.compileStatePut(cid, sessionId, {
        upto: lastId,
        pendingTo: null,
        retries: 0,
        lastError: null,
      });
    }).catch((e) => console.warn('[memory] skip failed:', e));
  }

  return {
    /** chat-service 轮末（stop）钩子；fire-and-forget，永不抛。总闸关 = 推进水位跳过本轮。 */
    async onTurnEnd(sessionId: string): Promise<void> {
      try {
        if (!deps.getPrefs()['privacy.longTermMemory']) return await skip(sessionId);
        const cid = deps.character().id;
        lastSession.set(cid, sessionId);
        if (!due(cid, sessionId, 'turn')) return;
        await schedule(cid, sessionId, 'turn');
      } catch (e) {
        console.warn('[memory] compile failed:', e);
      }
    },
    /** 不进记忆的会话（IM 群聊且 im.groupIntoMemory 关）轮末：推进水位跳过。 */
    skip,
    /** ⑮ 收尾（切角色 / 切会话 / 退出）：有未整理的对话或便签 → 立即整理；60s 防抖。 */
    async flush(): Promise<void> {
      try {
        if (!deps.getPrefs()['privacy.longTermMemory']) return;
        const cid = deps.character().id; // 同步捕获：切角色时的 flush 落在旧角色上
        const sid = sessionOf(cid);
        if (!due(cid, sid, 'flush')) return;
        const t = now();
        if (t - lastFlushAt < FLUSH_DEBOUNCE_MS) return;
        lastFlushAt = t;
        await schedule(cid, sid, 'flush');
      } catch (e) {
        console.warn('[memory] flush failed:', e);
      }
    },
    /** F3「立即整理」：绕过阈值、防抖与重试间隔；没有新对话 → idle。 */
    async compileNow(sessionId?: string): Promise<CompileResult> {
      if (!deps.getPrefs()['privacy.longTermMemory'])
        return { ok: false, ops: 0, error: '长期记忆已关闭', changed: [] };
      const cid = deps.character().id;
      return schedule(cid, sessionOf(cid, sessionId), 'now');
    },
    /** §4 迁移：旧事实列表（一批 ≤40 条）→ 初始化整理。pinned 由 migrate 侧另写锁定节。 */
    compileFacts(cid: string, facts: readonly string[]): Promise<CompileResult> {
      if (facts.length === 0) return Promise.resolve({ ok: true, ops: 0, changed: [] });
      return enqueue(async () => {
        deps.wiki.ensureLayout(cid);
        const list = facts.map((f, i) => `${i + 1}. ${f}`).join('\n');
        const pages = await relatedPages(cid, facts.join('\n'));
        const user = [
          `今天是 ${deps.wiki.today()}。`,
          `旧记忆事实列表：\n${list}`,
          `记忆索引：\n${deps.wiki.readIndex(cid) || '（空）'}`,
          `相关页面：\n${pages || '（无）'}`,
        ].join('\n\n');
        const { applied, transient: _t, ...r } = await execute(cid, 'migrate', user);
        if (r.ok) writeLog(cid, null, null, applied);
        return r;
      });
    },
    status(): CompileStatus | null {
      return last;
    },
    /** ㉔ F3 状态行：未整理消息数 / 待重试段失败次数 / 上次失败原因；无积压且无错误 = null。 */
    backlog(
      cid: string,
      sid: string,
    ): { messages: number; retries: number; error?: string } | null {
      const st = store.compileStateGet(cid, sid);
      const messages = store.messageCountAfter(cid, sid, st.upto);
      if (messages === 0 && !st.lastError) return null;
      return { messages, retries: st.retries, ...(st.lastError ? { error: st.lastError } : {}) };
    },
    /** ㉔ 最近一次放弃的段（进程内）。 */
    gaveUp(): { at: number; messages: number; error: string } | null {
      return gaveUp;
    },
    /** ㉔ 状态行用的「当前会话」：最近整理过的 → 活跃会话指针 → 'default'。 */
    sessionOf,
  };
}

export type MemoryCompiler = ReturnType<typeof createMemoryCompiler>;
