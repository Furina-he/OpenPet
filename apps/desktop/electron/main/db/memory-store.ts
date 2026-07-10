import type { PersonaStateBlob, StorageUsage } from '@openpet/protocol';
import type {
  AppendMessageInput,
  ConversationStore,
  KbChunkRow,
  KbDocRow,
  StoredRow,
} from './store.js';

interface Row extends StoredRow {
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
    this.rows.push({
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
    return ++this.seq;
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
  }> = [];
  private memorySeq = 0;

  memoryInsert(characterId: string, text: string, vector: number[], createdAt: number): number {
    const id = ++this.memorySeq;
    this.memoryRows.push({ id, characterId, text, vector: [...vector], pinned: false, createdAt });
    return id;
  }

  memoryList(
    characterId: string,
  ): Array<{ id: number; text: string; pinned: boolean; createdAt: number }> {
    return this.memoryRows
      .filter((r) => r.characterId === characterId)
      .map((r) => ({ id: r.id, text: r.text, pinned: r.pinned, createdAt: r.createdAt }));
  }

  memoryVectors(
    characterId: string,
  ): Array<{ id: number; text: string; pinned: boolean; vector: number[] }> {
    return this.memoryRows
      .filter((r) => r.characterId === characterId)
      .map((r) => ({ id: r.id, text: r.text, pinned: r.pinned, vector: [...r.vector] }));
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

  // --- 会话管理（session_meta 等价内存表；语义与 SqliteStore SQL 对齐）---
  private readonly sessionMeta = new Map<
    string,
    { characterId: string; title: string | null; pinned: boolean; createdAt: number }
  >();

  private metaUpsert(
    sessionId: string,
    characterId: string,
    patch: Partial<{ title: string | null; pinned: boolean }>,
  ): void {
    const cur = this.sessionMeta.get(sessionId) ?? {
      characterId,
      title: null as string | null,
      pinned: false,
      createdAt: ++this.clock,
    };
    this.sessionMeta.set(sessionId, { ...cur, ...patch });
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
      const meta = this.sessionMeta.get(id);
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

  sessionDelete(sessionId: string): void {
    for (let i = this.rows.length - 1; i >= 0; i--) {
      if (this.rows[i]!.sessionId === sessionId) this.rows.splice(i, 1);
    }
    this.sessionMeta.delete(sessionId);
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

  async backupTo(): Promise<void> {
    // 内存实现无文件后端；导出由 ExportBundle 用 manifest/storageUsage 兜底。
    return Promise.resolve();
  }

  close(): void {
    /* no-op */
  }
}
