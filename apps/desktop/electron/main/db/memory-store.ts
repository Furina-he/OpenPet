import type { PersonaStateBlob, StorageUsage } from '@openpet/protocol';
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

interface Row extends StoredRow {
  id: number;
  characterId: string;
  sessionId: string;
  model: string | null;
}

/**
 * 纯内存 ConversationStore：单测真源 / better-sqlite3 不可用时的降级实现。
 * `recentMessages` 的 slice(-limit) 依赖插入即 ts 升序（SessionStore 顺序写入），
 * 与 SqliteStore 的 `ORDER BY ts` 语义一致。
 */
export class MemoryStore implements ConversationStore {
  private readonly rows: Row[] = [];
  private readonly persona = new Map<string, { blob: PersonaStateBlob; updatedAt: number }>();
  private seq = 0;
  /** KB chunk/doc 内存表（§5）；clock 给 doc.addedAt 递增戳，避免 Date（测试确定性）。 */
  private readonly kbChunkRows: KbChunkRow[] = [];
  private readonly kbDocRows: KbDocRow[] = [];
  private clock = 0;

  appendMessage(input: AppendMessageInput): number {
    const id = ++this.seq;
    this.rows.push({
      id,
      characterId: input.characterId,
      sessionId: input.sessionId,
      role: input.role,
      text: input.text,
      finishReason: input.finishReason ?? null,
      ts: input.ts,
      tokensIn: input.tokensIn ?? null,
      tokensOut: input.tokensOut ?? null,
      model: input.model ?? null,
    });
    return id;
  }

  recentMessages(characterId: string, sessionId: string, limit: number): StoredRow[] {
    return this.rows
      .filter((r) => r.characterId === characterId && r.sessionId === sessionId)
      .slice(-limit)
      .map((r) => ({
        role: r.role,
        text: r.text,
        finishReason: r.finishReason,
        ts: r.ts,
        tokensIn: r.tokensIn,
        tokensOut: r.tokensOut,
      }));
  }

  clearMessages(): void {
    this.rows.length = 0;
    this.sessionMeta.clear();
    this.compileState.clear();
    this.notes.length = 0;
  }

  getPersonaState(characterId: string): PersonaStateBlob | null {
    return this.persona.get(characterId)?.blob ?? null;
  }

  putPersonaState(characterId: string, blob: PersonaStateBlob, updatedAt: number): void {
    this.persona.set(characterId, { blob, updatedAt });
  }

  kbInsertChunks(
    kbId: string,
    docId: string,
    filename: string,
    rows: { ord: number; text: string; vector: number[] }[],
  ): void {
    for (const r of rows) {
      this.kbChunkRows.push({ kbId, docId, ord: r.ord, text: r.text, vector: [...r.vector] });
    }
    this.kbDocRows.push({
      id: docId,
      kbId,
      filename,
      chunkCount: rows.length,
      addedAt: ++this.clock,
    });
  }

  kbChunks(kbIds: string[]): KbChunkRow[] {
    const set = new Set(kbIds);
    return this.kbChunkRows
      .filter((r) => set.has(r.kbId))
      .map((r) => ({ ...r, vector: [...r.vector] }));
  }

  kbDocs(kbId: string): KbDocRow[] {
    return this.kbDocRows.filter((d) => d.kbId === kbId).map((d) => ({ ...d }));
  }

  kbDeleteDoc(kbId: string, docId: string): void {
    for (let i = this.kbChunkRows.length - 1; i >= 0; i--) {
      const r = this.kbChunkRows[i]!;
      if (r.kbId === kbId && r.docId === docId) this.kbChunkRows.splice(i, 1);
    }
    for (let i = this.kbDocRows.length - 1; i >= 0; i--) {
      const d = this.kbDocRows[i]!;
      if (d.kbId === kbId && d.id === docId) this.kbDocRows.splice(i, 1);
    }
  }

  // --- 批次⑥ 长期记忆（memory_fact 等价内存表）---
  private readonly memoryRows: Array<{
    id: number;
    characterId: string;
    text: string;
    vector: number[];
    pinned: boolean;
    createdAt: number;
    updatedAt: number | null;
  }> = [];
  private memorySeq = 0;

