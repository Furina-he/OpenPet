/**
 * KbService —— kb.* RPC（§5 知识库 / 自动 RAG）。镜像 mcp-service/provider-service：
 * KB 元数据 CRUD 落 prefs `kb.list`；文档/分块实体 + 向量进 SQLite（经 ConversationStore）。
 *
 * 摄入编排：renderer 读文件文本 → chunkText → embed(分块) → store.kbInsertChunks → 回写 count。
 * 自动 RAG：retrieveForChat(query) 在 active KB 且总开关开时 embed(query) → 合并余弦 top-k；
 * 供 chat-service 注入 system prompt（片段不进气泡/不喂 behavior-parser，见 §7 桌宠核心边界）。
 *
 * embed 注入 = ProviderHost.embed 绑定 KB 的 embedding target（ipc-router 解析后注入）；
 * 未配 embedding 模型 → embed 抛错，被 chat-service 兜底跳过（不阻断对话）。
 */
import { KbSchema, type Kb, type KbHit, type PrefKey, type Prefs } from '@openpet/protocol';
import { randomUUID } from 'node:crypto';
import type { ConversationStore } from './db/index.js';
import { chunkText } from './kb-chunk.js';
import { cosineTopK } from './kb-search.js';

export interface KbServiceDeps {
  store: ConversationStore;
  /** 批量 embed（绑定 KB 的 embedding target；ipc-router 注入）。 */
  embed: (inputs: string[]) => Promise<number[][]>;
  getPrefs: () => Prefs;
  setPref: <K extends PrefKey>(key: K, value: Prefs[K]) => void;
  /** rerank 重排（返回重排下标或 null=回退）；ipc-router 解析默认 rerank 模型后注入。 */
  rerank?: (query: string, documents: string[], topN: number) => Promise<number[] | null>;
}

