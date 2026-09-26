/**
 * 记忆编译器 v3（⑲ spec §3，取代 memory-extractor）：LLM 是 wiki 的编译器与维护者。
 *
 * 触发不变：每 N（8）轮 + flush（切角色/切会话/退出，60s 防抖）；杂务模型 resolveTarget；
 * 仅 'openai' adapter。输入 = 最近 16 条 + 本会话最新摘要 + 本角色 index.md + 相关页全文
 * （关键词命中 ∪ 向量 top3，≤5 页 / ≤6000 字）。输出经 MemoryOpsSchema 严格校验 →
 * wiki.applyOps（任一非法 → 整批丢弃、旧页不动）→ 变更页重算向量（异步）→ memory.changed。
 * status 记上次时间/结果/失败原因（F3 工具条 + spec §8 判据 7）。
 *
 * §4 迁移模式 compileFacts(facts)：输入是旧 memory_fact 事实列表而非对话（prompt 变体），
 * 由 memory-migrate 分批调用。
 *
 * ㉒ v3.1（spec 2026-09-24-memory-graph-design §2.1）：页面文件名 = 标题（不再发明 slug）；链接规则
 * （写 [[页面名]]，落盘前另有确定性规范化兜底）；时间规则（相对时间换算成具体日期）；口吻规则
 * （经历与「亲密度叙事」用角色第一人称，user/ 页保持中性）；set_props 示例。
 */
import type { Prefs, MemoryOp } from '@openpet/protocol';
import { activateLorebook, MEMORY_QUOTAS, MemoryOpsSchema } from '@openpet/protocol';
import type { ConversationStore } from './db/index.js';
import { cosineTopK } from './kb-search.js';
import { MemoryOpError, MemoryWiki, pagePaths } from './memory-wiki.js';
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
}

/** status 记录：㉒ merged = 撞名并入 [新标题, 并入页]（F3 状态行「合并了 N 个重复人物」）。 */
export interface CompileStatus {
  at: number;
  ok: boolean;
  ops: number;
  error?: string;
  merged?: Array<[string, string]>;
}

const RECENT_MESSAGES = 16;
const FLUSH_DEBOUNCE_MS = 60_000;
const VECTOR_TOP = 3;

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
      ? '你是角色的记忆编译器。阅读「最近对话」「会话摘要」「记忆索引」与「相关页面」，输出 0-5 个维护 markdown 记忆库的操作（JSON 数组）。'
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