  memoryInsert(characterId: string, text: string, vector: number[], createdAt: number): number {
    const id = ++this.memorySeq;
    this.memoryRows.push({
      id,
      characterId,
      text,
      vector: [...vector],
      pinned: false,
      createdAt,
      updatedAt: null,
    });
    return id;
  }

  memoryUpdate(id: number, text: string, vector: number[], updatedAt: number): void {
    const row = this.memoryRows.find((r) => r.id === id);
    if (!row) return;
    row.text = text;
    row.vector = [...vector];
    row.updatedAt = updatedAt;
  }

  memoryList(characterId: string): Array<{
    id: number;
    text: string;
    pinned: boolean;
    createdAt: number;
    updatedAt: number | null;
  }> {
    return this.memoryRows
      .filter((r) => r.characterId === characterId)
      .map((r) => ({
        id: r.id,
        text: r.text,
        pinned: r.pinned,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      }));
  }

  memoryVectors(characterId: string): Array<{
    id: number;
    text: string;
    pinned: boolean;
    vector: number[];
    createdAt: number;
    updatedAt: number | null;
  }> {
    return this.memoryRows
      .filter((r) => r.characterId === characterId)
      .map((r) => ({
        id: r.id,
        text: r.text,
        pinned: r.pinned,
        vector: [...r.vector],
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      }));
  }

  memoryDelete(id: number): void {
    const i = this.memoryRows.findIndex((r) => r.id === id);
    if (i >= 0) this.memoryRows.splice(i, 1);
  }

  memorySetPinned(id: number, pinned: boolean): void {
    const row = this.memoryRows.find((r) => r.id === id);
    if (row) row.pinned = pinned;
  }

  memoryClear(characterId: string): void {
    for (let i = this.memoryRows.length - 1; i >= 0; i--) {
      if (this.memoryRows[i]!.characterId === characterId) this.memoryRows.splice(i, 1);
    }
  }

  memoryCount(characterId: string): number {
    return this.memoryRows.filter((r) => r.characterId === characterId).length;
  }

  // --- ㉔ 块级向量索引（内存等价表）---
  private readonly chunkIndex = new Map<string, ChunkIndexRow>();

  chunkIndexUpsert(rows: readonly ChunkIndexRow[], _updatedAt: number): void {
    for (const r of rows) this.chunkIndex.set(r.id, { ...r, vector: [...r.vector] });
  }

  chunkIndexList(): ChunkIndexRow[] {
    return [...this.chunkIndex.values()]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((r) => ({ ...r, vector: [...r.vector] }));
  }

  chunkIndexDeletePath(path: string): void {
    for (const [id, r] of this.chunkIndex) if (r.path === path) this.chunkIndex.delete(id);
  }

  chunkIndexDelete(ids: readonly string[]): void {
    for (const id of ids) this.chunkIndex.delete(id);
  }

  chunkIndexClear(): void {
    this.chunkIndex.clear();
  }

  // --- ㉒ 被想起的痕迹（内存等价表）---
  private readonly pageStats = new Map<string, { count: number; lastAt: number | null }>();

  pageStatsBump(paths: readonly string[], now: number): void {
    for (const p of paths) {
      const cur = this.pageStats.get(p);
      this.pageStats.set(p, { count: (cur?.count ?? 0) + 1, lastAt: now });
    }
  }

  pageStatsList(): Array<{ path: string; count: number; lastAt: number | null }> {
    return [...this.pageStats.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([path, v]) => ({ path, ...v }));
  }

  pageStatsRename(from: string, to: string): void {
    const src = this.pageStats.get(from);
    if (!src || from === to) return;
    const dst = this.pageStats.get(to);
    this.pageStats.set(to, {
      count: src.count + (dst?.count ?? 0),
      lastAt: Math.max(src.lastAt ?? 0, dst?.lastAt ?? 0) || null,
    });
    this.pageStats.delete(from);
  }

  pageStatsDelete(path: string): void {
    this.pageStats.delete(path);
  }

  pageStatsClear(): void {
    this.pageStats.clear();
  }

  storageUsage(): StorageUsage {
    const chars = new Set(this.rows.map((r) => r.characterId));
    return { dbBytes: 0, messageCount: this.rows.length, characterCount: chars.size };
  }

