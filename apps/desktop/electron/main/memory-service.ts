/**
 * MemoryService —— ⑲ 记忆 v2：memory.* RPC（F3 wiki 浏览器 + 兼容期旧面）+ retrieveForChat
 * （memoryStage 注入源，spec §2）。
 *
 * ㉔ 记忆 v3（spec 2026-09-26-memory-v3-design §3）三路：① 常驻（profile 一句话档案 + relationship +
 * timeline 最近 3 条，不变）② 名字（wiki 投影成 PackLorebook → 复用 activateLorebook：人物 / 话题的
 * 标题、别名、文件名出现在最近 4 条 + 当前输入里 → 整页）③ 块混合（取代 ⑲ 的页向量兜底）：候选 = 全部
 * 块（档案各节 / 人物话题页 / 更早的经历）减去名字路已命中的页；BM25（只用当前输入）+ 块向量（相似度门 =
 * max(最低分, 中位数 + 0.12)）→ RRF × 新近度 → 前 3 个单元（更早的经历合并成一个单元）。总预算 2500 字，
 * 按 常驻 > 名字 > 块混合 截断。`privacy.longTermMemory=false` → 全停（文件不删）。
 *
 * 块向量带嵌入模型指纹（换模型 → 旧行不参与检索并后台单飞全量重算）；每批 10 条逐批落库；未配置嵌入
 * 模型直接跳过；删行只删当前角色可见范围（user/* + characters/<cid>/*）。真正注入的人物 / 话题页记
 * 「被想起的痕迹」（只展示不参与排序）；memory.probe「试一句」走同一条检索链、同一个记忆块渲染，
 * 不记统计。recall() = recall_memory 工具的执行体；relatedPagePaths() = 编译器相关页。
 */
import type { MemoryRecallVia, Prefs } from '@openpet/protocol';
import { activateLorebook, MEMORY_QUOTAS, memoryPageKind } from '@openpet/protocol';
import { formatMemoryPreview } from './context-assembler.js';
import type { ConversationStore } from './db/index.js';
import { cosineSim } from './kb-search.js';
import { buildMemoryGraph } from './memory-graph.js';
import {
  createBm25,
  hasTerms,
  recencyBoost,
  rrfFuse,
  tokenize,
  vectorGate,
  type Bm25Index,
} from './memory-rank.js';
import {
  joinSections,
  type MemoryChunk,
  MemoryOpError,
  MemoryWiki,
  PROFILE_PATH,
  splitSections,
} from './memory-wiki.js';

export interface MemoryServiceDeps {
  store: ConversationStore;
  wiki: MemoryWiki;
  embed: (inputs: string[]) => Promise<number[][]>;
  getPrefs: () => Prefs;
  character: () => { id: string };
  /** ㉒ 图谱可读名：cid → 角色名（查不到回 cid）。 */
  characterName?: (cid: string) => string;
  /** ㉒ 重命名等多页变更后的通知（broadcast 'memory.changed'）。 */
  onChanged?: (pages: string[]) => void;
  /** ㉒ §5.4 当前嵌入目标指纹 `sourceId|model`（未配置 = ''）；缺省 ''。 */
  embedModelKey?: () => string;
  now?: () => number;
}

/** 一个注入单元：人物 / 话题整页、档案一节、或合并后的「更早的经历」。 */
export interface MemoryUnit {
  /** 页路径（「试一句」高亮 /「被想起」记录）；同一页可出多个单元（档案不同节）。 */
  path: string;
  title: string;
  body: string;
  via: MemoryRecallVia;
  /** 向量路相似度（中了向量路才有）。 */
  score?: number;
}

export interface MemoryRetrieval {
  resident: string[];
  /** 命中单元（名字 ∪ 块混合），已按预算截断。 */
  pages: MemoryUnit[];
  /** trace 用。 */
  stats: {
    resident: number;
    keyword: number;
    text: number;
    vector: number;
    hybrid: number;
    chars: number;
  };
}

