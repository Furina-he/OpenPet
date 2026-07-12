import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConversationStore, MemoryStore } from '../../electron/main/db/index.js';
import { loadBetterSqlite } from '../../electron/main/db/sqlite-store.js';

let available = false;
try {
  loadBetterSqlite();
  available = true;
} catch {
  available = false;
}

describe('createConversationStore · requireNative（打包版失败即响）', () => {
  it('requireNative + native 产物缺失 → onFatal 且 throw，绝不静默降级内存库', () => {
    const onFatal = vi.fn();
    expect(() =>
      createConversationStore({
        sqlitePath: join(tmpdir(), 'nope', 'sessions.db'),
        nativeDir: 'C:\\definitely\\missing\\native',
        requireNative: true,
        electronVersion: '30.5.1',
        onFatal,
      }),
    ).toThrow(/better-sqlite3/i);
    expect(onFatal).toHaveBeenCalledTimes(1);
    expect(String(onFatal.mock.calls[0]?.[0])).toMatch(/native/i);
  });

  it.skipIf(!available)(
    'requireNative + nativeBinding 加载失败（坏产物路径）→ onFatal 且 throw',
    () => {
      const onFatal = vi.fn();
      const dir = mkdtempSync(join(tmpdir(), 'create-store-'));
      const fakeNative = join(dir, 'better_sqlite3-electron-v30.5.1.node');
      // 文件存在但不是合法 .node —— 构造时加载必失败
      writeFileSync(fakeNative, 'not a dll');
      expect(() =>
        createConversationStore({
          sqlitePath: join(dir, 'sessions.db'),
          nativeDir: dir,
          requireNative: true,
          electronVersion: '30.5.1',
          onFatal,
        }),
      ).toThrow();
      expect(onFatal).toHaveBeenCalledTimes(1);
    },
  );

  it('无 requireNative（dev 现状）：native 缺失照旧降级，不 fatal', () => {
    const onFatal = vi.fn();
    const store = createConversationStore({
      sqlitePath: join(tmpdir(), `create-store-dev-${Date.now()}`, 'sessions.db'),
      nativeDir: 'C:\\definitely\\missing\\native',
      electronVersion: '999.0.0',
      onFatal,
    });
    // Node ABI 产物可用 → SqliteStore；不可用 → MemoryStore。两者都合法，但绝不 fatal。
    expect(onFatal).not.toHaveBeenCalled();
    store.close();
  });

  it('缺 sqlitePath（测试装配）→ MemoryStore 直通', () => {
    expect(createConversationStore({})).toBeInstanceOf(MemoryStore);
  });
});
