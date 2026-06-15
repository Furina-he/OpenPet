import type { ConversationStore } from './store.js';
import { MemoryStore } from './memory-store.js';
import { SqliteStore } from './sqlite-store.js';

export type { ConversationStore, AppendMessageInput, StoredRow } from './store.js';
export { MemoryStore } from './memory-store.js';
export { SqliteStore, loadBetterSqlite } from './sqlite-store.js';

export interface CreateStoreOptions {
  /** 给路径 → 尝试 SqliteStore；加载失败降级 MemoryStore。缺省纯内存（测试）。 */
  sqlitePath?: string;
}

/**
 * 工厂：生产传 sqlitePath（userData/data/sessions.db）。better-sqlite3 原生模块
 * 不可用（开发机网络受限未装 / ABI 不匹配）时降级 MemoryStore + warn，不阻塞 app 启动。
 */
export function createConversationStore(opts: CreateStoreOptions = {}): ConversationStore {
  if (!opts.sqlitePath) return new MemoryStore();
  try {
    return new SqliteStore(opts.sqlitePath);
  } catch (e) {
    console.warn('[db] better-sqlite3 unavailable, falling back to in-memory store:', e);
    return new MemoryStore();
  }
}
