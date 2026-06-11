import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  seq: number;
  sealed?: boolean;
}

interface Session {
  nextSeq: number;
  messages: Message[];
  unsealedIndex?: number;
}

interface PersistFormat {
  version: 1;
  sessions: Record<string, { nextSeq: number; messages: Message[] }>;
}

export interface Snapshot {
  messages: Message[];
  streaming: boolean;
}

export class SessionStore {
  private sessions = new Map<string, Session>();
  private persistTimer: NodeJS.Timeout | null = null;
  private readonly THROTTLE_MS = 500;

  constructor(private readonly persistPath: string) {
    this.loadSync();
  }

  appendUser(sessionId: string, content: string): number {
    const sess = this.getOrCreate(sessionId);
    const seq = sess.nextSeq++;
    sess.messages.push({ role: 'user', content, seq });
    this.schedulePersist();
    return seq;
  }

  beginAssistant(sessionId: string): number {
    const sess = this.getOrCreate(sessionId);
    const seq = sess.nextSeq++;
    sess.messages.push({ role: 'assistant', content: '', seq, sealed: false });
    sess.unsealedIndex = sess.messages.length - 1;
    return seq;
  }

  appendDelta(sessionId: string, delta: string): number {
    const sess = this.getOrCreate(sessionId);
    if (sess.unsealedIndex === undefined) {
      const seq = this.beginAssistant(sessionId);
      sess.unsealedIndex = sess.messages.length - 1;
    }
    const msg = sess.messages[sess.unsealedIndex!];
    msg.content += delta;
    return msg.seq;
  }

  finishAssistant(sessionId: string): void {
    const sess = this.sessions.get(sessionId);
    if (!sess || sess.unsealedIndex === undefined) return;
    const msg = sess.messages[sess.unsealedIndex];
    msg.sealed = true;
    delete sess.unsealedIndex;
    this.schedulePersist();
  }

  isStreaming(sessionId: string): boolean {
    const sess = this.sessions.get(sessionId);
    return sess?.unsealedIndex !== undefined;
  }

  snapshot(sessionId: string, limit?: number): Snapshot {
    const sess = this.sessions.get(sessionId);
    if (!sess) return { messages: [], streaming: false };

    let msgs = sess.messages;
    if (limit !== undefined && msgs.length > limit) {
      msgs = msgs.slice(-limit);
    }

    return {
      messages: msgs.map((m) => ({ ...m })),
      streaming: sess.unsealedIndex !== undefined,
    };
  }

  dispose(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    this.writeSync();
  }

  private getOrCreate(sessionId: string): Session {
    let sess = this.sessions.get(sessionId);
    if (!sess) {
      sess = { nextSeq: 1, messages: [] };
      this.sessions.set(sessionId, sess);
    }
    return sess;
  }

  private schedulePersist(): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.writeSync();
    }, this.THROTTLE_MS);
  }

  private loadSync(): void {
    try {
      const raw = readFileSync(this.persistPath, 'utf8');
      const data: PersistFormat = JSON.parse(raw);
      for (const [id, sess] of Object.entries(data.sessions)) {
        let unsealedIndex: number | undefined;
        for (let i = sess.messages.length - 1; i >= 0; i--) {
          const msg = sess.messages[i];
          if (msg.role === 'assistant' && msg.sealed === false) {
            msg.content = '[流式中断]';
            msg.sealed = true;
            break;
          }
        }
        this.sessions.set(id, {
          nextSeq: sess.nextSeq,
          messages: sess.messages,
          unsealedIndex,
        });
      }
    } catch {
      // 文件不存在或损坏，从空开始
    }
  }

  private writeSync(): void {
    const data: PersistFormat = {
      version: 1,
      sessions: {},
    };
    for (const [id, sess] of this.sessions) {
      data.sessions[id] = {
        nextSeq: sess.nextSeq,
        messages: sess.messages,
      };
    }
    try {
      mkdirSync(dirname(this.persistPath), { recursive: true });
      const tmp = `${this.persistPath}.tmp`;
      writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
      writeFileSync(this.persistPath, readFileSync(tmp));
    } catch {
      // 持久化失败不阻塞运行
    }
  }
}
