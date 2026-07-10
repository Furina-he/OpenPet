import { existsSync } from 'node:fs';
import type { ConversationStore } from './store.js';
import { MemoryStore } from './memory-store.js';
import { SqliteStore, resolveNativeBinding } from './sqlite-store.js';

export type { ConversationStore, AppendMessageInput, StoredRow, KbChunkRow, KbDocRow } from './store.js';
export { MemoryStore } from './memory-store.js';
export { SqliteStore, loadBetterSqlite } from './sqlite-store.js';

export interface CreateStoreOptions {
  /** 给路径 → 尝试 SqliteStore；加载失败降级 MemoryStore。缺省纯内存（测试）。 */
  sqlitePath?: string;
  /** Electron 专属 .node 产物目录（app 根 native/；fetch-electron-sqlite.mjs 维护）。 */
  nativeDir?: string;
}

/**
 * 工厂：生产传 sqlitePath（userData/data/sessions.db）。better-sqlite3 原生模块
 * 不可用（开发机网络受限未装 / ABI 不匹配）时降级 MemoryStore + warn，不阻塞 app 启动。
 * Electron 下优先用 nativeDir 里按版本命名的专属产物（与 Node 测试产物双版共存）。
 */
export function createConversationStore(opts: CreateStoreOptions = {}): ConversationStore {
  if (!opts.sqlitePath) return new MemoryStore();
  try {
    const nativeBinding = resolveNativeBinding(
      opts.nativeDir,
      process.versions.electron,
      existsSync,
    );
    return new SqliteStore(opts.sqlitePath, nativeBinding);
  } catch (e) {
    console.warn('[db] better-sqlite3 unavailable, falling back to in-memory store:', e);
    console.warn('[db] 会话将不会持久化！请运行 pnpm --filter @openpet/desktop dev（自动下载 Electron 版 better-sqlite3）');
    return new MemoryStore();
  }
}
