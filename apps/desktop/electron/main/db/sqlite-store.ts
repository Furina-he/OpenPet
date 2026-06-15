import { createRequire } from 'node:module';
import type DatabaseT from 'better-sqlite3';
import { PersonaStateBlobSchema, type PersonaStateBlob, type StorageUsage } from '@desksoul/protocol';
import type { AppendMessageInput, ConversationStore, StoredRow } from './store.js';
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema.js';

const require = createRequire(import.meta.url);

/**
 * better-sqlite3 是原生模块（vite config 已 external）：运行时动态 require，
 * typecheck 仅依赖纯类型包 @types/better-sqlite3。抛错即原生不可用 → 工厂降级。
 */
export function loadBetterSqlite(): typeof DatabaseT {
  return require('better-sqlite3') as typeof DatabaseT;
}

/** 生产 ConversationStore：单连接 + WAL（tech-design §6「单一写者」）。 */
export class SqliteStore implements ConversationStore {
  private readonly db: DatabaseT.Database;

  constructor(dbPath: string) {
    const Database = loadBetterSqlite();
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA_SQL);
    this.db
      .prepare('INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)')
      .run('schema_version', String(SCHEMA_VERSION));
  }

  appendMessage(input: AppendMessageInput): number {
    const info = this.db
      .prepare(
        `INSERT INTO messages
         (character_id, session_id, role, text, raw, ts, tokens_in, tokens_out, finish_reason, provider, model)
         VALUES (@characterId, @sessionId, @role, @text, @raw, @ts, @tokensIn, @tokensOut, @finishReason, @provider, @model)`,
      )
      .run({
        characterId: input.characterId,
        sessionId: input.sessionId,
        role: input.role,
        text: input.text,
        raw: input.raw ?? null,
        ts: input.ts,
        tokensIn: input.tokensIn ?? null,
        tokensOut: input.tokensOut ?? null,
        finishReason: input.finishReason ?? null,
        provider: input.provider ?? null,
        model: input.model ?? null,
      });
    return Number(info.lastInsertRowid);
  }

  recentMessages(characterId: string, sessionId: string, limit: number): StoredRow[] {
    const rows = this.db
      .prepare(
        `SELECT role, text, finish_reason AS finishReason, ts, tokens_in AS tokensIn, tokens_out AS tokensOut
         FROM messages WHERE character_id = ? AND session_id = ?
         ORDER BY ts DESC, id DESC LIMIT ?`,
      )
      .all(characterId, sessionId, limit) as StoredRow[];
    return rows.reverse(); // 回到 ts 升序
  }

  getPersonaState(characterId: string): PersonaStateBlob | null {
    const row = this.db
      .prepare('SELECT blob_json AS blob FROM persona_state WHERE character_id = ?')
      .get(characterId) as { blob: string } | undefined;
    if (!row) return null;
    const parsed = PersonaStateBlobSchema.safeParse(JSON.parse(row.blob));
    return parsed.success ? parsed.data : null;
  }

  putPersonaState(characterId: string, blob: PersonaStateBlob, updatedAt: number): void {
    this.db
      .prepare(
        `INSERT INTO persona_state(character_id, blob_json, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(character_id) DO UPDATE SET blob_json = excluded.blob_json, updated_at = excluded.updated_at`,
      )
      .run(characterId, JSON.stringify(blob), updatedAt);
  }

  storageUsage(): StorageUsage {
    const msg = this.db.prepare('SELECT COUNT(*) AS n FROM messages').get() as { n: number };
    const chr = this.db
      .prepare('SELECT COUNT(DISTINCT character_id) AS n FROM messages')
      .get() as { n: number };
    const pages = this.db.pragma('page_count', { simple: true }) as number;
    const pageSize = this.db.pragma('page_size', { simple: true }) as number;
    return { dbBytes: pages * pageSize, messageCount: msg.n, characterCount: chr.n };
  }

  async backupTo(dbPath: string): Promise<void> {
    await this.db.backup(dbPath); // 一致性在线快照
  }

  close(): void {
    this.db.close();
  }
}
