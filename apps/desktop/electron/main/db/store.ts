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

/**
 * ㉔ 编译进度账本（memory_compile_state）：upto = 已整理到的消息 id（含）；pendingTo = 已锁定的
 * 待整理段终点（调 LLM 前先落库，崩溃后同一段原样重试）；retries = 该段输出类失败次数。
 */
export interface CompileStateRow {
  upto: number;
  pendingTo: number | null;
  retries: number;
  lastError: string | null;
  lastAttemptAt: number | null;
}

/** ㉔ 块级向量索引行（memory_chunk_index；model = 嵌入模型指纹 `sourceId|model`）。 */
export interface ChunkIndexRow {
  id: string;
  path: string;
  hash: string;
  model: string;
  vector: number[];
}

/** ㉔ remember 便签（memory_note）。 */
export interface MemoryNoteRow {
  id: number;
  text: string;
  createdAt: number;
}

/** ㉔ 来源日志（memory_op_log）：sessionId = null ⇒ 旧记忆迁移；消息区间 (msgFrom, msgTo]。 */
export interface MemoryOpLogInput {
  at: number;
  characterId: string;
  sessionId: string | null;
  msgFrom: number | null;
  msgTo: number | null;
  path: string;
  op: string;
  detail: string | null;
}

export interface MemoryOpLogRow extends MemoryOpLogInput {
  id: number;
}

export interface ConversationStore {
  /** 追加一条消息，立刻落库；返回行 id。 */
  appendMessage(input: AppendMessageInput): number;
  /** 最近 limit 条（角色 + 会话隔离），按 ts 升序返回。 */
  recentMessages(characterId: string, sessionId: string, limit: number): StoredRow[];
  /**
   * 批次⑥ D7：清空全部对话历史（跨角色/会话；危险操作，UI 侧 ConfirmDialog 把关）。
   * ㉔ 连带清空 session_meta——否则同名会话（首个会话都叫 'default'）重新有消息时旧摘要 /
   * 标题 / 置顶复活，摘要水位也卡在旧 id 上。编译账本与便签同清（messages.id 无 AUTOINCREMENT，
   * 清空后从 1 重新发号，旧水位会吞掉新消息）。
   */
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
  /** ⑮ 记忆域：update 操作替换 text + vector + updated_at（created_at 不动）。 */
  memoryUpdate(id: number, text: string, vector: number[], updatedAt: number): void;
  memoryList(characterId: string): Array<{
    id: number;
    text: string;
    pinned: boolean;
    createdAt: number;
    updatedAt: number | null;
  }>;
  memoryVectors(characterId: string): Array<{
    id: number;
    text: string;
    pinned: boolean;
    vector: number[];
    createdAt: number;
    updatedAt: number | null;
  }>;
  memoryDelete(id: number): void;
  memorySetPinned(id: number, pinned: boolean): void;
  memoryClear(characterId: string): void;
  /** 旧表行数（⑲ 迁移检测 + F3 横幅）。 */
  memoryCount(characterId: string): number;

  // --- ㉔ 块级向量索引（memory_chunk_index；块 id 全局唯一，user/ 块跨角色共享）---
  /** 单事务 upsert（逐批落库：中途失败已算的不丢）。 */
  chunkIndexUpsert(rows: readonly ChunkIndexRow[], updatedAt: number): void;
  chunkIndexList(): ChunkIndexRow[];
  chunkIndexDeletePath(path: string): void;
  chunkIndexDelete(ids: readonly string[]): void;
  chunkIndexClear(): void;

  // --- ㉒ 被想起的痕迹（memory_page_stats；派生数据，markdown 仍是真源）---
  /** 单事务：各页 recall_count+1、last_recalled_at = now。 */
  pageStatsBump(paths: readonly string[], now: number): void;
  pageStatsList(): Array<{ path: string; count: number; lastAt: number | null }>;
  /** 重命名迁移（目标已有行则合并计数、取较新时间）。 */
  pageStatsRename(from: string, to: string): void;
  pageStatsDelete(path: string): void;
  pageStatsClear(): void;

