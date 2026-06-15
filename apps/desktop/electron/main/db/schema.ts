/**
 * sessions.db schema（tech-design §6 四表 + meta）。
 *
 * M6 对 §6 的扩展：messages 加 `finish_reason` 列——运行协议早已用
 * stop|cancel|error 三态（chat.done），原 §6 表遗漏此列。决策记录见
 * docs/plans/2026-05-01-desksoul-tech-design.md §6 脚注。
 *
 * facts / episodes 仅建表，MVP 无业务写入方（Episodic/Semantic 记忆 V1.0 启用）。
 */
export const SCHEMA_VERSION = 1;

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
`;
