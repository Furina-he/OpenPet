/**
 * ConversationStore — 会话/状态持久化的领域仓储接口（tech-design §6）。
 *
 * 单一写者：唯一实例归 Main 的 ChatService；Worker 永不直连 DB。
 * 两个实现：SqliteStore（better-sqlite3 生产）/ MemoryStore（单测真源 + 原生不可用降级）。
 *
 * 角色隔离：所有读写都带 character_id（tech-design §6「强制前缀」）。
 */
import type { PersonaStateBlob, StorageUsage } from '@desksoul/protocol';

export interface AppendMessageInput {
  characterId: string;
  sessionId: string;
  role: 'user' | 'assistant';
  text: string;
  ts: number;
  raw?: string | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
  finishReason?: 'stop' | 'cancel' | 'error' | null;
  provider?: string | null;
  model?: string | null;
}

export interface StoredRow {
  role: 'user' | 'assistant';
  text: string;
  finishReason: 'stop' | 'cancel' | 'error' | null;
  ts: number;
  tokensIn: number | null;
  tokensOut: number | null;
}

export interface ConversationStore {
  /** 追加一条消息，立刻落库；返回行 id。 */
  appendMessage(input: AppendMessageInput): number;
  /** 最近 limit 条（角色 + 会话隔离），按 ts 升序返回。 */
  recentMessages(characterId: string, sessionId: string, limit: number): StoredRow[];

  getPersonaState(characterId: string): PersonaStateBlob | null;
  putPersonaState(characterId: string, blob: PersonaStateBlob, updatedAt: number): void;

  storageUsage(): StorageUsage;
  /** 一致性快照到目标 .db 文件（SqliteStore 用 better-sqlite3 .backup；Memory 为 no-op）。 */
  backupTo(dbPath: string): Promise<void>;

  close(): void;
}
