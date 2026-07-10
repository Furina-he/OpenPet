/**
 * ConversationStore — 会话/状态持久化的领域仓储接口（tech-design §6）。
 *
 * 单一写者：唯一实例归 Main 的 ChatService；Worker 永不直连 DB。
 * 两个实现：SqliteStore（better-sqlite3 生产）/ MemoryStore（单测真源 + 原生不可用降级）。
 *
 * 角色隔离：所有读写都带 character_id（tech-design §6「强制前缀」）。
 */
import type { PersonaStateBlob, StorageUsage } from '@openpet/protocol';

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

/** KB chunk 行（§5 知识库；向量随行返回，喂内存余弦检索）。 */
export interface KbChunkRow {
  kbId: string;
  docId: string;
  ord: number;
  text: string;
  vector: number[];
}

/** KB 文档行（§5；元数据在 prefs kb.list，文档/分块实体在 SQLite）。 */
export interface KbDocRow {
  id: string;
  kbId: string;
  filename: string;
  chunkCount: number;
  addedAt: number;
}

export interface ConversationStore {
  /** 追加一条消息，立刻落库；返回行 id。 */
  appendMessage(input: AppendMessageInput): number;
  /** 最近 limit 条（角色 + 会话隔离），按 ts 升序返回。 */
  recentMessages(characterId: string, sessionId: string, limit: number): StoredRow[];
  /** 批次⑥ D7：清空全部对话历史（跨角色/会话；危险操作，UI 侧 ConfirmDialog 把关）。 */
  clearMessages(): void;

  getPersonaState(characterId: string): PersonaStateBlob | null;
  putPersonaState(characterId: string, blob: PersonaStateBlob, updatedAt: number): void;

  /**
   * §5 知识库：一篇文档的 chunk 批量入库 + 写入 doc 行（含 chunk_count）。
   * 向量序列化为 Float32 blob（SqliteStore）；单连接，不另开 DB。
   */
  kbInsertChunks(
    kbId: string,
    docId: string,
    filename: string,
    rows: { ord: number; text: string; vector: number[] }[],
  ): void;
  /** 指定 KB 集合的全部 chunk（含向量），用于内存余弦检索。 */
  kbChunks(kbIds: string[]): KbChunkRow[];
  /** 某 KB 的文档列表（按加入顺序）。 */
  kbDocs(kbId: string): KbDocRow[];
  /** 删除一篇文档及其全部 chunk。 */
  kbDeleteDoc(kbId: string, docId: string): void;

  /** 批次⑥ 长期记忆（memory_fact；向量 Float32 BLOB，按 characterId 隔离）。 */
  memoryInsert(characterId: string, text: string, vector: number[], createdAt: number): number;
  memoryList(
    characterId: string,
  ): Array<{ id: number; text: string; pinned: boolean; createdAt: number }>;
  memoryVectors(
    characterId: string,
  ): Array<{ id: number; text: string; pinned: boolean; vector: number[] }>;
  memoryDelete(id: number): void;
  memorySetPinned(id: number, pinned: boolean): void;
  memoryClear(characterId: string): void;

  storageUsage(): StorageUsage;
  /**
   * 批次⑥ F-AI-08：sinceTs 起的 token 用量聚合（仅 assistant 且已落 tokens 的行；
   * messages = 计入聚合的条数）。月界由调用方（ipc-router 自然月）决定。
   */
  usageSummary(sinceTs: number): { tokensIn: number; tokensOut: number; messages: number };

  // --- 总览页统计（spec 2026-07-09）；桶公式 bucketTs = floor((ts+tz)/bucket)*bucket - tz ---
  /** sinceTs 起全部消息数（user+assistant，跨角色/会话）。 */
  statsMessageCount(sinceTs: number): number;
  /** 消息数时间序列（[bucketTs, count] 升序；tzOffsetMs = 本地时区偏移，东八区 +28800000）。 */
  statsMessageSeries(
    sinceTs: number,
    bucketMs: number,
    tzOffsetMs: number,
  ): Array<[number, number]>;
  /** 按模型 token 聚合（assistant 且 tokens_out/model 非空；tokens=in+out，降序）。 */
  statsTokensByModel(sinceTs: number): Array<{ model: string; tokens: number }>;
  /** 按模型分桶 token 序列（top-N 合并由上层 stats-service 做）。 */
  statsTokenSeriesByModel(
    sinceTs: number,
    bucketMs: number,
    tzOffsetMs: number,
  ): Array<{ model: string; points: Array<[number, number]> }>;
  /** 最早一条消息 ts（陪伴天数）；空库 null。 */
  statsFirstMessageTs(): number | null;

  // --- 会话管理（spec 2026-07-09-session-management）---
  /** 当前角色会话列表（pinned 优先，再 lastTs 降序）；title=null 时上层用 firstUserText 派生。 */
  sessionList(characterId: string): Array<{
    id: string;
    title: string | null;
    pinned: boolean;
    lastText: string;
    lastTs: number;
    count: number;
    firstUserText: string | null;
  }>;
  sessionSetTitle(sessionId: string, characterId: string, title: string): void;
  sessionSetPinned(sessionId: string, characterId: string, pinned: boolean): void;
  /** 删除会话全部消息 + meta（单事务）。 */
  sessionDelete(sessionId: string): void;
  /** 导出用全量消息（ts 升序）。 */
  sessionMessages(characterId: string, sessionId: string): StoredRow[];

  /** 一致性快照到目标 .db 文件（SqliteStore 用 better-sqlite3 .backup；Memory 为 no-op）。 */
  backupTo(dbPath: string): Promise<void>;

  close(): void;
}
