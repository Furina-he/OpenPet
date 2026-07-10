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
});