  usageSummary(sinceTs: number): { tokensIn: number; tokensOut: number; messages: number } {
    const hit = this.rows.filter(
      (r) => r.role === 'assistant' && r.ts >= sinceTs && r.tokensOut !== null,
    );
    return {
      tokensIn: hit.reduce((sum, r) => sum + (r.tokensIn ?? 0), 0),
      tokensOut: hit.reduce((sum, r) => sum + (r.tokensOut ?? 0), 0),
      messages: hit.length,
    };
  }

  // --- 总览页统计（spec 2026-07-09；与 SqliteStore SQL 语义对齐）---
  private bucketOf(ts: number, bucketMs: number, tz: number): number {
    return Math.floor((ts + tz) / bucketMs) * bucketMs - tz;
  }

  statsMessageCount(sinceTs: number): number {
    return this.rows.filter((r) => r.ts >= sinceTs).length;
  }

  statsMessageSeries(
    sinceTs: number,
    bucketMs: number,
    tzOffsetMs: number,
  ): Array<[number, number]> {
    const acc = new Map<number, number>();
    for (const r of this.rows) {
      if (r.ts < sinceTs) continue;
      const b = this.bucketOf(r.ts, bucketMs, tzOffsetMs);
      acc.set(b, (acc.get(b) ?? 0) + 1);
    }
    return [...acc.entries()].sort((a, b) => a[0] - b[0]);
  }

  statsTokensByModel(sinceTs: number): Array<{ model: string; tokens: number }> {
    const acc = new Map<string, number>();
    for (const r of this.rows) {
      if (r.ts < sinceTs || r.role !== 'assistant' || r.tokensOut === null || r.model === null)
        continue;
      acc.set(r.model, (acc.get(r.model) ?? 0) + (r.tokensIn ?? 0) + (r.tokensOut ?? 0));
    }
    return [...acc.entries()]
      .map(([model, tokens]) => ({ model, tokens }))
      .sort((a, b) => b.tokens - a.tokens);
  }

  statsTokenSeriesByModel(
    sinceTs: number,
    bucketMs: number,
    tzOffsetMs: number,
  ): Array<{ model: string; points: Array<[number, number]> }> {
    const acc = new Map<string, Map<number, number>>();
    for (const r of this.rows) {
      if (r.ts < sinceTs || r.role !== 'assistant' || r.tokensOut === null || r.model === null)
        continue;
      const b = this.bucketOf(r.ts, bucketMs, tzOffsetMs);
      const m = acc.get(r.model) ?? new Map<number, number>();
      m.set(b, (m.get(b) ?? 0) + (r.tokensIn ?? 0) + (r.tokensOut ?? 0));
      acc.set(r.model, m);
    }
    return [...acc.entries()].map(([model, m]) => ({
      model,
      points: [...m.entries()].sort((a, b) => a[0] - b[0]) as Array<[number, number]>,
    }));
  }

  statsFirstMessageTs(): number | null {
    return this.rows.length ? Math.min(...this.rows.map((r) => r.ts)) : null;
  }

  // --- 会话管理（session_meta 等价内存表；语义与 SqliteStore SQL 对齐；㉔ 键 = 角色 + 会话）---
  private readonly sessionMeta = new Map<
    string,
    {
      title: string | null;
      pinned: boolean;
      createdAt: number;
      summary: string | null;
      summaryUpto: number | null;
    }
  >();

  private metaKey(characterId: string, sessionId: string): string {
    return JSON.stringify([characterId, sessionId]);
  }

  private metaUpsert(
    sessionId: string,
    characterId: string,
    patch: Partial<{
      title: string | null;
      pinned: boolean;
      summary: string | null;
      summaryUpto: number | null;
    }>,
  ): void {
    const key = this.metaKey(characterId, sessionId);
    const cur = this.sessionMeta.get(key) ?? {
      title: null as string | null,
      pinned: false,
      createdAt: ++this.clock,
      summary: null as string | null,
      summaryUpto: null as number | null,
    };
    this.sessionMeta.set(key, { ...cur, ...patch });
  }

