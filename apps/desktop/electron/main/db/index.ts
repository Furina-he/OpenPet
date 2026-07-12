import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { ConversationStore } from './store.js';
import { MemoryStore } from './memory-store.js';
import { SqliteStore, resolveNativeBinding } from './sqlite-store.js';

export type { ConversationStore, AppendMessageInput, StoredRow, KbChunkRow, KbDocRow } from './store.js';
export { MemoryStore } from './memory-store.js';
export { SqliteStore, loadBetterSqlite } from './sqlite-store.js';

export interface CreateStoreOptions {
  /** 给路径 → 尝试 SqliteStore；加载失败降级 MemoryStore。缺省纯内存（测试）。 */
  sqlitePath?: string;
  /** Electron 专属 .node 产物目录（dev=app 根 native/；打包=resources/native）。 */
  nativeDir?: string;
  /**
   * 打包版失败即响（⑪ 发布批次 P0）：native 产物缺失或加载失败 = 调 onFatal 后 throw，
   * 绝不静默降级内存库——那等于用户数据丢失事故。dev（false/缺省）保持降级告警。
   */
  requireNative?: boolean;
  /** requireNative 失败时的响法（Main 装配 dialog.showErrorBox + app.exit）。 */
  onFatal?: (message: string) => void;
  /** 注入 electron 版本（缺省 process.versions.electron；单测用）。 */
  electronVersion?: string;
}

/**
 * 工厂：生产传 sqlitePath（userData/data/sessions.db）。better-sqlite3 原生模块
 * 不可用（开发机网络受限未装 / ABI 不匹配）时：dev 降级 MemoryStore + warn 不阻塞；
 * 打包（requireNative）失败即响。Electron 下优先用 nativeDir 里按版本命名的专属产物
 * （与 Node 测试产物双版共存）。
 */
export function createConversationStore(opts: CreateStoreOptions = {}): ConversationStore {
  if (!opts.sqlitePath) return new MemoryStore();
  const electronVersion = opts.electronVersion ?? process.versions.electron;
  const nativeBinding = resolveNativeBinding(opts.nativeDir, electronVersion, existsSync);
  if (opts.requireNative && !nativeBinding) {
    const msg =
      `better-sqlite3 native 产物缺失：${opts.nativeDir ?? '(未提供 nativeDir)'} 下没有 ` +
      `better_sqlite3-electron-v${electronVersion ?? '?'}.node。安装包损坏或打包配置错误，` +
      `会话/记忆将无法保存，应用即将退出。请重新安装。`;
    opts.onFatal?.(msg);
    throw new Error(msg);
  }
  try {
    mkdirSync(path.dirname(opts.sqlitePath), { recursive: true });
    return new SqliteStore(opts.sqlitePath, nativeBinding);
  } catch (e) {
    if (opts.requireNative) {
      const msg =
        `better-sqlite3 加载失败（${String(e)}）。会话/记忆将无法保存，应用即将退出。` +
        `请重新安装；若反复出现请携带此信息反馈。`;
      opts.onFatal?.(msg);
      throw new Error(msg);
    }
    console.warn('[db] better-sqlite3 unavailable, falling back to in-memory store:', e);
    console.warn('[db] 会话将不会持久化！请运行 pnpm --filter @openpet/desktop dev（自动下载 Electron 版 better-sqlite3）');
    return new MemoryStore();
  }
}
