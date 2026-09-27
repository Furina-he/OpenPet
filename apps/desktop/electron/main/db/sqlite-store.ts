import { createRequire } from 'node:module';
import type DatabaseT from 'better-sqlite3';
import {
  PersonaStateBlobSchema,
  type PersonaStateBlob,
  type StorageUsage,
} from '@openpet/protocol';
import type {
  AppendMessageInput,
  ChunkIndexRow,
  CompileStateRow,
  ConversationStore,
  KbChunkRow,
  KbDocRow,
  MemoryNoteRow,
  MemoryOpLogInput,
  MemoryOpLogRow,
  StoredRow,
} from './store.js';
import { MIGRATE_COLUMNS, SCHEMA_SQL, SCHEMA_VERSION } from './schema.js';

const require = createRequire(import.meta.url);

/**
 * better-sqlite3 是原生模块（vite config 已 external）：运行时动态 require，
 * typecheck 仅依赖纯类型包 @types/better-sqlite3。抛错即原生不可用 → 工厂降级。
 */
export function loadBetterSqlite(): typeof DatabaseT {
  return require('better-sqlite3') as typeof DatabaseT;
}

/**
 * Electron ABI 双版共存（勾掉「双 ABI 切换未脚本化」债）：Electron 运行时若
 * native 目录里有按 electron 版本命名的专属产物（scripts/fetch-electron-sqlite.mjs
 * 在 dev 前自动下载），用 nativeBinding 指向它；Node（vitest/CI）返回 undefined
 * 走 node_modules 默认产物。两个 ABI 互不覆盖。
 */
export function resolveNativeBinding(
  nativeDir: string | undefined,
  electronVersion: string | undefined,
  exists: (p: string) => boolean,
): string | undefined {
  if (!nativeDir || !electronVersion) return undefined;
  const p = `${nativeDir.replace(/[\\/]+$/, '')}/better_sqlite3-electron-v${electronVersion}.node`;
  return exists(p) ? p : undefined;
}

/** 生产 ConversationStore：单连接 + WAL（tech-design §6「单一写者」）。 */
export class SqliteStore implements ConversationStore {
  private readonly db: DatabaseT.Database;

  constructor(dbPath: string, nativeBinding?: string) {
    const Database = loadBetterSqlite();
    this.db = nativeBinding ? new Database(dbPath, { nativeBinding }) : new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    const hadCompileState =
      this.db
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'memory_compile_state'")
        .get() !== undefined;
    this.db.exec(SCHEMA_SQL);
    // CREATE IF NOT EXISTS 不改旧表：缺列的旧库按 table_info 条件 ALTER（⑮ 记忆域起）。
    for (const m of MIGRATE_COLUMNS) {
      const cols = this.db.pragma(`table_info(${m.table})`) as Array<{ name: string }>;
      if (!cols.some((c) => c.name === m.column)) {
        this.db.exec(`ALTER TABLE ${m.table} ADD COLUMN ${m.column} ${m.ddl}`);
      }
    }
    this.migrateSessionMetaKey();
    // ㉔ 编译账本首建：存量会话一律记为「已整理到最后一条」。旧计数器下它们已被整理过大半、确切位置
    // 不可知——宁可漏掉最后不足 8 轮，也不重放整段历史（大批重复经历 + 大笔杂务模型费用）。
    if (!hadCompileState) {
      this.db.exec(`INSERT OR IGNORE INTO memory_compile_state(character_id, session_id, upto)
        SELECT character_id, session_id, MAX(id) FROM messages GROUP BY character_id, session_id`);
    }
    this.db
      .prepare('INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)')
      .run('schema_version', String(SCHEMA_VERSION));
  }

