import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStore, loadBetterSqlite } from '../../electron/main/db/sqlite-store.js';

// 验收用 SqliteStore 真实落库：本地/CI 可加载 better-sqlite3 则实测，否则跳过（真机覆盖）。
let available = false;
try {
  loadBetterSqlite();
  available = true;
} catch {
  available = false;
}

describe.skipIf(!available)('M6 acceptance — 100 轮规模与查询延迟', () => {
  it('100 turns keep db < 5MB and recent-20 query < 10ms', () => {
    const dir = mkdtempSync(join(tmpdir(), 'm6-accept-'));
    const store = new SqliteStore(join(dir, 'sessions.db'));
    try {
      for (let i = 0; i < 100; i++) {
        store.appendMessage({
          characterId: 'default',
          sessionId: 's',
          role: 'user',
          text: `u${i}`.repeat(20),
          ts: i * 2,
        });
        store.appendMessage({
          characterId: 'default',
          sessionId: 's',
          role: 'assistant',
          text: `a${i}`.repeat(40),
          ts: i * 2 + 1,
          finishReason: 'stop',
          tokensIn: 100,
          tokensOut: 200,
        });
      }
      const usage = store.storageUsage();
      expect(usage.messageCount).toBe(200);
      expect(usage.dbBytes).toBeLessThan(5 * 1024 * 1024);

      const t0 = performance.now();
      const recent = store.recentMessages('default', 's', 20);
      const dt = performance.now() - t0;
      expect(recent).toHaveLength(20);
      expect(recent.at(-1)!.text).toBe('a99'.repeat(40)); // 最新一条
      expect(dt).toBeLessThan(10);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('history survives a process restart (reopen reads committed rows)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'm6-restart-'));
    const path = join(dir, 'sessions.db');
    const s1 = new SqliteStore(path);
    s1.appendMessage({ characterId: 'default', sessionId: 's', role: 'user', text: '持久', ts: 1 });
    s1.appendMessage({ characterId: 'default', sessionId: 's', role: 'assistant', text: '回复', ts: 2, finishReason: 'stop' });
    s1.putPersonaState('default', { affinity: 55, turns: 5 }, 10);
    s1.close();

    const s2 = new SqliteStore(path);
    try {
      expect(s2.recentMessages('default', 's', 50).map((r) => r.text)).toEqual(['持久', '回复']);
      expect(s2.getPersonaState('default')).toMatchObject({ affinity: 55, turns: 5 });
    } finally {
      s2.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
