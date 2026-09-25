/**
 * MemoryService —— ⑲ 记忆 v2：memory.* RPC（F3 wiki 浏览器 + 兼容期旧面）+ retrieveForChat
 * （memoryStage 三路注入源，spec §2）。
 *
 * 三路：① 常驻（profile 一句话档案 + relationship + timeline 最近 3 条）② 关键词（wiki 投影成
 * PackLorebook → 复用 activateLorebook）③ 向量兜底（页级向量 cosineTopK 取 2 页，排除已命中；
 * 无 embedding 静默跳过）。总预算 2500 字，按 常驻 > 关键词 > 向量 顺序截断。
 * `privacy.longTermMemory=false` → 三路全停（文件不删）。
 *
 * ㉒：页向量带嵌入模型指纹（换模型 → 旧行不参与检索并后台单飞全量重算）；真正注入的人物 / 话题页
 * 记「被想起的痕迹」（memory_page_stats，只展示不参与排序）；memory.probe「试一句」走同一条检索链、
 * 同一个 formatMemoryBlock，但不记统计。
 */
import type { Prefs } from '@openpet/protocol';
import { activateLorebook, MEMORY_QUOTAS, memoryPageKind, toPlainText } from '@openpet/protocol';
import { formatMemoryBlock } from './context-assembler.js';
import type { ConversationStore } from './db/index.js';
import { cosineTopK } from './kb-search.js';
import { buildMemoryGraph } from './memory-graph.js';
import {
  joinSections,
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

export interface MemoryRetrieval {
  resident: string[];
  /** 命中页（关键词 ∪ 向量），已按预算截断；title 由 content 首行 `### 标题` 提供。 */
  pages: Array<{
    /** ㉒ 页路径（「试一句」高亮 /「被想起」记录）。 */
    path: string;
    title: string;
    body: string;
    via: 'keyword' | 'vector';
    /** 向量路相似度。 */
    score?: number;
  }>;
  /** trace 用。 */
  stats: { resident: number; keyword: number; vector: number; chars: number };
}

const EMPTY: MemoryRetrieval = {
  resident: [],
  pages: [],
  stats: { resident: 0, keyword: 0, vector: 0, chars: 0 },
};

function splitEntry(content: string): { title: string; body: string } {
  const nl = content.indexOf('\n');
  const head = nl < 0 ? content : content.slice(0, nl);
  const title = head.replace(/^###\s*/, '').trim();
  return { title, body: nl < 0 ? '' : content.slice(nl + 1).trim() };
}

export function createMemoryService(deps: MemoryServiceDeps) {
  const cid = (): string => deps.character().id;
  const enabled = (): boolean => Boolean(deps.getPrefs()['privacy.longTermMemory']);
  const now = deps.now ?? Date.now;
  const modelKey = (): string => deps.embedModelKey?.() ?? '';

  /**
   * 页级向量重算（变更页；hash 未变且模型指纹一致则跳过；写入带指纹）；失败静默 = 向量过期，
   * 下次再算。
   */
  async function reindexVectors(onlyPaths?: readonly string[]): Promise<void> {
    try {
      const key = modelKey();
      const pages = deps.wiki.pagesForIndex(cid());
      const known = new Map(deps.store.pageIndexList().map((r) => [r.path, r]));
      const alive = new Set(pages.map((p) => p.path));
      for (const [p] of known)
        if (!alive.has(p) && (!onlyPaths || onlyPaths.includes(p))) deps.store.pageIndexDelete(p);
      const todo = pages.filter((p) => {
        if (onlyPaths && !onlyPaths.includes(p.path)) return false;
        const k = known.get(p.path);
        return !k || k.hash !== p.hash || k.model !== key;
      });
      if (todo.length === 0) return;
      const vectors = await deps.embed(todo.map((p) => p.text.slice(0, 4000)));
      todo.forEach((p, i) => {
        const v = vectors[i];
        if (v && v.length > 0) deps.store.pageIndexUpsert(p.path, p.hash, v, now(), key);
      });
    } catch {
      /* 未配 embedding / 网络失败：向量路静默缺席 */
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

  /** 只用指纹一致的行；有不一致即触发后台重算。 */
  function freshIndex(): Array<{ path: string; vector: number[] }> {
    const key = modelKey();
    const rows = deps.store.pageIndexList().filter((r) => r.vector.length > 0);
    if (rows.some((r) => r.model !== key)) refreshStaleVectors();
    return rows.filter((r) => r.model === key);
  }

  async function retrieveForChat(
    query: string,
    history: readonly string[] = [],
    opts: { record?: boolean } = {},
  ): Promise<MemoryRetrieval> {
    if (!enabled()) return EMPTY;
    const c = cid();
    if (!deps.wiki.hasCharacter(c)) return EMPTY;
    // 路 1 常驻
    const resident = deps.wiki.residentBlocks(c);
    // 路 2 关键词（复用 activateLorebook，零新增匹配代码）
    const book = deps.wiki.projectToLorebook(c);
    const kwHits = book.entries.length ? activateLorebook(book, { history, current: query }) : [];
    const pages: MemoryRetrieval['pages'] = kwHits.map((h) => ({
      path: book.entries.find((e) => e.content === h)?.name ?? '',
      ...splitEntry(h),
      via: 'keyword',
    }));
    const hitPaths = new Set(pages.map((p) => p.path));
    // 路 3 向量兜底（排除已命中页；无 embedding 静默；只用当前嵌入模型算出的向量）
    let vectorN = 0;
    const index = freshIndex().filter((r) => !hitPaths.has(r.path));
    if (index.length > 0) {
      try {
        const qv = (await deps.embed([query]))[0];
        if (qv && qv.length > 0) {
          const top = cosineTopK(
            index.map((r) => ({ meta: r.path, vector: r.vector })),
            qv,
            MEMORY_QUOTAS.vectorPages,
          );
          for (const t of top) {
            const page = deps.wiki.readPage(t.meta);
            if (!page || !page.body.trim()) continue;
            // 固定页（profile/relationship/timeline）已在常驻路，向量兜底只补 people/topics。
            if (!t.meta.startsWith('user/people/') && !t.meta.startsWith('user/topics/'))
              continue;
            pages.push({
              path: t.meta,
              title: page.frontmatter.title,
              body: toPlainText(page.body),
              via: 'vector',
              score: t.score,
            });
            vectorN++;
          }
        }
      } catch {
        /* 向量路静默 */
      }
    }
    // 总预算：常驻 > 关键词 > 向量 顺序截断
    let budget = MEMORY_QUOTAS.injectBudgetChars;
    const outResident: string[] = [];
    for (const r of resident) {
      if (budget <= 0) break;
      outResident.push(r.slice(0, budget));
      budget -= r.length;
    }
    const outPages: MemoryRetrieval['pages'] = [];
    for (const p of pages) {
      if (budget <= 0) break;
      const cost = p.title.length + p.body.length + 5;
      outPages.push(
        cost > budget
          ? { ...p, body: p.body.slice(0, Math.max(0, budget - p.title.length - 5)) }
          : p,
      );
      budget -= cost;
    }
    // §3.1 被想起的痕迹：真正注入的人物 / 话题页（常驻三页每轮都在，不记；试一句不记）
    if (opts.record !== false) {
      const recalled = outPages
        .map((p) => p.path)
        .filter((p) => {
          const k = p ? memoryPageKind(p) : null;
          return k === 'people' || k === 'topics';
        });
      if (recalled.length) {
        try {
          deps.store.pageStatsBump(recalled, now());
        } catch {
          /* 统计是派生数据：写失败不影响聊天 */
        }
      }
    }
    const chars =
      outResident.reduce((n, r) => n + r.length, 0) +
      outPages.reduce((n, p) => n + p.title.length + p.body.length, 0);
    return {
      resident: outResident,
      pages: outPages,
      stats: {
        resident: outResident.length,
        keyword: outPages.filter((p) => p.via === 'keyword').length,
        vector: Math.min(vectorN, outPages.filter((p) => p.via === 'vector').length),
        chars,
      },
    };
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

    /** ⑲ 清 wiki（本角色 + 共享 user/）+ 旧 memory_fact 表 + 页向量索引 + ㉒ 被想起统计。 */
    'memory.clear': async () => {
      deps.wiki.clear(cid());
      deps.store.memoryClear(cid());
      for (const r of deps.store.pageIndexList()) deps.store.pageIndexDelete(r.path);
      deps.store.pageStatsClear();
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
      deps.store.pageIndexDelete(p.path);
      deps.store.pageStatsDelete(p.path);
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

    /** ㉒ §4.4 重命名：全库链接跟着改；旧路径向量行删、新路径与被改写页重算。 */
    'memory.renamePage': async (p: { path: string; title: string }) => {
      const r = deps.wiki.renamePage(p.path, p.title);
      if (r.path !== p.path) {
        deps.store.pageIndexDelete(p.path);
        deps.store.pageStatsRename(p.path, r.path);
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
        preview: formatMemoryBlock(r),
      };
    },

    /** 编译器 / 迁移 / 用户保存后的向量重算入口（ipc-router 接线）。 */
    reindexVectors,

    /** memoryStage 三路注入源。history = 最近若干条消息文本（旧→新），与 loreStage 同源。 */
    retrieveForChat,
  };
}

export type MemoryService = ReturnType<typeof createMemoryService>;
