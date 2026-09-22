/**
 * MemoryService —— ⑲ 记忆 v2：memory.* RPC（F3 wiki 浏览器 + 兼容期旧面）+ retrieveForChat
 * （memoryStage 三路注入源，spec §2）。
 *
 * 三路：① 常驻（profile 一句话档案 + relationship + timeline 最近 3 条）② 关键词（wiki 投影成
 * PackLorebook → 复用 activateLorebook）③ 向量兜底（页级向量 cosineTopK 取 2 页，排除已命中；
 * 无 embedding 静默跳过）。总预算 2500 字，按 常驻 > 关键词 > 向量 顺序截断。
 * `privacy.longTermMemory=false` → 三路全停（文件不删）。
 */
import type { Prefs } from '@openpet/protocol';
import { activateLorebook, MEMORY_QUOTAS } from '@openpet/protocol';
import type { ConversationStore } from './db/index.js';
import { cosineTopK } from './kb-search.js';
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
  now?: () => number;
}

export interface MemoryRetrieval {
  resident: string[];
  /** 命中页（关键词 ∪ 向量），已按预算截断；title 由 content 首行 `### 标题` 提供。 */
  pages: Array<{ title: string; body: string; via: 'keyword' | 'vector' }>;
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

  /** 页级向量重算（变更页；hash 未变跳过）；失败静默 = 向量过期，下次再算。 */
  async function reindexVectors(onlyPaths?: readonly string[]): Promise<void> {
    try {
      const pages = deps.wiki.pagesForIndex(cid());
      const known = new Map(deps.store.pageIndexList().map((r) => [r.path, r.hash]));
      const alive = new Set(pages.map((p) => p.path));
      for (const [p] of known)
        if (!alive.has(p) && (!onlyPaths || onlyPaths.includes(p))) deps.store.pageIndexDelete(p);
      const todo = pages.filter(
        (p) => (!onlyPaths || onlyPaths.includes(p.path)) && known.get(p.path) !== p.hash,
      );
      if (todo.length === 0) return;
      const vectors = await deps.embed(todo.map((p) => p.text.slice(0, 4000)));
      todo.forEach((p, i) => {
        const v = vectors[i];
        if (v && v.length > 0) deps.store.pageIndexUpsert(p.path, p.hash, v, now());
      });
    } catch {
      /* 未配 embedding / 网络失败：向量路静默缺席 */
    }
  }

  return {
    /** 兼容期：profile 各节行视图（只读；id = 节序号）。 */
    'memory.list': async (_p: Record<string, never>) => {
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

    /** @deprecated wiki 无 id 行；保留 RPC 面为 no-op（下批删）。 */
    'memory.delete': async (_p: { id: number }) => ({ ok: true as const }),
    /** @deprecated 由节级 `<!-- locked -->` 取代；no-op（下批删）。 */
    'memory.setPinned': async (_p: { id: number; pinned: boolean }) => ({ ok: true as const }),

    /** ⑲ 清 wiki（本角色 + 共享 user/）+ 旧 memory_fact 表 + 页向量索引。 */
    'memory.clear': async (_p: Record<string, never>) => {
      deps.wiki.clear(cid());
      deps.store.memoryClear(cid());
      for (const r of deps.store.pageIndexList()) deps.store.pageIndexDelete(r.path);
      return { ok: true as const };
    },

    'memory.tree': async (_p: Record<string, never>) => deps.wiki.tree(cid()),

    'memory.readPage': async (p: { path: string }) => {
      const raw = deps.wiki.readRaw(p.path);
      const page = raw === null ? null : deps.wiki.parsePage(p.path, raw);
      if (raw === null || !page) throw new MemoryOpError(`页面不存在或损坏：${p.path}`);
      return { raw, page };
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
      return { ok: true as const };
    },

    'memory.search': async (p: { q: string }) => ({ hits: deps.wiki.search(p.q, cid()) }),

    /** 编译器 / 迁移 / 用户保存后的向量重算入口（ipc-router 接线）。 */
    reindexVectors,

    /** memoryStage 三路注入源。history = 最近若干条消息文本（旧→新），与 loreStage 同源。 */
    async retrieveForChat(
      query: string,
      history: readonly string[] = [],
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
        ...splitEntry(h),
        via: 'keyword',
      }));
      const hitPaths = new Set(
        book.entries.filter((e) => kwHits.includes(e.content)).map((e) => e.name ?? ''),
      );
      // 路 3 向量兜底（排除已命中页；无 embedding 静默）
      let vectorN = 0;
      const index = deps.store
        .pageIndexList()
        .filter((r) => r.vector.length > 0 && !hitPaths.has(r.path));
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
              pages.push({ title: page.frontmatter.title, body: page.body, via: 'vector' });
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
    },
  };
}

export type MemoryService = ReturnType<typeof createMemoryService>;
