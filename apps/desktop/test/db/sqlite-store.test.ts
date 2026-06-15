import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_PERSONA_STATE } from '@desksoul/protocol';
import { SqliteStore, loadBetterSqlite } from '../../electron/main/db/sqlite-store.js';

// better-sqlite3 是原生模块：CI/本地 Node 可加载则实测；不可加载时跳过（真机覆盖）。
let available = false;
try {
  loadBetterSqlite();
  available = true;
} catch {
  available = false;
}

describe.skipIf(!available)('SqliteStore (real better-sqlite3)', () => {
  it('round-trips messages, persona, usage, and backup', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sqlite-store-'));
    const store = new SqliteStore(join(dir, 'sessions.db'));
    try {
      store.appendMessage({ characterId: 'c', sessionId: 's', role: 'user', text: 'hi', ts: 1 });
      store.appendMessage({
        characterId: 'c',
        sessionId: 's',
        role: 'assistant',
        text: 'yo',
        ts: 2,
        finishReason: 'stop',
        tokensIn: 5,
        tokensOut: 3,
      });
      const rows = store.recentMessages('c', 's', 10);
      expect(rows.map((r) => r.text)).toEqual(['hi', 'yo']);
      expect(rows[1]!.finishReason).toBe('stop');
      expect(rows[1]!.tokensOut).toBe(3);

      store.putPersonaState('c', { ...DEFAULT_PERSONA_STATE, affinity: 80 }, 9);
      expect(store.getPersonaState('c')?.affinity).toBe(80);

      const u = store.storageUsage();
      expect(u.messageCount).toBe(2);
      expect(u.characterCount).toBe(1);
      expect(u.dbBytes).toBeGreaterThan(0);

      const backup = join(dir, 'backup.db');
      await store.backupTo(backup);
      expect(existsSync(backup)).toBe(true);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('isolates by character_id and last-N ordering survives a reopen', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sqlite-store-reopen-'));
    const path = join(dir, 'sessions.db');
    const s1 = new SqliteStore(path);
    for (let i = 1; i <= 5; i++) {
      s1.appendMessage({ characterId: 'a', sessionId: 's', role: 'user', text: `m${i}`, ts: i });
    }
    s1.appendMessage({ characterId: 'b', sessionId: 's', role: 'user', text: 'other', ts: 1 });
    s1.close();

    const s2 = new SqliteStore(path); // 重开：持久化生效
    try {
      expect(s2.recentMessages('a', 's', 2).map((r) => r.text)).toEqual(['m4', 'm5']);
      expect(s2.recentMessages('b', 's', 10).map((r) => r.text)).toEqual(['other']);
    } finally {
      s2.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
