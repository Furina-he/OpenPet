import { describe, expect, it } from 'vitest';
import type { Prefs } from '@openpet/protocol';
import { MemoryStore } from '../electron/main/db/index.js';
import { createMemoryService } from '../electron/main/memory-service.js';

const embed = async (inputs: string[]): Promise<number[][]> => inputs.map((t) => [t.length, 1]);

function makeSvc(store = new MemoryStore(), ltm = true) {
  return createMemoryService({
    store,
    embed,
    getPrefs: () => ({ 'privacy.longTermMemory': ltm }) as unknown as Prefs,
    character: () => ({ id: 'default' }),
  });
}

describe('memory-service（F3 RPC + 检索注入）', () => {
  it('add/list/setPinned/delete/clear', async () => {
    const svc = makeSvc();
    const { id } = await svc['memory.add']({ text: '用户在深圳工作' });
    expect((await svc['memory.list']({})).facts).toHaveLength(1);
    await svc['memory.setPinned']({ id, pinned: true });
    expect((await svc['memory.list']({})).facts[0]!.pinned).toBe(true);
    await svc['memory.delete']({ id });
    await svc['memory.add']({ text: 'x1' });
    await svc['memory.clear']({});
    expect((await svc['memory.list']({})).facts).toHaveLength(0);
  });
  it('retrieveForChat：pinned 全量 + 余弦 top3；开关关 → []', async () => {
    const store = new MemoryStore();
    const svc = makeSvc(store);
    await svc['memory.add']({ text: '钉住的背景' });
    const pinnedId = (await svc['memory.list']({})).facts[0]!.id;
    await svc['memory.setPinned']({ id: pinnedId, pinned: true });
    for (const t of ['aa', 'bbbb', 'cccccc', 'dddddddd']) await svc['memory.add']({ text: t });
    const got = await svc.retrieveForChat('aa');
    expect(got).toContain('钉住的背景');
    expect(got.length).toBeLessThanOrEqual(4); // pinned(1) + top3
    expect(await makeSvc(store, false).retrieveForChat('aa')).toEqual([]);
  });

  it('⑮ 注入带时间标注：≥1 天「（记于 X前）」（updatedAt 优先）；<1 天不标', async () => {
    const DAY = 86_400_000;
    const nowMs = 100 * DAY;
    const store = new MemoryStore();
    const oldId = store.memoryInsert('default', '用户养了只猫', [2, 1], nowMs - 3 * DAY);
    store.memoryInsert('default', '用户刚说的事', [2, 1], nowMs - 1000);
    const updatedId = store.memoryInsert('default', '旧内容', [2, 1], nowMs - 30 * DAY);
    store.memoryUpdate(updatedId, '用户考完试了', [2, 1], nowMs - 2 * DAY);
    store.memorySetPinned(oldId, true);
    const svc = createMemoryService({
      store,
      embed,
      getPrefs: () => ({ 'privacy.longTermMemory': true }) as unknown as Prefs,
      character: () => ({ id: 'default' }),
      now: () => nowMs,
    });
    const got = await svc.retrieveForChat('aa');
    expect(got).toContain('用户养了只猫（记于 3 天前）');
    expect(got).toContain('用户刚说的事'); // <1 天不标注
    expect(got).toContain('用户考完试了（记于 2 天前）'); // updatedAt 优先于 createdAt
  });
});
