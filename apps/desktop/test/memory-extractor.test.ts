import { describe, expect, it } from 'vitest';
import type { Prefs } from '@openpet/protocol';
import { MemoryStore } from '../electron/main/db/index.js';
import { createMemoryExtractor } from '../electron/main/memory-extractor.js';

function fakeCompletion(content: string) {
  return async (): Promise<Response> =>
    new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
}
const embed = async (inputs: string[]): Promise<number[][]> =>
  inputs.map((t) => [t.length, t.charCodeAt(0) ?? 0, 1]); // 确定性向量：同文本→同向量

function makeExtractor(store: MemoryStore, fetchImpl: () => Promise<Response>, ltm = true) {
  return createMemoryExtractor({
    store,
    embed,
    fetchImpl,
    getPrefs: () => ({ 'privacy.longTermMemory': ltm }) as unknown as Prefs,
    resolveTarget: () => ({ apiBase: 'https://x/v1', model: 'gpt', key: 'k', adapter: 'openai' }),
    character: () => ({ id: 'default' }),
    turnsPerExtract: 2, // 测试降频
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

describe('memory-extractor（批次⑥ F-AI-06）', () => {
  it('每 N 轮触发提炼 → 解析 JSON 数组入库（剥 codefence）', async () => {
    const store = new MemoryStore();
    seedMessage(store);
    const ex = makeExtractor(store, fakeCompletion('```json\n["用户养了只猫，名字叫年糕"]\n```'));
    await ex.onTurnEnd('s1'); // 第 1 轮不触发
    expect(store.memoryList('default')).toHaveLength(0);
    await ex.onTurnEnd('s1'); // 第 2 轮触发
    expect(store.memoryList('default').map((f) => f.text)).toEqual(['用户养了只猫，名字叫年糕']);
  });
  it('重复事实（余弦>0.92）去重；privacy.longTermMemory=false 不提炼', async () => {
    const store = new MemoryStore();
    seedMessage(store);
    const ex = makeExtractor(store, fakeCompletion('["用户养了只猫，名字叫年糕"]'));
    await ex.onTurnEnd('s1');
    await ex.onTurnEnd('s1');
    await ex.onTurnEnd('s1');
    await ex.onTurnEnd('s1'); // 第二次提炼同文本 → 去重
    expect(store.memoryList('default')).toHaveLength(1);
    const offStore = new MemoryStore();
    seedMessage(offStore);
    const off = makeExtractor(offStore, fakeCompletion('["x 一条足够长的事实"]'), false);
    await off.onTurnEnd('s1');
    await off.onTurnEnd('s1');
    expect(offStore.memoryList('default')).toHaveLength(0); // 开关关 → 不提炼
  });
});