export function createMemoryCompiler(deps: MemoryCompilerDeps) {
  const every = deps.turnsPerCompile ?? 8;
  const now = deps.now ?? Date.now;
  const counters = new Map<string, number>();
  const lastSession = new Map<string, string>();
  let lastFlushAt = -Infinity;
  let last: CompileStatus | null = null;

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
      const index = deps.store
        .pageIndexList()
        .filter((r) => r.vector.length > 0 && r.model === key);
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
      throw new MemoryOpError('杂务模型不可用（需 openai 兼容）');
    const res = await deps.fetchImpl(`${target.apiBase}/chat/completions`, {
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
    if (!res.ok) throw new MemoryOpError(`LLM HTTP ${res.status}`);
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
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

  async function run(cid: string, mode: 'chat' | 'migrate', user: string): Promise<CompileResult> {
    try {
      deps.wiki.ensureLayout(cid);
      const cur = deps.character();
      const ops = await callLlm(cur.id === cid ? cur : { id: cid }, mode, user);
      if (ops.length === 0) {
        last = { at: now(), ok: true, ops: 0 };
        return { ok: true, ops: 0, changed: [] };
      }
      const { changed, merged } = deps.wiki.applyOps(ops, cid);
      last = { at: now(), ok: true, ops: ops.length, ...(merged.length ? { merged } : {}) };
      if (changed.length > 0) {
        void deps.reindex?.(changed);
        deps.onChanged?.(changed);
      }
      return { ok: true, ops: ops.length, changed };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      last = { at: now(), ok: false, ops: 0, error };
      console.warn('[memory] compile failed:', error);
      return { ok: false, ops: 0, error, changed: [] };
    }
  }

  async function compileSession(cid: string, sessionId: string): Promise<CompileResult> {
    const recent = deps.store
      .recentMessages(cid, sessionId, RECENT_MESSAGES)
      .map((m) => `${m.role === 'user' ? '用户' : '助手'}: ${m.text}`)
      .join('\n');
    if (!recent) return { ok: true, ops: 0, changed: [] };
    const { summary } = deps.store.sessionSummaryGet(sessionId);
    deps.wiki.ensureLayout(cid);
    const pages = await relatedPages(cid, recent);
    const user = [
      `今天是 ${deps.wiki.today()}。`,
      `最近对话：\n${recent}`,
      `会话摘要：${summary ?? '（无）'}`,
      `记忆索引：\n${deps.wiki.readIndex(cid) || '（空）'}`,
      `相关页面：\n${pages || '（无）'}`,
    ].join('\n\n');
    return run(cid, 'chat', user);
  }

  return {
    /** chat-service 轮末（stop）钩子；fire-and-forget，永不抛。 */
    async onTurnEnd(sessionId: string): Promise<void> {
      try {
        if (!deps.getPrefs()['privacy.longTermMemory']) return;
        const cid = deps.character().id;
        lastSession.set(cid, sessionId);
        const n = (counters.get(cid) ?? 0) + 1;
        if (n < every) {
          counters.set(cid, n);
          return;
        }
        counters.set(cid, 0);
        await compileSession(cid, sessionId);
      } catch (e) {
        console.warn('[memory] compile failed:', e);
      }
    },
    /** ⑮ 收尾：当前角色有未编译的轮 → 立即编译并清零；60s 防抖（跳过时计数保留）。 */
    async flush(): Promise<void> {
      try {
        if (!deps.getPrefs()['privacy.longTermMemory']) return;
        const cid = deps.character().id;
        const sid = lastSession.get(cid);
        if ((counters.get(cid) ?? 0) <= 0 || !sid) return;
        const t = now();
        if (t - lastFlushAt < FLUSH_DEBOUNCE_MS) return;
        lastFlushAt = t;
        counters.set(cid, 0);
        await compileSession(cid, sid);
      } catch (e) {
        console.warn('[memory] flush failed:', e);
      }
    },
    /** F3「立即整理」：绕过计数与防抖；无活跃会话 → 取 prefs 里当前角色活跃会话。 */
    async compileNow(sessionId?: string): Promise<CompileResult> {
      if (!deps.getPrefs()['privacy.longTermMemory'])
        return { ok: false, ops: 0, error: '长期记忆已关闭', changed: [] };
      const cid = deps.character().id;
      const sid = sessionId ?? lastSession.get(cid) ?? deps.getPrefs()['chat.activeSessions'][cid];
      if (!sid) return { ok: false, ops: 0, error: '没有可整理的会话', changed: [] };
      counters.set(cid, 0);
      return compileSession(cid, sid);
    },
    /** §4 迁移：旧事实列表（一批 ≤40 条）→ 初始化整理。pinned 由 migrate 侧另写锁定节。 */
    async compileFacts(cid: string, facts: readonly string[]): Promise<CompileResult> {
      if (facts.length === 0) return { ok: true, ops: 0, changed: [] };
      deps.wiki.ensureLayout(cid);
      const list = facts.map((f, i) => `${i + 1}. ${f}`).join('\n');
      const pages = await relatedPages(cid, facts.join('\n'));
      const user = [
        `今天是 ${deps.wiki.today()}。`,
        `旧记忆事实列表：\n${list}`,
        `记忆索引：\n${deps.wiki.readIndex(cid) || '（空）'}`,
        `相关页面：\n${pages || '（无）'}`,
      ].join('\n\n');
      return run(cid, 'migrate', user);
    },
    status(): CompileStatus | null {
      return last;
    },
  };
}

export type MemoryCompiler = ReturnType<typeof createMemoryCompiler>;
