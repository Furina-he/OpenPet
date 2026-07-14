import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_PERSONA_STATE } from '@openpet/protocol';
import {
  SqliteStore,
  loadBetterSqlite,
  resolveNativeBinding,
} from '../../electron/main/db/sqlite-store.js';

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

  it('批次⑥ usageSummary/clearMessages（与 MemoryStore 语义对齐）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sqlite-store-usage-'));
    const store = new SqliteStore(join(dir, 'sessions.db'));
    try {
      const base = { characterId: 'c', sessionId: 's', role: 'assistant' as const, finishReason: 'stop' as const };
      store.appendMessage({ ...base, text: 'early', ts: 50, tokensIn: 100, tokensOut: 10 });
      store.appendMessage({ ...base, text: 'a', ts: 150, tokensIn: 7, tokensOut: 3 });
      store.appendMessage({ ...base, text: 'b', ts: 200, tokensIn: 5, tokensOut: 2 });
      store.appendMessage({ ...base, text: 'no-usage', ts: 250 });
      store.appendMessage({ characterId: 'c', sessionId: 's', role: 'user', text: 'u', ts: 260, tokensIn: 9, tokensOut: 9 });
      expect(store.usageSummary(100)).toEqual({ tokensIn: 12, tokensOut: 5, messages: 2 });
      store.clearMessages();
      expect(store.storageUsage().messageCount).toBe(0);
      expect(store.usageSummary(0)).toEqual({ tokensIn: 0, tokensOut: 0, messages: 0 });
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('§5 KB: chunk/doc 入库 + 向量 blob 往返 + deleteDoc 清理（跨重开持久化）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sqlite-store-kb-'));
    const path = join(dir, 'sessions.db');
    const s1 = new SqliteStore(path);
    s1.kbInsertChunks('k1', 'd1', 'a.md', [
      { ord: 0, text: 'hello', vector: [1, 0, 0.5] },
      { ord: 1, text: 'world', vector: [0, 1, 0.25] },
    ]);
    s1.kbInsertChunks('k2', 'd2', 'b.txt', [{ ord: 0, text: 'other', vector: [1, 1] }]);
    s1.close();

    const s2 = new SqliteStore(path); // 重开：向量 blob 与文档行均持久化
    try {
      const chunks = s2.kbChunks(['k1']);
      expect(chunks.map((c) => c.text)).toEqual(['hello', 'world']);
      // Float32 往返：1.0/0.0 精确，0.5/0.25 是 2 的幂可精确表示
      expect(chunks[0]!.vector).toEqual([1, 0, 0.5]);
      expect(s2.kbChunks(['k1', 'k2'])).toHaveLength(3);
      const docs = s2.kbDocs('k1');
      expect(docs.map((d) => d.filename)).toEqual(['a.md']);
      expect(docs[0]!.chunkCount).toBe(2);

      s2.kbDeleteDoc('k1', 'd1');
      expect(s2.kbChunks(['k1'])).toEqual([]);
      expect(s2.kbDocs('k1')).toEqual([]);
      expect(s2.kbChunks(['k2'])).toHaveLength(1); // 其它 KB 不受影响
    } finally {
      s2.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe.skipIf(!available)('SqliteStore 总览统计查询（spec 2026-07-09）', () => {
  const TZ = 8 * 3_600_000;
  const DAY = 86_400_000;
  const t1 = Date.UTC(2026, 6, 8, 2); // 本地 07-08 10:00
  const t2 = Date.UTC(2026, 6, 8, 3);
  const t3 = Date.UTC(2026, 6, 9, 2); // 本地 07-09 10:00
  it('count/firstTs/series/tokensByModel/tokenSeries 与 MemoryStore 语义一致', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sqlite-store-stats-'));
    const store = new SqliteStore(join(dir, 'sessions.db'));
    try {
      expect(store.statsFirstMessageTs()).toBeNull();
      expect(store.statsMessageCount(0)).toBe(0);
      expect(store.statsMessageSeries(0, DAY, TZ)).toEqual([]);
      store.appendMessage({ characterId: 'c', sessionId: 's', role: 'user', text: 'q1', ts: t1 });
      store.appendMessage({ characterId: 'c', sessionId: 's', role: 'assistant', text: 'a1', ts: t2,
        finishReason: 'stop', tokensIn: 100, tokensOut: 20, model: 'gpt-4o' });
      store.appendMessage({ characterId: 'c', sessionId: 'im:qq:x', role: 'assistant', text: 'a2', ts: t3,
        finishReason: 'stop', tokensIn: 50, tokensOut: 10, model: 'deepseek-v3' });
      expect(store.statsFirstMessageTs()).toBe(t1);
      expect(store.statsMessageCount(0)).toBe(3);
      expect(store.statsMessageCount(Date.UTC(2026, 6, 9, 0))).toBe(1);
      const b0 = Math.floor((t1 + TZ) / DAY) * DAY - TZ;
      expect(store.statsMessageSeries(0, DAY, TZ)).toEqual([[b0, 2], [b0 + DAY, 1]]);
      expect(store.statsTokensByModel(0)).toEqual([
        { model: 'gpt-4o', tokens: 120 },
        { model: 'deepseek-v3', tokens: 60 },
      ]);
      const series = store.statsTokenSeriesByModel(0, DAY, TZ);
      expect(series).toContainEqual({ model: 'gpt-4o', points: [[b0, 120]] });
      expect(series).toContainEqual({ model: 'deepseek-v3', points: [[b0 + DAY, 60]] });
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('resolveNativeBinding（Electron ABI 双版共存，spec: 债表 ABI 切换脚本化）', () => {
  it('Electron 下且产物存在 → 返回按版本命名的路径；否则 undefined', () => {
    const dir = 'D:/app/native';
    const file = 'D:/app/native/better_sqlite3-electron-v30.5.1.node';
    expect(resolveNativeBinding(dir, '30.5.1', (p) => p === file)).toBe(file);
    expect(resolveNativeBinding(dir, '30.5.1', () => false)).toBeUndefined(); // 未下载
    expect(resolveNativeBinding(dir, undefined, () => true)).toBeUndefined(); // 纯 Node（vitest）
    expect(resolveNativeBinding(undefined, '30.5.1', () => true)).toBeUndefined(); // 无目录
  });
});

describe.skipIf(!available)('SqliteStore 记忆域 T1（与 MemoryStore 语义对齐 + 旧库迁移）', () => {
  it('memoryUpdate/sessionSummary/messageStats/messagesBetween 全链路（跨重开持久化）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sqlite-store-memdomain-'));
    const path = join(dir, 'sessions.db');
    const s1 = new SqliteStore(path);
    const factId = s1.memoryInsert('c', '用户在准备考试', [1, 0], 100);
    expect(s1.memoryList('c')[0]).toMatchObject({ id: factId, createdAt: 100, updatedAt: null });
    s1.memoryUpdate(factId, '用户考完试了', [0, 1], 200);

    const ids: number[] = [];
    for (let i = 1; i <= 5; i++) {
      ids.push(
        s1.appendMessage({ characterId: 'c', sessionId: 's', role: 'user', text: `m${i}`, ts: i }),
      );
    }
    s1.sessionSetTitle('s', 'c', '标题');
    s1.sessionSummarySet('s', '聊了猫', ids[2]!);
    s1.close();

    const s2 = new SqliteStore(path); // 重开：全部持久化
    try {
      const fact = s2.memoryList('c')[0]!;
      expect(fact.text).toBe('用户考完试了');
      expect(fact.createdAt).toBe(100);
      expect(fact.updatedAt).toBe(200);
      expect(s2.memoryVectors('c')[0]).toMatchObject({ createdAt: 100, updatedAt: 200 });
      expect(s2.memoryVectors('c')[0]!.vector).toEqual([0, 1]);

      expect(s2.sessionSummaryGet('s')).toEqual({ summary: '聊了猫', upto: ids[2]! });
      s2.sessionSummarySet('s', '手动改'); // upto 不动
      expect(s2.sessionSummaryGet('s')).toEqual({ summary: '手动改', upto: ids[2]! });
      expect(s2.sessionList('c')[0]!.title).toBe('标题'); // summary 写入不冲 title
      s2.sessionSummarySet('s', null);
      expect(s2.sessionSummaryGet('s').summary).toBeNull();

      expect(s2.messageStats('s')).toEqual({ count: 5, lastId: ids[4]! });
      expect(s2.messageStats('nope')).toEqual({ count: 0, lastId: 0 });
      expect(s2.messagesBetween('c', 's', ids[1]!, ids[3]!).map((m) => m.text)).toEqual([
        'm3',
        'm4',
      ]);
    } finally {
      s2.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('v4 旧库（无 updated_at/summary 列）打开即迁移，旧数据保留', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sqlite-store-migrate-'));
    const path = join(dir, 'sessions.db');
    const Database = loadBetterSqlite();
    const raw = new Database(path);
    raw.exec(`
      CREATE TABLE memory_fact (
        id INTEGER PRIMARY KEY, character_id TEXT NOT NULL, text TEXT NOT NULL,
        vector BLOB, pinned INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
      );
      CREATE TABLE session_meta (
        session_id TEXT PRIMARY KEY, character_id TEXT NOT NULL, title TEXT,
        pinned INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
      );
    `);
    raw
      .prepare('INSERT INTO memory_fact(character_id, text, vector, pinned, created_at) VALUES (?, ?, NULL, 1, ?)')
      .run('c', '旧事实', 42);
    raw
      .prepare('INSERT INTO session_meta(session_id, character_id, title, pinned, created_at) VALUES (?, ?, ?, 0, 1)')
      .run('s', 'c', '旧标题');
    raw.close();

    const s = new SqliteStore(path); // 打开旧库 → ALTER 迁移
    try {
      const fact = s.memoryList('c')[0]!;
      expect(fact).toMatchObject({ text: '旧事实', pinned: true, createdAt: 42, updatedAt: null });
      s.memoryUpdate(fact.id, '新事实', [1], 99);
      expect(s.memoryList('c')[0]).toMatchObject({ text: '新事实', updatedAt: 99 });
      expect(s.sessionSummaryGet('s')).toEqual({ summary: null, upto: null });
      s.sessionSummarySet('s', '迁移后可写', 7);
      expect(s.sessionSummaryGet('s')).toEqual({ summary: '迁移后可写', upto: 7 });
    } finally {
      s.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe.skipIf(!available)('SqliteStore 会话管理查询（与 MemoryStore 语义对齐）', () => {
  it('sessionList/SetTitle/SetPinned/Delete/Messages 全链路', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sqlite-store-session-'));
    const s = new SqliteStore(join(dir, 'sessions.db'));
    try {
      expect(s.sessionList('c')).toEqual([]);
      s.appendMessage({ characterId: 'c', sessionId: 'a', role: 'user', text: '第一句话题', ts: 10 });
      s.appendMessage({ characterId: 'c', sessionId: 'a', role: 'assistant', text: '回A', ts: 20, finishReason: 'stop' });
      s.appendMessage({ characterId: 'c', sessionId: 'b', role: 'user', text: 'B首句', ts: 30 });
      s.appendMessage({ characterId: 'other', sessionId: 'z', role: 'user', text: '别的角色', ts: 40 });
      let list = s.sessionList('c');
      expect(list.map((x) => x.id)).toEqual(['b', 'a']);
      expect(list[1]).toEqual({
        id: 'a', title: null, pinned: false,
        lastText: '回A', lastTs: 20, count: 2, firstUserText: '第一句话题',
      });
      s.sessionSetPinned('a', 'c', true);
      s.sessionSetTitle('a', 'c', '改过的名');
      list = s.sessionList('c');
      expect(list.map((x) => x.id)).toEqual(['a', 'b']);
      expect(list[0]!.title).toBe('改过的名');
      expect(list[0]!.pinned).toBe(true);
      expect(s.sessionMessages('c', 'a').map((m) => m.text)).toEqual(['第一句话题', '回A']);
      s.sessionDelete('a');
      expect(s.sessionList('c').map((x) => x.id)).toEqual(['b']);
      expect(s.sessionMessages('c', 'a')).toEqual([]);
    } finally {
      s.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
