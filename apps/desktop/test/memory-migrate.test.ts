import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryStore } from '../electron/main/db/index.js';
import type { CompileResult } from '../electron/main/memory-compiler.js';
import { createMemoryMigrator } from '../electron/main/memory-migrate.js';
import { MemoryWiki } from '../electron/main/memory-wiki.js';

const cleanups: string[] = [];
afterEach(() => {
  for (const p of cleanups.splice(0)) rmSync(p, { recursive: true, force: true });
});

function make(compile?: (cid: string, facts: readonly string[]) => Promise<CompileResult>) {
  const dir = mkdtempSync(path.join(tmpdir(), 'ds-mig-'));
  cleanups.push(dir);
  const store = new MemoryStore();
  const wiki = new MemoryWiki(dir, { now: () => Date.UTC(2026, 8, 22, 12) });
  const calls: string[][] = [];
  const done: Array<{ characterId: string; from: number }> = [];
  const migrator = createMemoryMigrator({
    store,
    wiki,
    compileFacts:
      compile ??
      (async (_cid, facts) => {
        calls.push([...facts]);
        return { ok: true, ops: 0, changed: [] };
      }),
    onDone: (i) => done.push(i),
    batchSize: 2,
    now: () => 777,
  });
  return {
    store,
    wiki,
    migrator,
    calls,
    done,
    read: (r: string) => readFileSync(path.join(dir, r), 'utf8'),
  };
}

describe('⑲ memory-migrate', () => {
  it('有旧行 → 触发一次（分批）+ 标记 + onDone；第二次幂等；无旧行不触发', async () => {
    const { store, migrator, calls, done } = make();
    for (const t of ['a', 'b', 'c']) store.memoryInsert('default', t, [], 1);
    expect(migrator.needsMigration('default')).toBe(true);
    const r = await migrator.maybeRun('default');
    expect(r).toEqual({ ran: true, ok: true, from: 3 });
    expect(calls).toEqual([['a', 'b'], ['c']]);
    expect(migrator.status('default')).toEqual({ characterId: 'default', from: 3, at: 777 });
    expect(done).toEqual([{ characterId: 'default', from: 3 }]);
    expect(await migrator.maybeRun('default')).toEqual({ ran: false });
    expect(calls).toHaveLength(2);
    expect(migrator.needsMigration('default')).toBe(false);
    expect(await migrator.maybeRun('other')).toEqual({ ran: false });
    expect(store.memoryCount('default')).toBe(3); // 旧表不删
  });

  it('pinned → profile「杂项」锁定节（不过 LLM）；第二角色追加不重复', async () => {
    const { store, migrator, calls, read } = make();
    const id = store.memoryInsert('c1', '用户叫小王', [], 1);
    store.memorySetPinned(id, true);
    store.memoryInsert('c1', '普通事实', [], 1);
    await migrator.maybeRun('c1');
    const profile = read('user/profile.md');
    expect(profile).toMatch(/## 杂项\n\n<!-- locked -->\n- 用户叫小王/);
    expect(calls).toEqual([['普通事实']]);
    const id2 = store.memoryInsert('c2', '用户叫小王', [], 1);
    store.memorySetPinned(id2, true);
    const id3 = store.memoryInsert('c2', '住在北京', [], 1);
    store.memorySetPinned(id3, true);
    await migrator.maybeRun('c2');
    const p2 = read('user/profile.md');
    expect(p2.match(/用户叫小王/g)).toHaveLength(1);
    expect(p2).toContain('- 住在北京');
    expect(calls).toHaveLength(1); // c2 全 pinned，无 LLM 批
  });

  it('批次失败 → 不写标记，可重试', async () => {
    let fail = true;
    const { store, migrator } = make(async () =>
      fail ? { ok: false, ops: 0, error: 'boom', changed: [] } : { ok: true, ops: 0, changed: [] },
    );
    store.memoryInsert('default', 'x', [], 1);
    expect(await migrator.maybeRun('default')).toEqual({ ran: true, ok: false, from: 1 });
    expect(migrator.status('default')).toBeNull();
    fail = false;
    expect(await migrator.maybeRun('default')).toEqual({ ran: true, ok: true, from: 1 });
    expect(migrator.status('default')).not.toBeNull();
  });
});