  sessionList(characterId: string): Array<{
    id: string;
    title: string | null;
    pinned: boolean;
    lastText: string;
    lastTs: number;
    count: number;
    firstUserText: string | null;
  }> {
    const byId = new Map<string, Row[]>();
    for (const r of this.rows) {
      if (r.characterId !== characterId) continue;
      const g = byId.get(r.sessionId) ?? [];
      g.push(r);
      byId.set(r.sessionId, g);
    }
    const list = [...byId.entries()].map(([id, rows]) => {
      const meta = this.sessionMeta.get(this.metaKey(characterId, id));
      const firstUser = rows.find((r) => r.role === 'user');
      const last = rows[rows.length - 1]!;
      return {
        id,
        title: meta?.title ?? null,
        pinned: meta?.pinned ?? false,
        lastText: last.text,
        lastTs: last.ts,
        count: rows.length,
        firstUserText: firstUser?.text ?? null,
      };
    });
    return list.sort((a, b) => (a.pinned === b.pinned ? b.lastTs - a.lastTs : a.pinned ? -1 : 1));
  }

  sessionSetTitle(sessionId: string, characterId: string, title: string): void {
    this.metaUpsert(sessionId, characterId, { title });
  }

  sessionSetPinned(sessionId: string, characterId: string, pinned: boolean): void {
    this.metaUpsert(sessionId, characterId, { pinned });
  }

  sessionDelete(characterId: string, sessionId: string): void {
    for (let i = this.rows.length - 1; i >= 0; i--) {
      const r = this.rows[i]!;
      if (r.characterId === characterId && r.sessionId === sessionId) this.rows.splice(i, 1);
    }
    this.sessionMeta.delete(this.metaKey(characterId, sessionId));
    this.compileState.delete(this.metaKey(characterId, sessionId));
    this.dropNotes((n) => n.characterId === characterId && n.sessionId === sessionId);
  }

  sessionMessages(characterId: string, sessionId: string): StoredRow[] {
    return this.rows
      .filter((r) => r.characterId === characterId && r.sessionId === sessionId)
      .map((r) => ({
        role: r.role,
        text: r.text,
        finishReason: r.finishReason,
        ts: r.ts,
        tokensIn: r.tokensIn,
        tokensOut: r.tokensOut,
      }));
  }

  lastUserMessage(characterId: string, sessionId: string): { id: number; text: string } | null {
    for (let i = this.rows.length - 1; i >= 0; i--) {
      const r = this.rows[i]!;
      if (r.characterId === characterId && r.sessionId === sessionId && r.role === 'user')
        return { id: r.id, text: r.text };
    }
    return null;
  }

  deleteMessagesFrom(characterId: string, sessionId: string, fromId: number): void {
    for (let i = this.rows.length - 1; i >= 0; i--) {
      const r = this.rows[i]!;
      if (r.characterId === characterId && r.sessionId === sessionId && r.id >= fromId)
        this.rows.splice(i, 1);
    }
    const key = this.metaKey(characterId, sessionId);
    const st = this.compileState.get(key);
    if (st) {
      const cut = st.pendingTo !== null && st.pendingTo >= fromId;
      this.compileState.set(key, {
        ...st,
        upto: Math.min(st.upto, fromId - 1),
        ...(cut ? { pendingTo: null, retries: 0 } : {}),
      });
    }
  }

  // --- ⑮ 记忆域：会话滚动摘要 + 区间读取（语义与 SqliteStore 对齐）---
  sessionSummaryGet(
    characterId: string,
    sessionId: string,
  ): { summary: string | null; upto: number | null } {
    const meta = this.sessionMeta.get(this.metaKey(characterId, sessionId));
    return { summary: meta?.summary ?? null, upto: meta?.summaryUpto ?? null };
  }

  sessionSummarySet(
    characterId: string,
    sessionId: string,
    summary: string | null,
    upto?: number,
  ): void {
    this.metaUpsert(
      sessionId,
      characterId,
      upto === undefined ? { summary } : { summary, summaryUpto: upto },
    );
  }