const EMPTY: MemoryRetrieval = {
  resident: [],
  pages: [],
  stats: { resident: 0, keyword: 0, text: 0, vector: 0, hybrid: 0, chars: 0 },
};

/** 块向量重算每批条数（DashScope 等单次上限 10）。 */
const EMBED_BATCH = 10;
/** BM25 候选下限：得分 ≥ 最高分 × 该比例。 */
const TEXT_REL_FLOOR = 0.25;
/** 合并的「更早的经历」单元最多带几条。 */
const TIMELINE_UNIT_ENTRIES = 5;
export const TIMELINE_UNIT_TITLE = '更早的经历（我记下的）';

function splitEntry(content: string): { title: string; body: string } {
  const nl = content.indexOf('\n');
  const head = nl < 0 ? content : content.slice(0, nl);
  const title = head.replace(/^###\s*/, '').trim();
  return { title, body: nl < 0 ? '' : content.slice(nl + 1).trim() };
}

const isPeopleOrTopic = (p: string): boolean => {
  const k = p ? memoryPageKind(p) : null;
  return k === 'people' || k === 'topics';
};

interface RankedChunk {
  chunk: MemoryChunk;
  via: 'text' | 'vector' | 'hybrid';
  score: number;
  /** 余弦相似度（中了向量路才有）。 */
  sim?: number;
}

export function createMemoryService(deps: MemoryServiceDeps) {
  const cid = (): string => deps.character().id;
  const enabled = (): boolean => Boolean(deps.getPrefs()['privacy.longTermMemory']);
  const now = deps.now ?? Date.now;
  const modelKey = (): string => deps.embedModelKey?.() ?? '';

  /**
   * 块级向量重算（hash 变 / 指纹变 / 缺失才嵌；每批 10 条逐批落库）；未配置嵌入模型直接跳过；
   * onlyPaths = 只看这些页的块。失败静默 = 向量过期，下次再算。
   */
  async function reindexVectors(onlyPaths?: readonly string[]): Promise<void> {
    try {
      const key = modelKey();
      if (!key) return;
      const c = cid();
      const chunks = deps.wiki.chunks(c);
      const inScope = (p: string): boolean => !onlyPaths || onlyPaths.includes(p);
      const visible = (p: string): boolean =>
        p.startsWith('user/') || p.startsWith(`characters/${c}/`);
      const known = new Map(deps.store.chunkIndexList().map((r) => [r.id, r]));
      const alive = new Set(chunks.map((ch) => ch.id));
      const dead = [...known.values()]
        .filter((r) => visible(r.path) && inScope(r.path) && !alive.has(r.id))
        .map((r) => r.id);
      if (dead.length) deps.store.chunkIndexDelete(dead);
      const todo = chunks.filter((ch) => {
        if (!inScope(ch.path)) return false;
        const k = known.get(ch.id);
        return !k || k.hash !== ch.hash || k.model !== key || k.vector.length === 0;
      });
      for (let i = 0; i < todo.length; i += EMBED_BATCH) {
        const batch = todo.slice(i, i + EMBED_BATCH);
        const vectors = await deps.embed(batch.map((ch) => ch.indexText.slice(0, 4000)));
        const rows = batch.flatMap((ch, j) => {
          const v = vectors[j];
          return v && v.length > 0
            ? [{ id: ch.id, path: ch.path, hash: ch.hash, model: key, vector: v }]
            : [];
        });
        if (rows.length) deps.store.chunkIndexUpsert(rows, now());
      }
    } catch {
      /* 未配 embedding / 网络失败：向量路静默缺席，已落库的批次保留 */
    }
  }

  /** §5.4 发现指纹不一致的行 → 后台全量重算（同一时刻只跑一个；失败下次检索再触发）。 */
  let fullReindex: Promise<void> | null = null;
  function refreshStaleVectors(): void {
    if (fullReindex) return;
    fullReindex = reindexVectors().finally(() => {
      fullReindex = null;
    });
  }

  /** BM25 索引按块 hash 缓存（块没变不重新分词）。 */
  let bmCache: { key: string; index: Bm25Index } | null = null;
  function bm25For(chunks: readonly MemoryChunk[]): Bm25Index {
    const key = chunks.map((c) => `${c.id}:${c.hash}`).join('|');
    if (bmCache?.key !== key)
      bmCache = { key, index: createBm25(chunks.map((c) => ({ id: c.id, text: c.indexText }))) };
    return bmCache.index;
  }

  /**
   * 块混合排名：BM25（得分 ≥ 最高分 × 0.25 的前 20）+ 向量（过相似度门的前 20；gate=false 不设门）
   * → RRF × 新近度。exclude = 名字路已命中的页。查询分不出实词 → 不检索。
   */
  async function rankChunks(
    c: string,
    query: string,
    exclude: ReadonlySet<string>,
    opts: { gate: boolean },
  ): Promise<RankedChunk[]> {
    if (!hasTerms(tokenize(query))) return [];
    const all = deps.wiki.chunks(c);
    if (all.length === 0) return [];
    const byId = new Map(all.map((ch) => [ch.id, ch]));
    const allowed = (id: string): boolean => !exclude.has(byId.get(id)?.path ?? '');
    const cap = MEMORY_QUOTAS.recallCandidates;

    const textHits = bm25For(all)
      .search(query)
      .filter((h) => allowed(h.id));
    const top = textHits[0]?.score ?? 0;
    const textIds = textHits
      .filter((h) => h.score >= top * TEXT_REL_FLOOR)
      .slice(0, cap)
      .map((h) => h.id);

    const sims = new Map<string, number>();
    let vecIds: string[] = [];
    try {
      const key = modelKey();
      const rows = deps.store.chunkIndexList().filter((r) => r.vector.length > 0);
      if (rows.some((r) => r.model !== key)) refreshStaleVectors();
      const fresh = rows.filter((r) => r.model === key && byId.get(r.id)?.hash === r.hash);
      if (key && fresh.length > 0) {
        const qv = (await deps.embed([query]))[0];
        if (qv && qv.length > 0) {
          const scored = fresh.map((r) => ({ id: r.id, sim: cosineSim(qv, r.vector) }));
          const gate = opts.gate
            ? vectorGate(
                scored.map((s) => s.sim),
                deps.getPrefs()['memory.recallMinScore'] ?? 0.25,
              )
            : -Infinity;
          vecIds = scored
            .filter((s) => s.sim >= gate && allowed(s.id))
            .sort((a, b) => b.sim - a.sim)
            .slice(0, cap)
            .map((s) => {
              sims.set(s.id, s.sim);
              return s.id;
            });
        }
      }
    } catch {
      /* 向量路静默：只剩 BM25 */
    }

    const inText = new Set(textIds);
    const today = deps.wiki.today();
    return rrfFuse([textIds, vecIds])
      .map(({ id, score }): RankedChunk => {
        const chunk = byId.get(id)!;
        const sim = sims.get(id);
        const via = sim !== undefined ? (inText.has(id) ? 'hybrid' : 'vector') : 'text';
        return {
          chunk,
          via,
          score: score * recencyBoost(chunk.date, today),
          ...(sim !== undefined ? { sim } : {}),
        };
      })
      .sort((a, b) => b.score - a.score);
  }

  /** 排名 → 单元：人物 / 话题 / 档案节各一个；更早的经历合并成一个（按日期新→旧）。 */
  function toUnits(ranked: readonly RankedChunk[], maxUnits: number): MemoryUnit[] {
    const units: MemoryUnit[] = [];
    let tl: { unit: MemoryUnit; entries: RankedChunk[] } | null = null;
    for (const r of ranked) {
      if (r.chunk.kind === 'timeline') {
        if (!tl) {
          if (units.length >= maxUnits) continue;
          tl = {
            unit: { path: r.chunk.path, title: TIMELINE_UNIT_TITLE, body: '', via: r.via },
            entries: [],
          };
          units.push(tl.unit);
        }
        if (tl.entries.length < TIMELINE_UNIT_ENTRIES) tl.entries.push(r);
        continue;
      }
      if (units.length >= maxUnits) continue;
      units.push({
        path: r.chunk.path,
        title: r.chunk.label,
        body: r.chunk.text,
        via: r.via,
        ...(r.sim !== undefined ? { score: r.sim } : {}),
      });
    }
    if (tl) {
      const entries = [...tl.entries].sort((a, b) =>
        a.chunk.date < b.chunk.date ? 1 : a.chunk.date > b.chunk.date ? -1 : 0,
      );
      tl.unit.body = entries.map((e) => `- ${e.chunk.date} ${e.chunk.text}`).join('\n');
      const vias = new Set(entries.map((e) => e.via));
      tl.unit.via = vias.size > 1 || vias.has('hybrid') ? 'hybrid' : entries[0]!.via;
      const sims = entries.flatMap((e) => (e.sim !== undefined ? [e.sim] : []));
      if (sims.length) tl.unit.score = Math.max(...sims);
    }
    return units;
  }

  /** 名字路：人物 / 话题的标题、别名、文件名出现在 history + 当前输入里 → 整页。 */
  function nameRoute(c: string, query: string, history: readonly string[]): MemoryUnit[] {
    const book = deps.wiki.projectToLorebook(c);
    if (!book.entries.length) return [];
    return activateLorebook(book, { history, current: query }).map((h) => ({
      path: book.entries.find((e) => e.content === h)?.name ?? '',
      ...splitEntry(h),
      via: 'keyword' as const,
    }));
  }

  /** 预算内截断（按顺序，超出的最后一个单元截断正文）。 */
  function fit(units: readonly MemoryUnit[], budget: number): MemoryUnit[] {
    const out: MemoryUnit[] = [];
    for (const p of units) {
      if (budget <= 0) break;
      const cost = p.title.length + p.body.length + 5;
      out.push(
        cost > budget
          ? { ...p, body: p.body.slice(0, Math.max(0, budget - p.title.length - 5)) }
          : p,
      );
      budget -= cost;
    }
    return out;
  }

  /** §3.1 被想起的痕迹：真正注入 / 返回的人物 / 话题页（常驻页不记）。 */
  function recordRecall(units: readonly MemoryUnit[]): void {
    const recalled = [...new Set(units.map((p) => p.path).filter(isPeopleOrTopic))];
    if (!recalled.length) return;
    try {
      deps.store.pageStatsBump(recalled, now());
    } catch {
      /* 统计是派生数据：写失败不影响聊天 */
    }
  }

  async function retrieveForChat(
    query: string,
    history: readonly string[] = [],
    opts: { record?: boolean } = {},
  ): Promise<MemoryRetrieval> {
    if (!enabled()) return EMPTY;
    const c = cid();
    if (!deps.wiki.hasCharacter(c)) return EMPTY;
    const resident = deps.wiki.residentBlocks(c);
    const named = nameRoute(c, query, history);
    const ranked = await rankChunks(c, query, new Set(named.map((p) => p.path)), { gate: true });
    const blocks = toUnits(ranked, MEMORY_QUOTAS.recallUnits);
    // 总预算：常驻 > 名字 > 块混合 顺序截断
    let budget = MEMORY_QUOTAS.injectBudgetChars;
    const outResident: string[] = [];
    for (const r of resident) {
      if (budget <= 0) break;
      outResident.push(r.slice(0, budget));
      budget -= r.length;
    }
    const outPages = fit([...named, ...blocks], budget);
    if (opts.record !== false) recordRecall(outPages);
    const chars =
      outResident.reduce((n, r) => n + r.length, 0) +
      outPages.reduce((n, p) => n + p.title.length + p.body.length, 0);
    const count = (v: MemoryRecallVia): number => outPages.filter((p) => p.via === v).length;
    return {
      resident: outResident,
      pages: outPages,
      stats: {
        resident: outResident.length,
        keyword: count('keyword'),
        text: count('text'),
        vector: count('vector'),
        hybrid: count('hybrid'),
        chars,
      },
    };
  }

  /**
   * ㉔ 主动回想（recall_memory 工具）：query 只用参数、不带历史；名字路 + 块混合，单元上限 units、
   * 总字数 ≤ chars；常驻内容不在块里（天然排除）。record = 真正返回的人物 / 话题页记「被想起」。
   */
  async function recall(
    query: string,
    opts: { units?: number; chars?: number; record?: boolean } = {},
  ): Promise<MemoryUnit[]> {
    if (!enabled()) return [];
    const c = cid();
    if (!deps.wiki.hasCharacter(c)) return [];
    const maxUnits = opts.units ?? MEMORY_QUOTAS.toolRecallUnits;
    const named = nameRoute(c, query, []).slice(0, maxUnits);
    const ranked = await rankChunks(c, query, new Set(named.map((p) => p.path)), { gate: true });
    const units = fit(
      [...named, ...toUnits(ranked, maxUnits - named.length)],
      opts.chars ?? MEMORY_QUOTAS.toolRecallChars,
    ).filter((u) => u.body.trim());
    if (opts.record) recordRecall(units);
    return units;
  }

  /**
   * ㉔ §3.4 编译器相关页：块混合排名映射回人物 / 话题页（不设相似度门——编译器宁多看不漏）。
   * 名字路由编译器自己跑（查询 = 本段对话）。
   */
  async function relatedPagePaths(c: string, probe: string): Promise<string[]> {
    const ranked = await rankChunks(c, probe, new Set(), { gate: false });
    return [...new Set(ranked.map((r) => r.chunk.path).filter(isPeopleOrTopic))];
  }

  return {
    /** 兼容期：profile 各节行视图（只读；id = 节序号）。 */
    'memory.list': async () => {
      const page = deps.wiki.readPage(PROFILE_PATH);
      if (!page) return { facts: [] };
      const ts = Date.parse(page.frontmatter.updated) || now();
      const facts = splitSections(page.body)
        .sections.filter((s) => s.body.trim())
        .map((s, i) => ({
          id: i + 1,
          text: `${s.name}：${s.body.replace(/<!-- locked -->\s*/g, '').trim()}`,
          pinned: s.body.trimStart().startsWith('<!-- locked -->'),
          createdAt: ts,
          updatedAt: null,
        }));
      return { facts };
    },

    /** 兼容期：写 profile「杂项」节末尾一行（source:user）。 */
    'memory.add': async (p: { text: string }) => {
      deps.wiki.ensureLayout(cid());
      const page = deps.wiki.readPage(PROFILE_PATH);
      if (!page) throw new MemoryOpError('profile 缺失');
      const parsed = splitSections(page.body);
      const misc = parsed.sections.find((s) => s.name === '杂项');
      if (!misc) throw new MemoryOpError('profile 缺「杂项」节');
      misc.body = `${misc.body}\n- ${p.text.trim()}`.trim();
      deps.wiki.writePage({
        ...page,
        frontmatter: { ...page.frontmatter, source: 'user', updated: deps.wiki.today() },
        body: joinSections(parsed),
      });
      void reindexVectors([PROFILE_PATH]);
      return { ok: true as const, id: parsed.sections.indexOf(misc) + 1 };
    },

    /**
     * ⑲ 清 wiki（本角色 + 共享 user/）+ 旧 memory_fact 表 + 块向量索引 + ㉒ 被想起统计 +
     * ㉔ remember 便签与来源日志。
     */
    'memory.clear': async () => {
      deps.wiki.clear(cid());
      deps.store.memoryClear(cid());
      deps.store.chunkIndexClear();
      deps.store.pageStatsClear();
      deps.store.memoryNotesClear();
      deps.store.opLogClear();
      return { ok: true as const };
    },

    'memory.tree': async () => deps.wiki.tree(cid()),

    /** page = null：文件在但 frontmatter 损坏（如在 Obsidian 里改坏）→ 编辑器照样拿 raw 修复。 */
    'memory.readPage': async (p: { path: string }) => {
      const raw = deps.wiki.readRaw(p.path);
      if (raw === null) throw new MemoryOpError(`页面不存在：${p.path}`);
      return { raw, page: deps.wiki.parsePage(p.path, raw) };
    },

    'memory.writePage': async (p: { path: string; content: string }) => {
      if (p.path.startsWith('characters/') && !p.path.startsWith(`characters/${cid()}/`))
        throw new MemoryOpError('不可写其他角色页面');
      deps.wiki.writeRaw(p.path, p.content);
      void reindexVectors([p.path]);
      return { ok: true as const };
    },

    'memory.deletePage': async (p: { path: string }) => {
      if (p.path.startsWith('characters/') && !p.path.startsWith(`characters/${cid()}/`))
        throw new MemoryOpError('不可删其他角色页面');
      deps.wiki.deletePage(p.path, cid());
      deps.store.chunkIndexDeletePath(p.path);
      deps.store.pageStatsDelete(p.path);
      deps.store.opLogDeletePath(p.path); // ㉔ 删页 / 固定页重置：来源随之作废
      return { ok: true as const };
    },

    'memory.search': async (p: { q: string }) => ({ hits: deps.wiki.search(p.q, cid()) }),

    /** ㉒ §3 图谱：全库链接的实时投影（current = 共享 user/ + 本角色；all 另含他角色只读页）。 */
    'memory.graph': async (p: { scope: 'current' | 'all' }) => {
      deps.wiki.ensureLayout(cid());
      return buildMemoryGraph(deps.wiki.listAllPages(), {
        scope: p.scope,
        currentCid: cid(),
        characterName: deps.characterName ?? ((c) => c),
        recall: new Map(
          deps.store
            .pageStatsList()
            .map((r) => [r.path, { count: r.count, lastAt: r.lastAt ?? 0 }] as const),
        ),
      });
    },

    /** ㉒ §4.4 重命名：全库链接跟着改；旧路径块向量删、新路径与被改写页重算。 */
    'memory.renamePage': async (p: { path: string; title: string }) => {
      const r = deps.wiki.renamePage(p.path, p.title);
      if (r.path !== p.path) {
        deps.store.chunkIndexDeletePath(p.path);
        deps.store.pageStatsRename(p.path, r.path);
        deps.store.opLogRenamePath(p.path, r.path);
      }
      void reindexVectors([r.path, ...r.changed]);
      deps.onChanged?.([r.path, ...r.changed]);
      return { ok: true as const, path: r.path };
    },

    /** ㉒ §4.6「试一句」：与聊天同一条检索链 + 同一个记忆块渲染；不记被想起统计。 */
    'memory.probe': async (p: { text: string }) => {
      const r = await retrieveForChat(p.text, [], { record: false });
      return {
        resident: r.resident.map((b) => ({
          title: (b.split('\n')[0] ?? '').replace(/^###\s*/, '').trim(),
          chars: b.length,
        })),
        pages: r.pages.map((x) => ({
          path: x.path,
          title: x.title,
          via: x.via,
          ...(x.score !== undefined ? { score: x.score } : {}),
          chars: x.title.length + x.body.length,
        })),
        injectedChars: r.stats.chars,
        budget: MEMORY_QUOTAS.injectBudgetChars,
        // ㉔ 按当前布局拼（开 = 常驻块 + 相关记忆块；关 = 旧合并块）：所见即所注入
        preview: formatMemoryPreview(r, Boolean(deps.getPrefs()['chat.cacheFriendlyContext'])),
      };
    },

    /** 编译器 / 迁移 / 用户保存 / 启动与切角色后的块向量重算入口（ipc-router 接线）。 */
    reindexVectors,

    /** memoryStage 注入源。history = 最近若干条消息文本（旧→新），与 loreStage 同源。 */
    retrieveForChat,

    /** ㉔ recall_memory 工具的执行体。 */
    recall,

    /** ㉔ 编译器相关页（块混合排名映射回人物 / 话题页，无门）。 */
    relatedPagePaths,
  };
}

export type MemoryService = ReturnType<typeof createMemoryService>;