export function createKbService(deps: KbServiceDeps) {
  const kbs = (): Kb[] => deps.getPrefs()['kb.list'];
  const write = (next: Kb[]): void => deps.setPref('kb.list', next);
  const find = (id: string): Kb | undefined => kbs().find((k) => k.id === id);

  // arch-evolution #5：内存分块缓存（Map<kbId, rows>），摄入/删除精确失效——检索
  // 不再每次全量拉库。量级：MVP 单机 KB 全量常驻内存可承受（与 kb-search 全量扫描同假设）。
  type ChunkRow = ReturnType<ConversationStore['kbChunks']>[number];
  const chunkCache = new Map<string, ChunkRow[]>();
  const cachedChunks = (kbIds: string[]): ChunkRow[] => {
    const out: ChunkRow[] = [];
    for (const id of kbIds) {
      let rows = chunkCache.get(id);
      if (!rows) {
        rows = deps.store.kbChunks([id]);
        chunkCache.set(id, rows);
      }
      out.push(...rows);
    }
    return out;
  };
  const invalidate = (kbId: string): void => {
    chunkCache.delete(kbId);
  };

  async function search(kbIds: string[], query: string, topK: number): Promise<KbHit[]> {
    const rows = cachedChunks(kbIds);
    if (rows.length === 0) return [];
    const [qv] = await deps.embed([query]);
    if (!qv) return [];
    // KB 任一开 rerank 且注入了 rerank fn → 余弦先取宽候选再重排；失败回退余弦序。
    const wantRerank = kbIds.some((id) => find(id)?.rerank) && deps.rerank;
    const candidateK = wantRerank ? Math.min(topK * 4, 40) : topK;
    let hits = cosineTopK(
      rows.map((r) => ({ meta: r, vector: r.vector })),
      qv,
      candidateK,
    ).map((s) => ({ kbId: s.meta.kbId, docId: s.meta.docId, text: s.meta.text, score: s.score }));
    if (wantRerank && hits.length > 1) {
      const order = await deps.rerank!(
        query,
        hits.map((h) => h.text),
        topK,
      );
      if (order) hits = order.map((i) => hits[i]!).filter(Boolean);
    }
    return hits.slice(0, topK);
  }

  // 摄入内部方法（kb.addDocument 与 kb.importFile 共用）：chunk → embed → 入库 → 计数回写 → 失效。
  async function ingest(
    kbId: string,
    filename: string,
    text: string,
  ): Promise<{ ok: true; docId: string; chunks: number }> {
    const kb = find(kbId);
    if (!kb) throw new Error('kb not found');
    const chunks = chunkText(text, kb.chunkSize, kb.chunkOverlap);
    if (chunks.length === 0) return { ok: true as const, docId: '', chunks: 0 };
    const vectors = await deps.embed(chunks); // 经 KB 的 embedding 模型（注入时已绑定）
    const docId = randomUUID();
    deps.store.kbInsertChunks(
      kbId,
      docId,
      filename,
      chunks.map((text, ord) => ({ ord, text, vector: vectors[ord] ?? [] })),
    );
    invalidate(kbId);
    write(
      kbs().map((k) =>
        k.id === kbId
          ? { ...k, docCount: k.docCount + 1, chunkCount: k.chunkCount + chunks.length }
          : k,
      ),
    );
    return { ok: true as const, docId, chunks: chunks.length };
  }

  return {
    'kb.list': async (_p: Record<string, never>) => ({ kbs: kbs() }),

    'kb.create': async (p: { name: string; emoji?: string; embeddingModelId?: string }) => {
      const kb = KbSchema.parse({
        id: randomUUID(),
        name: p.name,
        ...(p.emoji ? { emoji: p.emoji } : {}),
        ...(p.embeddingModelId ? { embeddingModelId: p.embeddingModelId } : {}),
      });
      write([...kbs(), kb]);
      return { ok: true as const, id: kb.id };
    },

    'kb.update': async (p: { kb: Kb }) => {
      const next = KbSchema.parse(p.kb);
      write(kbs().map((k) => (k.id === next.id ? next : k)));
      return { ok: true as const };
    },

    'kb.delete': async (p: { id: string }) => {
      for (const d of deps.store.kbDocs(p.id)) deps.store.kbDeleteDoc(p.id, d.id);
      invalidate(p.id);
      write(kbs().filter((k) => k.id !== p.id));
      return { ok: true as const };
    },

    'kb.addDocument': async (p: { kbId: string; filename: string; text: string }) =>
      ingest(p.kbId, p.filename, p.text),

    'kb.listDocuments': async (p: { kbId: string }) => ({
      docs: deps.store.kbDocs(p.kbId).map((d) => ({
        id: d.id,
        kbId: d.kbId,
        filename: d.filename,
        chunkCount: d.chunkCount,
        addedAt: d.addedAt,
      })),
    }),

    'kb.deleteDocument': async (p: { kbId: string; docId: string }) => {
      const removed = deps.store.kbDocs(p.kbId).find((d) => d.id === p.docId);
      deps.store.kbDeleteDoc(p.kbId, p.docId);
      invalidate(p.kbId);
      if (removed) {
        write(
          kbs().map((k) =>
            k.id === p.kbId
              ? {
                  ...k,
                  docCount: Math.max(0, k.docCount - 1),
                  chunkCount: Math.max(0, k.chunkCount - removed.chunkCount),
                }
              : k,
          ),
        );
      }
      return { ok: true as const };
    },

    'kb.search': async (p: { kbId: string; query: string; topK?: number }) => ({
      hits: await search([p.kbId], p.query, p.topK ?? find(p.kbId)?.topK ?? 5),
    }),

    /** 自动 RAG：active KB 且总开关开 → embed query → 合并余弦 top-k。 */
    async retrieveForChat(query: string): Promise<KbHit[]> {
      if (!deps.getPrefs()['privacy.knowledgeBase']) return [];
      const active = kbs().filter((k) => k.active);
      if (active.length === 0) return [];
      const topK = Math.max(...active.map((k) => k.topK));
      return search(
        active.map((k) => k.id),
        query,
        topK,
      );
    },

    /** 摄入内部 API（kb.importFile 经 router 调）；非 RPC handler，spread 时剔除。 */
    ingest,
  };
}

export type KbService = ReturnType<typeof createKbService>;