  messagesBetween(
    characterId: string,
    sessionId: string,
    afterId: number,
    beforeOrEqId: number,
  ): Array<StoredRow & { id: number }> {
    return this.rows
      .filter(
        (r) =>
          r.characterId === characterId &&
          r.sessionId === sessionId &&
          r.id > afterId &&
          r.id <= beforeOrEqId,
      )
      .map((r) => ({
        id: r.id,
        role: r.role,
        text: r.text,
        finishReason: r.finishReason,
        ts: r.ts,
        tokensIn: r.tokensIn,
        tokensOut: r.tokensOut,
      }));
  }

  messageStats(characterId: string, sessionId: string): { count: number; lastId: number } {
    const hit = this.rows.filter((r) => r.characterId === characterId && r.sessionId === sessionId);
    return { count: hit.length, lastId: hit.length ? Math.max(...hit.map((r) => r.id)) : 0 };
  }

  messagesBefore(
    characterId: string,
    sessionId: string,
    beforeOrEqId: number,
    limit: number,
  ): Array<StoredRow & { id: number }> {
    return this.messagesBetween(characterId, sessionId, 0, beforeOrEqId).slice(-limit);
  }

  messageCountAfter(characterId: string, sessionId: string, afterId: number): number {
    return this.rows.filter(
      (r) => r.characterId === characterId && r.sessionId === sessionId && r.id > afterId,
    ).length;
  }

  // --- ㉔ 记忆 v3：编译账本 / 便签 / 来源日志（语义与 SqliteStore 对齐）---
  private readonly compileState = new Map<string, CompileStateRow>();
  private readonly notes: Array<MemoryNoteRow & { characterId: string; sessionId: string }> = [];
  private noteSeq = 0;
  private readonly opLog: MemoryOpLogRow[] = [];
  private opLogSeq = 0;

  private dropNotes(
    pred: (n: { id: number; characterId: string; sessionId: string }) => boolean,
  ): void {
    for (let i = this.notes.length - 1; i >= 0; i--)
      if (pred(this.notes[i]!)) this.notes.splice(i, 1);
  }

  compileStateGet(characterId: string, sessionId: string): CompileStateRow {
    const st = this.compileState.get(this.metaKey(characterId, sessionId));
    return st
      ? { ...st }
      : { upto: 0, pendingTo: null, retries: 0, lastError: null, lastAttemptAt: null };
  }

  compileStatePut(characterId: string, sessionId: string, patch: Partial<CompileStateRow>): void {
    this.compileState.set(this.metaKey(characterId, sessionId), {
      ...this.compileStateGet(characterId, sessionId),
      ...patch,
    });
  }

  memoryNoteAdd(characterId: string, sessionId: string, text: string, createdAt: number): number {
    const id = ++this.noteSeq;
    this.notes.push({ id, characterId, sessionId, text, createdAt });
    return id;
  }

  memoryNotes(characterId: string, sessionId: string): MemoryNoteRow[] {
    return this.notes
      .filter((n) => n.characterId === characterId && n.sessionId === sessionId)
      .map((n) => ({ id: n.id, text: n.text, createdAt: n.createdAt }));
  }

  memoryNotesDelete(ids: readonly number[]): void {
    const set = new Set(ids);
    this.dropNotes((n) => set.has(n.id));
  }

  memoryNotesClear(): void {
    this.notes.length = 0;
  }

  opLogAdd(rows: readonly MemoryOpLogInput[]): void {
    for (const r of rows) this.opLog.push({ ...r, id: ++this.opLogSeq });
  }

  opLogForPath(path: string, limit: number): MemoryOpLogRow[] {
    return this.opLog
      .filter((r) => r.path === path)
      .sort((a, b) => b.at - a.at || a.id - b.id)
      .slice(0, limit)
      .map((r) => ({ ...r }));
  }

  opLogRenamePath(from: string, to: string): void {
    for (const r of this.opLog) if (r.path === from) r.path = to;
  }

  opLogDeletePath(path: string): void {
    for (let i = this.opLog.length - 1; i >= 0; i--)
      if (this.opLog[i]!.path === path) this.opLog.splice(i, 1);
  }

  opLogClear(): void {
    this.opLog.length = 0;
  }

  async backupTo(): Promise<void> {
    // 内存实现无文件后端；导出由 ExportBundle 用 manifest/storageUsage 兜底。
    return Promise.resolve();
  }

  close(): void {
    /* no-op */
  }
}
