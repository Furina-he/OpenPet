/**
 * SessionStore — Main 内会话历史（chat.snapshot 的数据源）。
 *
 * 记录干净文本（BehaviorParser 剥离标签后），不含 behavior 事件。
 * seq：每 session 的 delta 单调序号，appendDelta 返回；渲染端快照重建时以
 * `seq <= snapshot.seq` 丢弃缓冲的重复流事件（chat.stream wire 参数带 seq）。
 *
 * 持久化：JSON 文件节流落盘（M6 换 SQLite 后删除此路径）。
 *  - appendUser / finishAssistant 触发节流写（默认 500ms），dispose 冲洗。
 *  - delta 不触发写：流式中途 Main 崩溃丢当轮 partial，可接受（M6 消除）。
 *  - seq 不持久化：重启后没有跨进程的流，从 0 重新计数即可。
 * 纯模块（不依赖 Electron），路径由构造注入。
 */
import fs from 'node:fs';
import path from 'node:path';

export interface StoredMessage {
  role: 'user' | 'assistant';
  text: string;
  finishReason: 'stop' | 'cancel' | 'error' | null;
}

export interface SessionSnapshot {
  sessionId: string;
  messages: StoredMessage[];
  streaming: boolean;
  seq: number;
}

export interface SessionStoreOptions {
  /** 提供则启用 JSON 持久化。 */
  persistPath?: string;
  /** 落盘节流间隔（默认 500ms；测试调小）。 */
  persistDelayMs?: number;
}

interface PersistShape {
  version: 1;
  sessions: Record<string, StoredMessage[]>;
}

export class SessionStore {
  private readonly sessions = new Map<string, StoredMessage[]>();
  private readonly seqs = new Map<string, number>();
  private readonly persistPath: string | undefined;
  private readonly persistDelayMs: number;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: SessionStoreOptions = {}) {
    this.persistPath = opts.persistPath;
    this.persistDelayMs = opts.persistDelayMs ?? 500;
    if (this.persistPath) this.loadSync(this.persistPath);
  }

  private loadSync(file: string): void {
    let raw: string;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch {
      return; // 首次启动无文件
    }
    try {
      const data = JSON.parse(raw) as PersistShape;
      if (data.version !== 1) return;
      for (const [id, messages] of Object.entries(data.sessions)) {
        // 防御：上个进程异常退出可能留下未封口的 assistant 消息 → 封为 error
        for (const m of messages) {
          if (m.role === 'assistant' && m.finishReason === null) m.finishReason = 'error';
        }
        this.sessions.set(id, messages);
      }
    } catch (e) {
      console.warn('[session-store] corrupt persist file ignored:', e);
    }
  }

  appendUser(sessionId: string, text: string): void {
    this.messagesOf(sessionId).push({ role: 'user', text, finishReason: null });
    this.schedulePersist();
  }

  beginAssistant(sessionId: string): void {
    this.messagesOf(sessionId).push({ role: 'assistant', text: '', finishReason: null });
  }

  /** 累积当前流式回复；返回本 session 单调递增的 delta 序号。 */
  appendDelta(sessionId: string, text: string): number {
    const messages = this.messagesOf(sessionId);
    let last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant' || last.finishReason !== null) {
      // 防御：delta 本身就是 assistant 回合存在的证据，缺 begin 时补一条
      last = { role: 'assistant', text: '', finishReason: null };
      messages.push(last);
    }
    last.text += text;
    const seq = (this.seqs.get(sessionId) ?? 0) + 1;
    this.seqs.set(sessionId, seq);
    return seq;
  }

  finishAssistant(sessionId: string, reason: 'stop' | 'cancel' | 'error'): void {
    const messages = this.sessions.get(sessionId);
    const last = messages?.[messages.length - 1];
    if (last && last.role === 'assistant' && last.finishReason === null) {
      last.finishReason = reason;
    }
    this.schedulePersist();
  }

  isStreaming(sessionId: string): boolean {
    const messages = this.sessions.get(sessionId);
    const last = messages?.[messages.length - 1];
    return !!last && last.role === 'assistant' && last.finishReason === null;
  }

  snapshot(sessionId: string, limit = 50): SessionSnapshot {
    const messages = this.sessions.get(sessionId) ?? [];
    return {
      sessionId,
      messages: messages.slice(-limit).map((m) => ({ ...m })),
      streaming: this.isStreaming(sessionId),
      seq: this.seqs.get(sessionId) ?? 0,
    };
  }

  private messagesOf(sessionId: string): StoredMessage[] {
    let list = this.sessions.get(sessionId);
    if (!list) {
      list = [];
      this.sessions.set(sessionId, list);
    }
    return list;
  }

  private schedulePersist(): void {
    if (!this.persistPath || this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.writeSync();
    }, this.persistDelayMs);
  }

  private writeSync(): void {
    if (!this.persistPath) return;
    const data: PersistShape = { version: 1, sessions: Object.fromEntries(this.sessions) };
    const tmp = `${this.persistPath}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.persistPath), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(data), 'utf8');
      fs.renameSync(tmp, this.persistPath); // 原子替换，避免半截 JSON
    } catch (e) {
      console.warn('[session-store] persist failed:', e);
    }
  }

  /** 退出前冲洗未落盘的变更。 */
  dispose(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
      this.writeSync();
    }
  }
}