  /**
   * ㉔ v7 → v8：session_meta 单列主键（session_id）→ (session_id, character_id)。SQLite 不能改主键，
   * 事务内改名 → 建新表 → 原样拷行 → 删旧表。原行归属它记录的 character_id；其他角色在同名会话上的
   * 标题 / 置顶 / 摘要回到空（那本来就是串过去的）。须在 MIGRATE_COLUMNS 补列之后跑（旧库列齐）。
   */
  private migrateSessionMetaKey(): void {
    const cols = this.db.pragma('table_info(session_meta)') as Array<{ name: string; pk: number }>;
    const pk = cols.filter((c) => c.pk > 0).map((c) => c.name);
    if (pk.length !== 1 || pk[0] !== 'session_id') return;
    this.db.transaction(() => {
      this.db.exec(`
        ALTER TABLE session_meta RENAME TO session_meta_v7;
        CREATE TABLE session_meta (
          session_id   TEXT NOT NULL,
          character_id TEXT NOT NULL,
          title        TEXT,
          pinned       INTEGER NOT NULL DEFAULT 0,
          created_at   INTEGER NOT NULL,
          summary      TEXT,
          summary_upto INTEGER,
          PRIMARY KEY (session_id, character_id)
        );
        INSERT INTO session_meta(session_id, character_id, title, pinned, created_at, summary, summary_upto)
          SELECT session_id, character_id, title, pinned, created_at, summary, summary_upto FROM session_meta_v7;
        DROP TABLE session_meta_v7;
      `);
    })();
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

  clearMessages(): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM messages').run();
      this.db.prepare('DELETE FROM session_meta').run();
      this.db.prepare('DELETE FROM memory_compile_state').run();
      this.db.prepare('DELETE FROM memory_note').run();
    })();
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

  kbInsertChunks(
    kbId: string,
    docId: string,
    filename: string,
    rows: { ord: number; text: string; vector: number[] }[],
  ): void {
    const insChunk = this.db.prepare(
      'INSERT INTO kb_chunk(kb_id, doc_id, ord, text, vector) VALUES (?, ?, ?, ?, ?)',
    );
    const insDoc = this.db.prepare(
      'INSERT INTO kb_document(id, kb_id, filename, chunk_count, added_at) VALUES (?, ?, ?, ?, ?)',
    );
    const tx = this.db.transaction(() => {
      for (const r of rows) {
        const buf = Buffer.from(new Float32Array(r.vector).buffer);
        insChunk.run(kbId, docId, r.ord, r.text, buf);
      }
      insDoc.run(docId, kbId, filename, rows.length, Date.now());
    });
    tx();
  }

  kbChunks(kbIds: string[]): KbChunkRow[] {
    if (kbIds.length === 0) return [];
    const placeholders = kbIds.map(() => '?').join(', ');
    const rows = this.db
      .prepare(
        `SELECT kb_id AS kbId, doc_id AS docId, ord, text, vector
         FROM kb_chunk WHERE kb_id IN (${placeholders}) ORDER BY id ASC`,
      )
      .all(...kbIds) as Array<{
      kbId: string;
      docId: string;
      ord: number;
      text: string;
      vector: Buffer;
    }>;
    return rows.map((r) => ({
      kbId: r.kbId,
      docId: r.docId,
      ord: r.ord,
      text: r.text,
      vector: Array.from(
        new Float32Array(r.vector.buffer, r.vector.byteOffset, r.vector.byteLength / 4),
      ),
    }));
  }

  kbDocs(kbId: string): KbDocRow[] {
    return this.db
      .prepare(
        `SELECT id, kb_id AS kbId, filename, chunk_count AS chunkCount, added_at AS addedAt
         FROM kb_document WHERE kb_id = ? ORDER BY added_at ASC, rowid ASC`,
      )
      .all(kbId) as KbDocRow[];
  }

  kbDeleteDoc(kbId: string, docId: string): void {
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM kb_chunk WHERE kb_id = ? AND doc_id = ?').run(kbId, docId);
      this.db.prepare('DELETE FROM kb_document WHERE kb_id = ? AND id = ?').run(kbId, docId);
    });
    tx();
  }

  // --- 批次⑥ 长期记忆（memory_fact；向量 Float32 BLOB 编解码同 kb_chunk）---
  memoryInsert(characterId: string, text: string, vector: number[], createdAt: number): number {
    const buf = vector.length > 0 ? Buffer.from(new Float32Array(vector).buffer) : null;
    const info = this.db
      .prepare(
        'INSERT INTO memory_fact(character_id, text, vector, pinned, created_at) VALUES (?, ?, ?, 0, ?)',
      )
      .run(characterId, text, buf, createdAt);
    return Number(info.lastInsertRowid);
  }

  memoryUpdate(id: number, text: string, vector: number[], updatedAt: number): void {
    const buf = vector.length > 0 ? Buffer.from(new Float32Array(vector).buffer) : null;
    this.db
      .prepare('UPDATE memory_fact SET text = ?, vector = ?, updated_at = ? WHERE id = ?')
      .run(text, buf, updatedAt, id);
  }

  memoryList(characterId: string): Array<{
    id: number;
    text: string;
    pinned: boolean;
    createdAt: number;
    updatedAt: number | null;
  }> {
    const rows = this.db
      .prepare(
        `SELECT id, text, pinned, created_at AS createdAt, updated_at AS updatedAt
         FROM memory_fact WHERE character_id = ? ORDER BY id ASC`,
      )
      .all(characterId) as Array<{
      id: number;
      text: string;
      pinned: number;
      createdAt: number;
      updatedAt: number | null;
    }>;
    return rows.map((r) => ({ ...r, pinned: r.pinned === 1 }));
  }

  memoryVectors(characterId: string): Array<{
    id: number;
    text: string;
    pinned: boolean;
    vector: number[];
    createdAt: number;
    updatedAt: number | null;
  }> {
    const rows = this.db
      .prepare(
        `SELECT id, text, pinned, vector, created_at AS createdAt, updated_at AS updatedAt
         FROM memory_fact WHERE character_id = ?`,
      )
      .all(characterId) as Array<{
      id: number;
      text: string;
      pinned: number;
      vector: Buffer | null;
      createdAt: number;
      updatedAt: number | null;
    }>;
    return rows.map((r) => ({
      id: r.id,
      text: r.text,
      pinned: r.pinned === 1,
      vector: r.vector
        ? Array.from(
            new Float32Array(r.vector.buffer, r.vector.byteOffset, r.vector.byteLength / 4),
          )
        : [],
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  memoryDelete(id: number): void {
    this.db.prepare('DELETE FROM memory_fact WHERE id = ?').run(id);
  }

  memorySetPinned(id: number, pinned: boolean): void {
    this.db.prepare('UPDATE memory_fact SET pinned = ? WHERE id = ?').run(pinned ? 1 : 0, id);
  }

  memoryClear(characterId: string): void {
    this.db.prepare('DELETE FROM memory_fact WHERE character_id = ?').run(characterId);
  }

  memoryCount(characterId: string): number {
    const r = this.db
      .prepare('SELECT COUNT(*) AS n FROM memory_fact WHERE character_id = ?')
      .get(characterId) as { n: number };
    return r.n;
  }

  // --- ㉔ 块级向量索引 ---
  chunkIndexUpsert(rows: readonly ChunkIndexRow[], updatedAt: number): void {
    const stmt = this.db.prepare(
      `INSERT INTO memory_chunk_index(id, path, hash, model, vector, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET path = excluded.path, hash = excluded.hash,
         model = excluded.model, vector = excluded.vector, updated_at = excluded.updated_at`,
    );
    this.db.transaction((xs: readonly ChunkIndexRow[]) => {
      for (const r of xs) {
        const buf = r.vector.length > 0 ? Buffer.from(new Float32Array(r.vector).buffer) : null;
        stmt.run(r.id, r.path, r.hash, r.model, buf, updatedAt);
      }
    })(rows);
  }

  chunkIndexList(): ChunkIndexRow[] {
    const rows = this.db
      .prepare('SELECT id, path, hash, model, vector FROM memory_chunk_index ORDER BY id ASC')
      .all() as Array<{ id: string; path: string; hash: string; model: string; vector: Buffer | null }>;
    return rows.map((r) => ({
      id: r.id,
      path: r.path,
      hash: r.hash,
      model: r.model,
      vector: r.vector
        ? Array.from(
            new Float32Array(r.vector.buffer, r.vector.byteOffset, r.vector.byteLength / 4),
          )
        : [],
    }));
  }

  chunkIndexDeletePath(path: string): void {
    this.db.prepare('DELETE FROM memory_chunk_index WHERE path = ?').run(path);
  }

  chunkIndexDelete(ids: readonly string[]): void {
    const stmt = this.db.prepare('DELETE FROM memory_chunk_index WHERE id = ?');
    this.db.transaction((xs: readonly string[]) => {
      for (const id of xs) stmt.run(id);
    })(ids);
  }

  chunkIndexClear(): void {
    this.db.prepare('DELETE FROM memory_chunk_index').run();
  }

  // --- ㉒ 被想起的痕迹 ---
  pageStatsBump(paths: readonly string[], now: number): void {
    const stmt = this.db.prepare(
      `INSERT INTO memory_page_stats(path, recall_count, last_recalled_at) VALUES (?, 1, ?)
       ON CONFLICT(path) DO UPDATE SET recall_count = recall_count + 1,
         last_recalled_at = excluded.last_recalled_at`,
    );
    this.db.transaction((ps: readonly string[]) => {
      for (const p of ps) stmt.run(p, now);
    })(paths);
  }

  pageStatsList(): Array<{ path: string; count: number; lastAt: number | null }> {
    return this.db
      .prepare(
        'SELECT path, recall_count AS count, last_recalled_at AS lastAt FROM memory_page_stats ORDER BY path ASC',
      )
      .all() as Array<{ path: string; count: number; lastAt: number | null }>;
  }

  pageStatsRename(from: string, to: string): void {
    if (from === to) return;
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO memory_page_stats(path, recall_count, last_recalled_at)
           SELECT ?, recall_count, last_recalled_at FROM memory_page_stats WHERE path = ?
           ON CONFLICT(path) DO UPDATE SET recall_count = recall_count + excluded.recall_count,
             last_recalled_at = MAX(COALESCE(last_recalled_at, 0), COALESCE(excluded.last_recalled_at, 0))`,
        )
        .run(to, from);
      this.db.prepare('DELETE FROM memory_page_stats WHERE path = ?').run(from);
    })();
  }

  pageStatsDelete(path: string): void {
    this.db.prepare('DELETE FROM memory_page_stats WHERE path = ?').run(path);
  }

  pageStatsClear(): void {
    this.db.prepare('DELETE FROM memory_page_stats').run();
  }

  storageUsage(): StorageUsage {
    const msg = this.db.prepare('SELECT COUNT(*) AS n FROM messages').get() as { n: number };
    const chr = this.db.prepare('SELECT COUNT(DISTINCT character_id) AS n FROM messages').get() as {
      n: number;
    };
    const pages = this.db.pragma('page_count', { simple: true }) as number;
    const pageSize = this.db.pragma('page_size', { simple: true }) as number;
    return { dbBytes: pages * pageSize, messageCount: msg.n, characterCount: chr.n };
  }

  usageSummary(sinceTs: number): { tokensIn: number; tokensOut: number; messages: number } {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(tokens_in), 0) AS tokensIn,
                COALESCE(SUM(tokens_out), 0) AS tokensOut,
                COUNT(*) AS messages
         FROM messages WHERE role = 'assistant' AND ts >= ? AND tokens_out IS NOT NULL`,
      )
      .get(sinceTs) as { tokensIn: number; tokensOut: number; messages: number };
    return row;
  }

  // --- 总览页统计（spec 2026-07-09）；SQLite 整数 `/` = 整除（epoch 正数下同 floor）---
  statsMessageCount(sinceTs: number): number {
    const r = this.db.prepare('SELECT COUNT(*) AS n FROM messages WHERE ts >= ?').get(sinceTs) as {
      n: number;
    };
    return r.n;
  }

  statsMessageSeries(
    sinceTs: number,
    bucketMs: number,
    tzOffsetMs: number,
  ): Array<[number, number]> {
    const rows = this.db
      .prepare(
        `SELECT CAST((ts + @tz) / @bucket AS INTEGER) * @bucket - @tz AS b, COUNT(*) AS n
         FROM messages WHERE ts >= @since GROUP BY b ORDER BY b`,
      )
      .all({ tz: tzOffsetMs, bucket: bucketMs, since: sinceTs }) as Array<{ b: number; n: number }>;
    return rows.map((r) => [r.b, r.n]);
  }

  statsTokensByModel(sinceTs: number): Array<{ model: string; tokens: number }> {
    return this.db
      .prepare(
        `SELECT model, SUM(COALESCE(tokens_in,0)+COALESCE(tokens_out,0)) AS tokens
         FROM messages
         WHERE ts >= ? AND role = 'assistant' AND tokens_out IS NOT NULL AND model IS NOT NULL
         GROUP BY model ORDER BY tokens DESC`,
      )
      .all(sinceTs) as Array<{ model: string; tokens: number }>;
  }

  statsTokenSeriesByModel(
    sinceTs: number,
    bucketMs: number,
    tzOffsetMs: number,
  ): Array<{ model: string; points: Array<[number, number]> }> {
    const rows = this.db
      .prepare(
        `SELECT model, CAST((ts + @tz) / @bucket AS INTEGER) * @bucket - @tz AS b,
                SUM(COALESCE(tokens_in,0)+COALESCE(tokens_out,0)) AS tokens
         FROM messages
         WHERE ts >= @since AND role = 'assistant' AND tokens_out IS NOT NULL AND model IS NOT NULL
         GROUP BY model, b ORDER BY model, b`,
      )
      .all({ tz: tzOffsetMs, bucket: bucketMs, since: sinceTs }) as Array<{
      model: string;
      b: number;
      tokens: number;
    }>;
    const acc = new Map<string, Array<[number, number]>>();
    for (const r of rows) {
      const list = acc.get(r.model) ?? [];
      list.push([r.b, r.tokens]);
      acc.set(r.model, list);
    }
    return [...acc.entries()].map(([model, points]) => ({ model, points }));
  }

  statsFirstMessageTs(): number | null {
    const r = this.db.prepare('SELECT MIN(ts) AS t FROM messages').get() as { t: number | null };
    return r.t;
  }

  // --- 会话管理（spec 2026-07-09-session-management）---
  sessionList(characterId: string): Array<{
    id: string;
    title: string | null;
    pinned: boolean;
    lastText: string;
    lastTs: number;
    count: number;
    firstUserText: string | null;
  }> {
    const rows = this.db
      .prepare(
        `SELECT m.session_id AS id,
                sm.title AS title,
                COALESCE(sm.pinned, 0) AS pinnedInt,
                (SELECT text FROM messages WHERE session_id = m.session_id AND character_id = m.character_id
                 ORDER BY ts DESC, id DESC LIMIT 1) AS lastText,
                MAX(m.ts) AS lastTs,
                COUNT(*) AS count,
                (SELECT text FROM messages WHERE session_id = m.session_id AND character_id = m.character_id
                 AND role = 'user' ORDER BY ts ASC, id ASC LIMIT 1) AS firstUserText
         FROM messages m
         LEFT JOIN session_meta sm ON sm.session_id = m.session_id AND sm.character_id = m.character_id
         WHERE m.character_id = ?
         GROUP BY m.session_id
         ORDER BY pinnedInt DESC, lastTs DESC`,
      )
      .all(characterId) as Array<{
      id: string;
      title: string | null;
      pinnedInt: number;
      lastText: string;
      lastTs: number;
      count: number;
      firstUserText: string | null;
    }>;
    return rows.map((r) => ({
      id: r.id,
      title: r.title ?? null,
      pinned: r.pinnedInt === 1,
      lastText: r.lastText,
      lastTs: r.lastTs,
      count: r.count,
      firstUserText: r.firstUserText ?? null,
    }));
  }

  sessionSetTitle(sessionId: string, characterId: string, title: string): void {
    this.db
      .prepare(
        `INSERT INTO session_meta(session_id, character_id, title, pinned, created_at)
         VALUES (?, ?, ?, 0, ?)
         ON CONFLICT(session_id, character_id) DO UPDATE SET title = excluded.title`,
      )
      .run(sessionId, characterId, title, Date.now());
  }

  sessionSetPinned(sessionId: string, characterId: string, pinned: boolean): void {
    this.db
      .prepare(
        `INSERT INTO session_meta(session_id, character_id, title, pinned, created_at)
         VALUES (?, ?, NULL, ?, ?)
         ON CONFLICT(session_id, character_id) DO UPDATE SET pinned = excluded.pinned`,
      )
      .run(sessionId, characterId, pinned ? 1 : 0, Date.now());
  }

  sessionDelete(characterId: string, sessionId: string): void {
    const tx = this.db.transaction(() => {
      this.db
        .prepare('DELETE FROM messages WHERE character_id = ? AND session_id = ?')
        .run(characterId, sessionId);
      this.db
        .prepare('DELETE FROM session_meta WHERE character_id = ? AND session_id = ?')
        .run(characterId, sessionId);
      this.db
        .prepare('DELETE FROM memory_compile_state WHERE character_id = ? AND session_id = ?')
        .run(characterId, sessionId);
      this.db
        .prepare('DELETE FROM memory_note WHERE character_id = ? AND session_id = ?')
        .run(characterId, sessionId);
    });
    tx();
  }

  sessionMessages(characterId: string, sessionId: string): StoredRow[] {
    return this.db
      .prepare(
        `SELECT role, text, finish_reason AS finishReason, ts, tokens_in AS tokensIn, tokens_out AS tokensOut
         FROM messages WHERE character_id = ? AND session_id = ? ORDER BY ts ASC, id ASC`,
      )
      .all(characterId, sessionId) as StoredRow[];
  }

  lastUserMessage(characterId: string, sessionId: string): { id: number; text: string } | null {
    const row = this.db
      .prepare(
        `SELECT id, text FROM messages WHERE character_id = ? AND session_id = ? AND role = 'user'
         ORDER BY id DESC LIMIT 1`,
      )
      .get(characterId, sessionId) as { id: number; text: string } | undefined;
    return row ?? null;
  }

  deleteMessagesFrom(characterId: string, sessionId: string, fromId: number): void {
    this.db.transaction(() => {
      this.db
        .prepare('DELETE FROM messages WHERE character_id = ? AND session_id = ? AND id >= ?')
        .run(characterId, sessionId, fromId);
      this.db
        .prepare(
          `UPDATE memory_compile_state SET upto = MIN(upto, ?),
             retries = CASE WHEN pending_to >= ? THEN 0 ELSE retries END,
             pending_to = CASE WHEN pending_to >= ? THEN NULL ELSE pending_to END
           WHERE character_id = ? AND session_id = ?`,
        )
        .run(fromId - 1, fromId, fromId, characterId, sessionId);
    })();
  }

  // --- ⑮ 记忆域：会话滚动摘要 + 区间读取 ---
  sessionSummaryGet(
    characterId: string,
    sessionId: string,
  ): { summary: string | null; upto: number | null } {
    const row = this.db
      .prepare(
        'SELECT summary, summary_upto AS upto FROM session_meta WHERE session_id = ? AND character_id = ?',
      )
      .get(sessionId, characterId) as { summary: string | null; upto: number | null } | undefined;
    return { summary: row?.summary ?? null, upto: row?.upto ?? null };
  }

  sessionSummarySet(
    characterId: string,
    sessionId: string,
    summary: string | null,
    upto?: number,
  ): void {
    if (upto === undefined) {
      this.db
        .prepare(
          `INSERT INTO session_meta(session_id, character_id, title, pinned, created_at, summary)
           VALUES (?, ?, NULL, 0, ?, ?)
           ON CONFLICT(session_id, character_id) DO UPDATE SET summary = excluded.summary`,
        )
        .run(sessionId, characterId, Date.now(), summary);
    } else {
      this.db
        .prepare(
          `INSERT INTO session_meta(session_id, character_id, title, pinned, created_at, summary, summary_upto)
           VALUES (?, ?, NULL, 0, ?, ?, ?)
           ON CONFLICT(session_id, character_id) DO UPDATE SET summary = excluded.summary, summary_upto = excluded.summary_upto`,
        )
        .run(sessionId, characterId, Date.now(), summary, upto);
    }
  }

  messagesBetween(
    characterId: string,
    sessionId: string,
    afterId: number,
    beforeOrEqId: number,
  ): Array<StoredRow & { id: number }> {
    return this.db
      .prepare(
        `SELECT id, role, text, finish_reason AS finishReason, ts, tokens_in AS tokensIn, tokens_out AS tokensOut
         FROM messages WHERE character_id = ? AND session_id = ? AND id > ? AND id <= ?
         ORDER BY id ASC`,
      )
      .all(characterId, sessionId, afterId, beforeOrEqId) as Array<StoredRow & { id: number }>;
  }

  messageStats(characterId: string, sessionId: string): { count: number; lastId: number } {
    return this.db
      .prepare(
        `SELECT COUNT(*) AS count, COALESCE(MAX(id), 0) AS lastId FROM messages
         WHERE character_id = ? AND session_id = ?`,
      )
      .get(characterId, sessionId) as { count: number; lastId: number };
  }

  messagesBefore(
    characterId: string,
    sessionId: string,
    beforeOrEqId: number,
    limit: number,
  ): Array<StoredRow & { id: number }> {
    const rows = this.db
      .prepare(
        `SELECT id, role, text, finish_reason AS finishReason, ts, tokens_in AS tokensIn, tokens_out AS tokensOut
         FROM messages WHERE character_id = ? AND session_id = ? AND id <= ?
         ORDER BY id DESC LIMIT ?`,
      )
      .all(characterId, sessionId, beforeOrEqId, limit) as Array<StoredRow & { id: number }>;
    return rows.reverse();
  }

  messageCountAfter(characterId: string, sessionId: string, afterId: number): number {
    return (
      this.db
        .prepare(
          'SELECT COUNT(*) AS n FROM messages WHERE character_id = ? AND session_id = ? AND id > ?',
        )
        .get(characterId, sessionId, afterId) as { n: number }
    ).n;
  }

  // --- ㉔ 记忆 v3：编译账本 / 便签 / 来源日志 ---
  compileStateGet(characterId: string, sessionId: string): CompileStateRow {
    const row = this.db
      .prepare(
        `SELECT upto, pending_to AS pendingTo, retries, last_error AS lastError,
                last_attempt_at AS lastAttemptAt
         FROM memory_compile_state WHERE character_id = ? AND session_id = ?`,
      )
      .get(characterId, sessionId) as CompileStateRow | undefined;
    return row ?? { upto: 0, pendingTo: null, retries: 0, lastError: null, lastAttemptAt: null };
  }

  compileStatePut(characterId: string, sessionId: string, patch: Partial<CompileStateRow>): void {
    const next = { ...this.compileStateGet(characterId, sessionId), ...patch };
    this.db
      .prepare(
        `INSERT INTO memory_compile_state
           (character_id, session_id, upto, pending_to, retries, last_error, last_attempt_at)
         VALUES (@cid, @sid, @upto, @pendingTo, @retries, @lastError, @lastAttemptAt)
         ON CONFLICT(character_id, session_id) DO UPDATE SET upto = excluded.upto,
           pending_to = excluded.pending_to, retries = excluded.retries,
           last_error = excluded.last_error, last_attempt_at = excluded.last_attempt_at`,
      )
      .run({ cid: characterId, sid: sessionId, ...next });
  }

  memoryNoteAdd(characterId: string, sessionId: string, text: string, createdAt: number): number {
    const info = this.db
      .prepare(
        'INSERT INTO memory_note(character_id, session_id, text, created_at) VALUES (?, ?, ?, ?)',
      )
      .run(characterId, sessionId, text, createdAt);
    return Number(info.lastInsertRowid);
  }

  memoryNotes(characterId: string, sessionId: string): MemoryNoteRow[] {
    return this.db
      .prepare(
        `SELECT id, text, created_at AS createdAt FROM memory_note
         WHERE character_id = ? AND session_id = ? ORDER BY id ASC`,
      )
      .all(characterId, sessionId) as MemoryNoteRow[];
  }

  memoryNotesDelete(ids: readonly number[]): void {
    const stmt = this.db.prepare('DELETE FROM memory_note WHERE id = ?');
    this.db.transaction((xs: readonly number[]) => {
      for (const id of xs) stmt.run(id);
    })(ids);
  }

  memoryNotesClear(): void {
    this.db.prepare('DELETE FROM memory_note').run();
  }

  opLogAdd(rows: readonly MemoryOpLogInput[]): void {
    const stmt = this.db.prepare(
      `INSERT INTO memory_op_log(at, character_id, session_id, msg_from, msg_to, path, op, detail)
       VALUES (@at, @characterId, @sessionId, @msgFrom, @msgTo, @path, @op, @detail)`,
    );
    this.db.transaction((xs: readonly MemoryOpLogInput[]) => {
      for (const x of xs) stmt.run(x);
    })(rows);
  }

  opLogForPath(path: string, limit: number): MemoryOpLogRow[] {
    return this.db
      .prepare(
        `SELECT id, at, character_id AS characterId, session_id AS sessionId, msg_from AS msgFrom,
                msg_to AS msgTo, path, op, detail
         FROM memory_op_log WHERE path = ? ORDER BY at DESC, id ASC LIMIT ?`,
      )
      .all(path, limit) as MemoryOpLogRow[];
  }

  opLogRenamePath(from: string, to: string): void {
    this.db.prepare('UPDATE memory_op_log SET path = ? WHERE path = ?').run(to, from);
  }

  opLogDeletePath(path: string): void {
    this.db.prepare('DELETE FROM memory_op_log WHERE path = ?').run(path);
  }

  opLogClear(): void {
    this.db.prepare('DELETE FROM memory_op_log').run();
  }

  async backupTo(dbPath: string): Promise<void> {
    await this.db.backup(dbPath); // 一致性在线快照
  }

  close(): void {
    this.db.close();
  }
}
