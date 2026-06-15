import type { PersonaStateBlob, StorageUsage } from '@desksoul/protocol';
import type { AppendMessageInput, ConversationStore, StoredRow } from './store.js';

interface Row extends StoredRow {
  characterId: string;
  sessionId: string;
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

  getPersonaState(characterId: string): PersonaStateBlob | null {
    return this.persona.get(characterId)?.blob ?? null;
  }

  putPersonaState(characterId: string, blob: PersonaStateBlob, updatedAt: number): void {
    this.persona.set(characterId, { blob, updatedAt });
  }

  storageUsage(): StorageUsage {
    const chars = new Set(this.rows.map((r) => r.characterId));
    return { dbBytes: 0, messageCount: this.rows.length, characterCount: chars.size };
  }

  async backupTo(): Promise<void> {
    // 内存实现无文件后端；导出由 ExportBundle 用 manifest/storageUsage 兜底。
    return Promise.resolve();
  }

  close(): void {
    /* no-op */
  }
}
