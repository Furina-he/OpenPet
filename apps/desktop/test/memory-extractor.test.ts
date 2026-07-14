import { describe, expect, it } from 'vitest';
import type { Prefs } from '@openpet/protocol';
import { MemoryStore } from '../electron/main/db/index.js';
import { createMemoryExtractor } from '../electron/main/memory-extractor.js';

function fakeCompletion(content: string, calls?: { n: number }) {
  return async (): Promise<Response> => {
    if (calls) calls.n++;
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  };
}
const embed = async (inputs: string[]): Promise<number[][]> =>
  inputs.map((t) => [t.length, t.charCodeAt(0) ?? 0, 1]); // 确定性向量：同文本→同向量

function makeExtractor(
  store: MemoryStore,
  fetchImpl: () => Promise<Response>,
  opts: { ltm?: boolean; now?: () => number } = {},
) {
  return createMemoryExtractor({
    store,
    embed,
    fetchImpl,
    getPrefs: () => ({ 'privacy.longTermMemory': opts.ltm ?? true }) as unknown as Prefs,
    resolveTarget: () => ({ apiBase: 'https://x/v1', model: 'gpt', key: 'k', adapter: 'openai' }),
    character: () => ({ id: 'default' }),
    turnsPerExtract: 2, // 测试降频
    ...(opts.now ? { now: opts.now } : {}),
  });
}

function seedMessage(store: MemoryStore): void {
  store.appendMessage({
    characterId: 'default',
    sessionId: 's1',
    role: 'user',
    text: '我养了只猫叫年糕',
    ts: 1,
  });
}

describe('memory-extractor（批次⑥ F-AI-06 + ⑮ 生命周期 v2）', () => {
  it('每 N 轮触发提炼 → add 操作入库（剥 codefence）', async () => {
    const store = new MemoryStore();
    seedMessage(store);
    const ex = makeExtractor(
      store,
      fakeCompletion('```json\n[{"op":"add","text":"用户养了只猫，名字叫年糕"}]\n```'),
    );
    await ex.onTurnEnd('s1'); // 第 1 轮不触发
    expect(store.memoryList('default')).toHaveLength(0);
    await ex.onTurnEnd('s1'); // 第 2 轮触发
    expect(store.memoryList('default').map((f) => f.text)).toEqual(['用户养了只猫，名字叫年糕']);
  });

  it('add 重复事实（余弦>0.92）去重；privacy.longTermMemory=false 不提炼', async () => {
    const store = new MemoryStore();
    seedMessage(store);
    const ex = makeExtractor(store, fakeCompletion('[{"op":"add","text":"用户养了只猫，名字叫年糕"}]'));
    await ex.onTurnEnd('s1');
    await ex.onTurnEnd('s1');
    await ex.onTurnEnd('s1');
    await ex.onTurnEnd('s1'); // 第二次提炼同文本 → 去重
    expect(store.memoryList('default')).toHaveLength(1);
    const offStore = new MemoryStore();
    seedMessage(offStore);
    const off = makeExtractor(offStore, fakeCompletion('[{"op":"add","text":"x 一条足够长的事实"}]'), {
      ltm: false,
    });
    await off.onTurnEnd('s1');
    await off.onTurnEnd('s1');
    expect(offStore.memoryList('default')).toHaveLength(0); // 开关关 → 不提炼
  });

  it('update 操作替换 text+vector+updatedAt（created_at 不动）', async () => {
    const store = new MemoryStore();
    seedMessage(store);
    const id = store.memoryInsert('default', '用户在准备考试', [1, 1, 1], 100);
    const ex = makeExtractor(
      store,
      fakeCompletion(`[{"op":"update","id":${id},"text":"用户考完试了，最近在找工作"}]`),
    );
    await ex.onTurnEnd('s1');
    await ex.onTurnEnd('s1');
    const row = store.memoryList('default')[0]!;
    expect(row.text).toBe('用户考完试了，最近在找工作');
    expect(row.createdAt).toBe(100);
    expect(row.updatedAt).not.toBeNull();
    expect(store.memoryVectors('default')[0]!.vector).not.toEqual([1, 1, 1]);
  });

  it('remove 操作删除条目', async () => {
    const store = new MemoryStore();
    seedMessage(store);
    const id = store.memoryInsert('default', '用户在准备考试', [1, 1, 1], 100);
    const ex = makeExtractor(store, fakeCompletion(`[{"op":"remove","id":${id}}]`));
    await ex.onTurnEnd('s1');
    await ex.onTurnEnd('s1');
    expect(store.memoryList('default')).toHaveLength(0);
  });

  it('护栏：候选集外 id 的 update/remove 丢弃（防幻觉）', async () => {
    const store = new MemoryStore();
    seedMessage(store);
    store.memoryInsert('default', '用户在准备考试', [1, 1, 1], 100);
    const ex = makeExtractor(
      store,
      fakeCompletion('[{"op":"remove","id":999},{"op":"update","id":998,"text":"幻觉内容啊啊"}]'),
    );
    await ex.onTurnEnd('s1');
    await ex.onTurnEnd('s1');
    const rows = store.memoryList('default');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.text).toBe('用户在准备考试'); // 原样
  });

  it('护栏：pinned 条目豁免 update/remove', async () => {
    const store = new MemoryStore();
    seedMessage(store);
    const id = store.memoryInsert('default', '用户钉住的重要事实', [1, 1, 1], 100);
    store.memorySetPinned(id, true);
    const ex = makeExtractor(
      store,
      fakeCompletion(`[{"op":"remove","id":${id}},{"op":"update","id":${id},"text":"试图改钉住的"}]`),
    );
    await ex.onTurnEnd('s1');
    await ex.onTurnEnd('s1');
    const rows = store.memoryList('default');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.text).toBe('用户钉住的重要事实');
    expect(rows[0]!.updatedAt).toBeNull();
  });

  it('flush：计数>0 时立即提炼并清零；60s 防抖不连发', async () => {
    const store = new MemoryStore();
    seedMessage(store);
    let t = 1_000_000;
    const calls = { n: 0 };
    const ex = makeExtractor(store, fakeCompletion('[{"op":"add","text":"用户养了只猫，名字叫年糕"}]', calls), {
      now: () => t,
    });
    await ex.flush(); // 计数 0 → 不提炼
    expect(calls.n).toBe(0);
    await ex.onTurnEnd('s1'); // 计数 1（不足 2 不触发）
    expect(calls.n).toBe(0);
    await ex.flush(); // 计数>0 → 立即提炼
    expect(calls.n).toBe(1);
    expect(store.memoryList('default')).toHaveLength(1);
    await ex.onTurnEnd('s1'); // 计数已清零 → 这轮是 1，不触发常规提炼
    expect(calls.n).toBe(1);
    await ex.flush(); // 60s 内 → 防抖跳过（计数保留）
    expect(calls.n).toBe(1);
    t += 61_000;
    await ex.flush(); // 防抖窗口过 → 提炼
    expect(calls.n).toBe(2);
  });
});
