import { describe, it, expect } from 'vitest';
import type { Prefs } from '@openpet/protocol';
import { MemoryStore } from '../electron/main/db/memory-store';
import { createKbService } from '../electron/main/kb-service';

/**
 * 测试 harness：MemoryStore + 内存 prefs + 确定性 embed。
 * embed(text) = [出现 'cat' 次数, 出现 'dog' 次数]，让余弦检索可断言排序。
 */
function harness(prefsInit: Partial<Record<string, unknown>> = {}) {
  const data: Record<string, unknown> = {
    'kb.list': [],
    'privacy.knowledgeBase': true,
    ...prefsInit,
  };
  const store = new MemoryStore();
  const embedCalls: string[][] = [];
  const embed = async (inputs: string[]): Promise<number[][]> => {
    embedCalls.push(inputs);
    return inputs.map((t) => [
      (t.match(/cat/g) ?? []).length,
      (t.match(/dog/g) ?? []).length,
    ]);
  };
  const kb = createKbService({
    store,
    embed,
    getPrefs: () => data as unknown as Prefs,
    setPref: (k: string, v: unknown) => {
      data[k] = v;
    },
  });
  return { kb, store, data, embedCalls };
}

describe('kb-service', () => {
  it('create → list 带默认值', async () => {
    const { kb } = harness();
    const { id } = await kb['kb.create']({ name: '资料', emoji: '🐱' });
    const { kbs } = await kb['kb.list']({});
    expect(kbs).toHaveLength(1);
    expect(kbs[0]).toMatchObject({ id, name: '资料', emoji: '🐱', active: true, chunkCount: 0 });
  });

  it('addDocument：分块 + embed + 入库 + count 回写', async () => {
    const { kb, store, data, embedCalls } = harness();
    const { id } = await kb['kb.create']({ name: 'k' });
    const r = await kb['kb.addDocument']({ kbId: id, filename: 'a.md', text: 'cat cat\n\ndog' });
    expect(r.chunks).toBe(2); // 双换行 → 两块
    expect(embedCalls).toContainEqual(['cat cat', 'dog']); // 摄入期批量 embed 分块
    expect(store.kbChunks([id]).map((c) => c.text)).toEqual(['cat cat', 'dog']);
    const kbRow = (data['kb.list'] as Array<{ id: string; docCount: number; chunkCount: number }>)[0]!;
    expect(kbRow.docCount).toBe(1);
    expect(kbRow.chunkCount).toBe(2);
  });

  it('search：按余弦命中排序', async () => {
    const { kb } = harness();
    const { id } = await kb['kb.create']({ name: 'k' });
    await kb['kb.addDocument']({ kbId: id, filename: 'a.md', text: 'cat cat\n\ndog' });
    const { hits } = await kb['kb.search']({ kbId: id, query: 'cat' });
    expect(hits[0]!.text).toBe('cat cat'); // 'cat' 查询命中 'cat cat' 最高
    expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score);
  });

  it('retrieveForChat：受 active + 总开关控制', async () => {
    const { kb, data } = harness();
    const { id } = await kb['kb.create']({ name: 'k' });
    await kb['kb.addDocument']({ kbId: id, filename: 'a.md', text: 'cat cat\n\ndog' });

    const hits = await kb.retrieveForChat('cat');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.text).toBe('cat cat');

    // 关总开关 → 空
    data['privacy.knowledgeBase'] = false;
    expect(await kb.retrieveForChat('cat')).toEqual([]);

    // 开开关但 KB 非 active → 空
    data['privacy.knowledgeBase'] = true;
    const list = data['kb.list'] as Array<{ active: boolean }>;
    list[0]!.active = false;
    expect(await kb.retrieveForChat('cat')).toEqual([]);
  });

  it('deleteDocument：count 回滚 + chunk 清理', async () => {
    const { kb, store, data } = harness();
    const { id } = await kb['kb.create']({ name: 'k' });
    const { docId } = await kb['kb.addDocument']({ kbId: id, filename: 'a.md', text: 'cat\n\ndog' });
    await kb['kb.deleteDocument']({ kbId: id, docId });
    expect(store.kbChunks([id])).toEqual([]);
    const kbRow = (data['kb.list'] as Array<{ docCount: number; chunkCount: number }>)[0]!;
    expect(kbRow.docCount).toBe(0);
    expect(kbRow.chunkCount).toBe(0);
  });

  it('delete KB：清空文档 + 移出 list', async () => {
    const { kb, store, data } = harness();
    const { id } = await kb['kb.create']({ name: 'k' });
    await kb['kb.addDocument']({ kbId: id, filename: 'a.md', text: 'cat' });
    await kb['kb.delete']({ id });
    expect(data['kb.list']).toEqual([]);
    expect(store.kbChunks([id])).toEqual([]);
  });

  it('#5 缓存：同 KB 第二次检索不再全量拉库；增删文档精确失效', async () => {
    const data: Record<string, unknown> = { 'kb.list': [], 'privacy.knowledgeBase': true };
    const store = new MemoryStore();
    let kbChunksCalls = 0;
    const countingStore = new Proxy(store, {
      get(t, prop, recv) {
        if (prop === 'kbChunks') {
          return (...args: Parameters<typeof store.kbChunks>) => {
            kbChunksCalls += 1;
            return t.kbChunks(...args);
          };
        }
        return Reflect.get(t, prop, recv);
      },
    });
    const embed = async (inputs: string[]): Promise<number[][]> =>
      inputs.map((t) => [(t.match(/cat/g) ?? []).length, 1]);
    const kb = createKbService({
      store: countingStore,
      embed,
      getPrefs: () => data as unknown as Prefs,
      setPref: (k: string, v: unknown) => {
        data[k] = v;
      },
    });
    const { id } = await kb['kb.create']({ name: 'k' });
    await kb['kb.addDocument']({ kbId: id, filename: 'a.md', text: 'cat cat\n\ndog' });
    kbChunksCalls = 0;
    await kb['kb.search']({ kbId: id, query: 'cat' });
    await kb['kb.search']({ kbId: id, query: 'cat' });
    expect(kbChunksCalls).toBe(1); // 第二次走缓存
    await kb['kb.addDocument']({ kbId: id, filename: 'b.md', text: 'dog dog' });
    await kb['kb.search']({ kbId: id, query: 'cat' });
    expect(kbChunksCalls).toBe(2); // 摄入失效 → 重拉一次
  });

  it('rerank：KB 开关开且注入 rerank fn → 命中按重排序；fn 返回 null → 回退余弦序', async () => {
    async function run(rerank: (q: string, docs: string[], topN: number) => Promise<number[] | null>) {
      const data: Record<string, unknown> = { 'kb.list': [], 'privacy.knowledgeBase': true };
      const embed = async (inputs: string[]): Promise<number[][]> =>
        inputs.map((t) => [(t.match(/cat/g) ?? []).length, 1]);
      const kb = createKbService({
        store: new MemoryStore(),
        embed,
        getPrefs: () => data as unknown as Prefs,
        setPref: (k: string, v: unknown) => {
          data[k] = v;
        },
        rerank,
      });
      const { id } = await kb['kb.create']({ name: 'k' });
      const list = data['kb.list'] as Array<{ rerank: boolean }>;
      list[0]!.rerank = true;
      await kb['kb.addDocument']({ kbId: id, filename: 'a.md', text: 'cat cat\n\ndog' });
      const { hits } = await kb['kb.search']({ kbId: id, query: 'cat', topK: 2 });
      return hits.map((h) => h.text);
    }
    // 余弦序 = ['cat cat', 'dog']；rerank 颠倒 → ['dog', 'cat cat']
    expect(await run(async () => [1, 0])).toEqual(['dog', 'cat cat']);
    // rerank 失败（null）→ 回退余弦序
    expect(await run(async () => null)).toEqual(['cat cat', 'dog']);
  });
});
