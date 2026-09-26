import { createRequire } from 'node:module';
import type DatabaseT from 'better-sqlite3';
import {
  PersonaStateBlobSchema,
  type PersonaStateBlob,
  type StorageUsage,
} from '@openpet/protocol';
import type {
  AppendMessageInput,
  ConversationStore,
  KbChunkRow,
  KbDocRow,
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
    this.db.exec(SCHEMA_SQL);
    // CREATE IF NOT EXISTS 不改旧表：缺列的旧库按 table_info 条件 ALTER（⑮ 记忆域起）。
    for (const m of MIGRATE_COLUMNS) {
      const cols = this.db.pragma(`table_info(${m.table})`) as Array<{ name: string }>;
      if (!cols.some((c) => c.name === m.column)) {
        this.db.exec(`ALTER TABLE ${m.table} ADD COLUMN ${m.column} ${m.ddl}`);
      }
    }
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

  clearMessages(): void {
    this.db.prepare('DELETE FROM messages').run();
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

  // --- ⑲ 记忆 v2：wiki 页级向量索引（㉒ 带模型指纹）---
  pageIndexUpsert(
    path: string,
    hash: string,
    vector: number[],
    updatedAt: number,
    model: string,
  ): void {
    const buf = vector.length > 0 ? Buffer.from(new Float32Array(vector).buffer) : null;
    this.db
      .prepare(
        `INSERT INTO memory_page_index(path, hash, vector, updated_at, model) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET hash = excluded.hash, vector = excluded.vector,
           updated_at = excluded.updated_at, model = excluded.model`,
      )
      .run(path, hash, buf, updatedAt, model);
  }

  pageIndexList(): Array<{ path: string; hash: string; vector: number[]; model: string }> {
    const rows = this.db
      .prepare('SELECT path, hash, vector, model FROM memory_page_index ORDER BY path ASC')
      .all() as Array<{ path: string; hash: string; vector: Buffer | null; model: string }>;
    return rows.map((r) => ({
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

  pageIndexDelete(path: string): void {
    this.db.prepare('DELETE FROM memory_page_index WHERE path = ?').run(path);
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
         LEFT JOIN session_meta sm ON sm.session_id = m.session_id
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
         ON CONFLICT(session_id) DO UPDATE SET title = excluded.title`,
      )
      .run(sessionId, characterId, title, Date.now());
  }

  sessionSetPinned(sessionId: string, characterId: string, pinned: boolean): void {
    this.db
      .prepare(
        `INSERT INTO session_meta(session_id, character_id, title, pinned, created_at)
         VALUES (?, ?, NULL, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET pinned = excluded.pinned`,
      )
      .run(sessionId, characterId, pinned ? 1 : 0, Date.now());
  }

  sessionDelete(sessionId: string): void {
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId);
      this.db.prepare('DELETE FROM session_meta WHERE session_id = ?').run(sessionId);
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

  deleteMessagesFrom(sessionId: string, fromId: number): void {
    this.db.prepare('DELETE FROM messages WHERE session_id = ? AND id >= ?').run(sessionId, fromId);
  }

  // --- ⑮ 记忆域：会话滚动摘要 + 区间读取 ---
  sessionSummaryGet(sessionId: string): { summary: string | null; upto: number | null } {
    const row = this.db
      .prepare('SELECT summary, summary_upto AS upto FROM session_meta WHERE session_id = ?')
      .get(sessionId) as { summary: string | null; upto: number | null } | undefined;
    return { summary: row?.summary ?? null, upto: row?.upto ?? null };
  }

  sessionSummarySet(sessionId: string, summary: string | null, upto?: number): void {
    // meta 行可能尚不存在：character_id 从消息表回查（session_meta 列 NOT NULL）。
    const characterId =
      (
        this.db
          .prepare('SELECT character_id AS cid FROM messages WHERE session_id = ? LIMIT 1')
          .get(sessionId) as { cid: string } | undefined
      )?.cid ?? '';
    if (upto === undefined) {
      this.db
        .prepare(
          `INSERT INTO session_meta(session_id, character_id, title, pinned, created_at, summary)
           VALUES (?, ?, NULL, 0, ?, ?)
           ON CONFLICT(session_id) DO UPDATE SET summary = excluded.summary`,
        )
        .run(sessionId, characterId, Date.now(), summary);
    } else {
      this.db
        .prepare(
          `INSERT INTO session_meta(session_id, character_id, title, pinned, created_at, summary, summary_upto)
           VALUES (?, ?, NULL, 0, ?, ?, ?)
           ON CONFLICT(session_id) DO UPDATE SET summary = excluded.summary, summary_upto = excluded.summary_upto`,
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

  messageStats(sessionId: string): { count: number; lastId: number } {
    return this.db
      .prepare(
        'SELECT COUNT(*) AS count, COALESCE(MAX(id), 0) AS lastId FROM messages WHERE session_id = ?',
      )
      .get(sessionId) as { count: number; lastId: number };
  }

  async backupTo(dbPath: string): Promise<void> {
    await this.db.backup(dbPath); // 一致性在线快照
  }

  close(): void {
    this.db.close();
  }
}
