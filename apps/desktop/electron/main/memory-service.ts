/**
 * MemoryService —— memory.* RPC（F3 记忆页）+ retrieveForChat（memoryStage 注入源）。
 * 检索 = pinned 全量 + 未钉住余弦 top3；开关 privacy.longTermMemory 同时闸注入。
 * 手动添加同样 embed（失败则存空向量：仍可列出/钉住，只是不参与相似检索）。
 */
import type { Prefs } from '@openpet/protocol';
import type { ConversationStore } from './db/index.js';
import { cosineSim } from './kb-search.js';

export interface MemoryServiceDeps {
  store: ConversationStore;
  embed: (inputs: string[]) => Promise<number[][]>;
  getPrefs: () => Prefs;
  character: () => { id: string };
}

const TOP_K = 3;

export function createMemoryService(deps: MemoryServiceDeps) {
  const cid = (): string => deps.character().id;

  return {
    'memory.list': async (_p: Record<string, never>) => ({ facts: deps.store.memoryList(cid()) }),

    'memory.add': async (p: { text: string }) => {
      let vector: number[] = [];
      try {
        vector = (await deps.embed([p.text]))[0] ?? [];
      } catch {
        /* 未配 embedding：存空向量 */
      }
      const id = deps.store.memoryInsert(cid(), p.text.trim(), vector, Date.now());
      return { ok: true as const, id };
    },

    'memory.delete': async (p: { id: number }) => {
      deps.store.memoryDelete(p.id);
      return { ok: true as const };
    },

    'memory.setPinned': async (p: { id: number; pinned: boolean }) => {
      deps.store.memorySetPinned(p.id, p.pinned);
      return { ok: true as const };
    },

    'memory.clear': async (_p: Record<string, never>) => {
      deps.store.memoryClear(cid());
      return { ok: true as const };
    },

    /** memoryStage 注入源：pinned 全量 + 余弦 top3（去重）。 */
    async retrieveForChat(query: string): Promise<string[]> {
      if (!deps.getPrefs()['privacy.longTermMemory']) return [];
      const rows = deps.store.memoryVectors(cid());
      if (rows.length === 0) return [];
      const pinned = rows.filter((r) => r.pinned).map((r) => r.text);
      const rest = rows.filter((r) => !r.pinned && r.vector.length > 0);
      if (rest.length === 0) return pinned;
      let qv: number[] | undefined;
      try {
        qv = (await deps.embed([query]))[0];
      } catch {
        return pinned;
      }
      if (!qv) return pinned;
      const top = rest
        .map((r) => ({ text: r.text, score: cosineSim(r.vector, qv!) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, TOP_K)
        .map((r) => r.text);
      return [...pinned, ...top.filter((t) => !pinned.includes(t))];
    },
  };
}

export type MemoryService = ReturnType<typeof createMemoryService>;
