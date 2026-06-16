/**
 * SessionStore — 会话运行时状态机（seq / streaming / 当前轮 partial），
 * 持久化委托给注入的 ConversationStore（M6：JSON → SQLite）。
 *
 * 落库时机：user 在 appendUser 立刻 commit；assistant 在 finishAssistant 一次性
 * commit（含 finishReason + usage）。流式中途 partial 只在内存——Main 崩溃丢当轮
 * partial（可接受，与旧 JSON 版一致），已封口历史完整可恢复。
 * seq 不持久化：重启后从 0 重新计数（跨进程无流）。
 */
import type { ConversationStore } from './db/store.js';

export interface StoredMessage {
  role: 'user' | 'assistant';
  text: string;
  finishReason: 'stop' | 'cancel' | 'error' | null;
  tokensIn?: number;
  tokensOut?: number;
}

export interface SessionSnapshot {
  sessionId: string;
  messages: StoredMessage[];
  streaming: boolean;
  seq: number;
}

export interface SessionStoreOptions {
  store: ConversationStore;
  /**
   * 角色 id：传字符串=固定；传函数=每次读写动态解析。
   * ChatService 注入 `() => current().id`，使落库/快照始终跟随当前角色——
   * 消除"构造时固化 id 而 persona 演进用动态 id"的写串隐患（tech-design §6 角色隔离）。
   */
  characterId: string | (() => string);
  /** 时间戳源（测试可注入；缺省 Date.now）。 */
  now?: () => number;
}

interface PartialTurn {
  text: string;
  tokensIn?: number;
  tokensOut?: number;
}

export class SessionStore {
  private readonly store: ConversationStore;
  private readonly characterId: () => string;
  private readonly now: () => number;
  private readonly seqs = new Map<string, number>();
  private readonly partials = new Map<string, PartialTurn>(); // 仅 streaming 中的 assistant

  constructor(opts: SessionStoreOptions) {
    this.store = opts.store;
    const cid = opts.characterId;
    this.characterId = typeof cid === 'function' ? cid : () => cid;
    this.now = opts.now ?? (() => Date.now());
  }

  appendUser(sessionId: string, text: string): void {
    this.store.appendMessage({
      characterId: this.characterId(),
      sessionId,
      role: 'user',
      text,
      ts: this.now(),
      finishReason: null,
    });
  }

  beginAssistant(sessionId: string): void {
    this.partials.set(sessionId, { text: '' });
  }

  /** 累积当前流式回复；返回本 session 单调递增的 delta 序号。 */
  appendDelta(sessionId: string, text: string): number {
    const p = this.partials.get(sessionId) ?? { text: '' };
    p.text += text;
    this.partials.set(sessionId, p);
    const seq = (this.seqs.get(sessionId) ?? 0) + 1;
    this.seqs.set(sessionId, seq);
    return seq;
  }

  finishAssistant(sessionId: string, reason: 'stop' | 'cancel' | 'error'): void {
    const p = this.partials.get(sessionId);
    if (!p) return; // 没有在途 assistant（防御）
    this.partials.delete(sessionId);
    this.store.appendMessage({
      characterId: this.characterId(),
      sessionId,
      role: 'assistant',
      text: p.text,
      ts: this.now(),
      finishReason: reason,
      tokensIn: p.tokensIn ?? null,
      tokensOut: p.tokensOut ?? null,
    });
  }

  /** 把本轮 usage 暂存到当前 partial（finishAssistant 落库时一起写）。 */
  recordUsage(sessionId: string, tokensIn: number, tokensOut: number): void {
    const p = this.partials.get(sessionId);
    if (p) {
      p.tokensIn = tokensIn;
      p.tokensOut = tokensOut;
    }
  }

  isStreaming(sessionId: string): boolean {
    return this.partials.has(sessionId);
  }

  snapshot(sessionId: string, limit = 50): SessionSnapshot {
    const rows = this.store.recentMessages(this.characterId(), sessionId, limit);
    const messages: StoredMessage[] = rows.map((r) => ({
      role: r.role,
      text: r.text,
      finishReason: r.finishReason,
      ...(r.tokensIn != null ? { tokensIn: r.tokensIn } : {}),
      ...(r.tokensOut != null ? { tokensOut: r.tokensOut } : {}),
    }));
    const p = this.partials.get(sessionId);
    if (p) messages.push({ role: 'assistant', text: p.text, finishReason: null });
    return {
      sessionId,
      messages,
      streaming: !!p,
      seq: this.seqs.get(sessionId) ?? 0,
    };
  }

  /** 持久化由 store 负责；此处仅清运行时态（app 退出 / 服务 dispose）。 */
  dispose(): void {
    this.partials.clear();
    this.seqs.clear();
  }
}
