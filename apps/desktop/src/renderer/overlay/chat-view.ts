/**
 * ChatView — overlay 的会话视图状态机（纯 TS：无 DOM / 无 Vue，便于 node 单测）。
 *
 * 职责：把三路输入（chat.snapshot 结果 / chat.stream / chat.done）合成一份
 * 消息列表。崩溃恢复的关键在订阅/快照竞态：先订阅后拉快照，快照落地前的
 * 事件进缓冲；落地时按 `seq <= snapshot.seq` 丢弃已含在快照里的流事件，
 * 其余重放（done 无 seq，重放是幂等的封口操作）。
 *
 * 本地回显：echoUser 在 rpc 发出前乐观插入 user + assistant 占位（与 Main 侧
 * SessionStore 的 appendUser+beginAssistant 同构），rpc 失败时 rollbackEcho。
 */
import type { ErrorKind } from '@openpet/protocol';

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  finishReason: 'stop' | 'cancel' | 'error' | null;
  /** J3：仅 finishReason==='error' 时有意义（错误分级台词用）。 */
  errorKind?: ErrorKind;
}

export interface StreamEvent {
  sessionId: string;
  text: string;
  seq: number;
}

export interface DoneEvent {
  sessionId: string;
  finishReason: 'stop' | 'cancel' | 'error';
  errorKind?: ErrorKind;
}

/**
 * 上游空回复（间歇性中转源问题：completion=0 且正常 stop）——渲染层据此显示
 * 明确提示而非空白气泡（2026-07-09 真窗反馈）。流中（finishReason null）不算。
 */
export function isEmptyReply(m: Pick<ChatMessage, 'role' | 'text' | 'finishReason'>): boolean {
  return m.role === 'assistant' && m.finishReason === 'stop' && m.text.trim() === '';
}

export interface Snapshot {
  sessionId: string;
  messages: ChatMessage[];
  streaming: boolean;
  seq: number;
}

type Buffered = { kind: 'stream'; ev: StreamEvent } | { kind: 'done'; ev: DoneEvent };

export class ChatView {
  messages: ChatMessage[] = [];
  streaming = false;
  /** 快照已应用？应用前 UI 应禁用输入（发送依赖与 Main 状态一致）。 */
  ready = false;

  private lastSeq = 0;
  private pending: Buffered[] = [];

  constructor(
    private readonly sessionId: string,
    private readonly onChange: () => void,
  ) {}

  onStream(ev: StreamEvent): void {
    if (ev.sessionId !== this.sessionId) return;
    if (!this.ready) {
      this.pending.push({ kind: 'stream', ev });
      return;
    }
    this.applyStream(ev);
  }

  onDone(ev: DoneEvent): void {
    if (ev.sessionId !== this.sessionId) return;
    if (!this.ready) {
      this.pending.push({ kind: 'done', ev });
      return;
    }
    this.applyDone(ev);
  }

  applySnapshot(snap: Snapshot): void {
    this.messages = snap.messages.map((m) => ({ ...m }));
    this.streaming = snap.streaming;
    this.lastSeq = snap.seq;
    this.ready = true;
    const buf = this.pending;
    this.pending = [];
    for (const b of buf) {
      if (b.kind === 'stream') this.applyStream(b.ev, { silent: true });
      else this.applyDone(b.ev, { silent: true });
    }
    this.onChange();
  }

  /** rpc 发出前乐观回显；失败时 rollbackEcho()。 */
  echoUser(text: string): void {
    this.messages.push({ role: 'user', text, finishReason: null });
    this.messages.push({ role: 'assistant', text: '', finishReason: null });
    this.streaming = true;
    this.onChange();
  }

  rollbackEcho(): void {
    this.messages.splice(-2, 2);
    this.streaming = false;
    this.onChange();
  }

  private applyStream(ev: StreamEvent, opts: { silent?: boolean } = {}): void {
    if (ev.seq <= this.lastSeq) return; // 已含在快照文本里
    this.lastSeq = ev.seq;
    let last = this.messages[this.messages.length - 1];
    if (!last || last.role !== 'assistant' || last.finishReason !== null) {
      // 防御：流事件先于本地回显/快照抵达时补一条 assistant
      last = { role: 'assistant', text: '', finishReason: null };
      this.messages.push(last);
    }
    last.text += ev.text;
    this.streaming = true;
    if (!opts.silent) this.onChange();
  }

  private applyDone(ev: DoneEvent, opts: { silent?: boolean } = {}): void {
    const last = this.messages[this.messages.length - 1];
    if (last && last.role === 'assistant' && last.finishReason === null) {
      last.finishReason = ev.finishReason;
      if (ev.errorKind !== undefined) last.errorKind = ev.errorKind;
    }
    this.streaming = false;
    if (!opts.silent) this.onChange();
  }
}
