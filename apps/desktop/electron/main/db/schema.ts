/**
 * sessions.db schema（tech-design §6 四表 + meta）。
 *
 * M6 对 §6 的扩展：messages 加 `finish_reason` 列——运行协议早已用
 * stop|cancel|error 三态（chat.done），原 §6 表遗漏此列。决策记录见
 * internal/design/tech-design.md §6 脚注。
 *
 * facts / episodes 仅建表，MVP 无业务写入方（Episodic/Semantic 记忆 V1.0 启用）。
 *
 * §5 知识库：kb_document/kb_chunk 两表（向量存 Float32 BLOB），KB 元数据走 prefs
 * kb.list。新表用 `CREATE TABLE IF NOT EXISTS` 向后兼容，故 SCHEMA_VERSION +1（→2）。
 *
 * 批次⑥：memory_fact 长期记忆（自由文本+向量+pinned，F-AI-06），additive → 3。
 *
 * 会话管理批次：session_meta（标题/置顶元数据；标题 NULL=派生），additive → 4。
 *
 * ⑮ 记忆域：memory_fact 加 `updated_at`（事实生命周期 update 落点；NULL=以 created_at 为准）；
 * session_meta 加 `summary`/`summary_upto`（会话滚动摘要 + 已覆盖消息 id 水位）。首次出现
 * **对既有表加列**——CREATE IF NOT EXISTS 不改旧表，旧库由 SqliteStore 构造时按
 * pragma table_info 条件 ALTER（见 sqlite-store.ts MIGRATE_COLUMNS），additive → 5。
 */
export const SCHEMA_VERSION = 5;

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS messages (
  id            INTEGER PRIMARY KEY,
  character_id  TEXT NOT NULL,
  session_id    TEXT NOT NULL,
  role          TEXT NOT NULL,
  text          TEXT NOT NULL,
  raw           TEXT,
  ts            INTEGER NOT NULL,
  tokens_in     INTEGER,
  tokens_out    INTEGER,
  finish_reason TEXT,
  provider      TEXT,
  model         TEXT
);
CREATE INDEX IF NOT EXISTS idx_msg_char_session_ts ON messages(character_id, session_id, ts);

CREATE TABLE IF NOT EXISTS persona_state (
  character_id TEXT PRIMARY KEY,
  blob_json    TEXT NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS facts (
  id             INTEGER PRIMARY KEY,
  character_id   TEXT NOT NULL,
  subject        TEXT,
  predicate      TEXT,
  object         TEXT,
  confidence     REAL NOT NULL,
  source_session TEXT,
  last_seen      INTEGER,
  status         TEXT
);
CREATE INDEX IF NOT EXISTS idx_facts_char ON facts(character_id, status);

CREATE TABLE IF NOT EXISTS episodes (
  id           INTEGER PRIMARY KEY,
  character_id TEXT NOT NULL,
  session_id   TEXT NOT NULL,
  summary      TEXT NOT NULL,
  ts           INTEGER NOT NULL,
  archived     INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_episodes_char ON episodes(character_id, archived);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kb_document (
  id           TEXT PRIMARY KEY,
  kb_id        TEXT NOT NULL,
  filename     TEXT NOT NULL,
  chunk_count  INTEGER NOT NULL,
  added_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kb_document_kb ON kb_document(kb_id);

CREATE TABLE IF NOT EXISTS kb_chunk (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  kb_id   TEXT NOT NULL,
  doc_id  TEXT NOT NULL,
  ord     INTEGER NOT NULL,
  text    TEXT NOT NULL,
  vector  BLOB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kb_chunk_kb ON kb_chunk(kb_id);

CREATE TABLE IF NOT EXISTS memory_fact (
  id           INTEGER PRIMARY KEY,
  character_id TEXT NOT NULL,
  text         TEXT NOT NULL,
  vector       BLOB,
  pinned       INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_memory_char ON memory_fact(character_id, pinned);

CREATE TABLE IF NOT EXISTS session_meta (
  session_id   TEXT PRIMARY KEY,
  character_id TEXT NOT NULL,
  title        TEXT,
  pinned       INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  summary      TEXT,
  summary_upto INTEGER
);
`;

/** ⑮ 记忆域旧库迁移：v4 及以前的表缺这些列，打开时按 table_info 条件 ALTER。 */
export const MIGRATE_COLUMNS: Array<{ table: string; column: string; ddl: string }> = [
  { table: 'memory_fact', column: 'updated_at', ddl: 'INTEGER' },
  { table: 'session_meta', column: 'summary', ddl: 'TEXT' },
  { table: 'session_meta', column: 'summary_upto', ddl: 'INTEGER' },
];