  // --- ⑮ 记忆域：会话滚动摘要（session_meta.summary/summary_upto）与区间读取 ---
  // ㉔ 会话元数据按 (session_id, character_id) 隔离：各角色首个会话都叫 'default'。
  sessionSummaryGet(
    characterId: string,
    sessionId: string,
  ): { summary: string | null; upto: number | null };
  /** upto 缺省不动（用户手动编辑路径以现有水位为底稿继续合并）；summary=null 清除。 */
  sessionSummarySet(
    characterId: string,
    sessionId: string,
    summary: string | null,
    upto?: number,
  ): void;
  /** (afterId, beforeOrEqId] 半开区间消息，id 升序（摘要器取「窗口外未摘要」段并推进水位）。 */
  messagesBetween(
    characterId: string,
    sessionId: string,
    afterId: number,
    beforeOrEqId: number,
  ): Array<StoredRow & { id: number }>;
  /** 会话消息总数与最大行 id（空会话 lastId=0）。 */
  messageStats(characterId: string, sessionId: string): { count: number; lastId: number };
  /** ㉔ id ≤ beforeOrEqId 的最后 limit 条，id 升序（编译器「此前对话」前情）。 */
  messagesBefore(
    characterId: string,
    sessionId: string,
    beforeOrEqId: number,
    limit: number,
  ): Array<StoredRow & { id: number }>;
  /** ㉔ id > afterId 的消息条数（编译积压）。 */
  messageCountAfter(characterId: string, sessionId: string, afterId: number): number;

  // --- ㉔ 记忆 v3：编译进度账本 / remember 便签 / 来源日志 ---
  /** 无行 → 水位 0、无待重试段。 */
  compileStateGet(characterId: string, sessionId: string): CompileStateRow;
  /** upsert：只改 patch 里给出的列。 */
  compileStatePut(characterId: string, sessionId: string, patch: Partial<CompileStateRow>): void;
  memoryNoteAdd(characterId: string, sessionId: string, text: string, createdAt: number): number;
  /** 本角色本会话的便签，id 升序。 */
  memoryNotes(characterId: string, sessionId: string): MemoryNoteRow[];
  memoryNotesDelete(ids: readonly number[]): void;
  memoryNotesClear(): void;
  opLogAdd(rows: readonly MemoryOpLogInput[]): void;
  /** 该页最近 limit 行（at 降序、同 at 按 id 升序）。 */
  opLogForPath(path: string, limit: number): MemoryOpLogRow[];
  opLogRenamePath(from: string, to: string): void;
  opLogDeletePath(path: string): void;
  opLogClear(): void;

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
  /** 删除本角色该会话全部消息 + meta + ㉔ 编译账本与便签（单事务；他角色同名会话不动）。 */
  sessionDelete(characterId: string, sessionId: string): void;
  /** 导出用全量消息（ts 升序）。 */
  sessionMessages(characterId: string, sessionId: string): StoredRow[];
  /** 会话最后一条 user 行（重试/编辑重发定位用）；无 → null。 */
  lastUserMessage(characterId: string, sessionId: string): { id: number; text: string } | null;
  /**
   * 删除本角色该会话 id ≥ fromId 的全部行（重试 = 删尾部 assistant；编辑重发 = 删整轮）。
   * ㉔ 编译账本同步：upto 夹到 fromId − 1；待重试段终点 ≥ fromId 则清掉。
   */
  deleteMessagesFrom(characterId: string, sessionId: string, fromId: number): void;

  /** 一致性快照到目标 .db 文件（SqliteStore 用 better-sqlite3 .backup；Memory 为 no-op）。 */
  backupTo(dbPath: string): Promise<void>;

  close(): void;
}
