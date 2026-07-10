/**
 * NotificationQueue — Main → Renderer 通知的背压队列（tech-design §3 要点 4）。
 *
 * 所有出站 notification 入全局 FIFO，由 flushIntervalMs 定时批量外送：
 *  - 每 session 软上限 maxPerSession：超限触发该 session 的合并扫描——
 *    **相邻**且同 session 的 chat.stream 合并（text 拼接、seq 取后者）。
 *    behavior.* 与跨 session 条目永不合并、永不重排：消息边界与全局顺序不丢。
 *    极端 behavior 密集流合并后仍可能超限——接受（软上限），不丢消息。
 *  - urgent push（chat.done）立即整队 flush：终止信号低延迟且保序。
 *  - dropSession：取消路径用，瞬间清空该 session 的待发条目。
 * 纯模块（不依赖 Electron），出口由构造注入。
 */
export interface QueuedNotification {
  channel: string;
  sessionId: string;
  params: unknown;
}

export interface NotificationQueueOptions {
  /** 批量外送间隔，默认 16ms ≈ 1 帧。 */
  flushIntervalMs?: number;
  /** 每 session 待发软上限，超限触发合并，默认 64。 */
  maxPerSession?: number;
}

interface StreamParams {
  sessionId: string;
  text: string;
  seq: number;
}

export class NotificationQueue {
  private entries: QueuedNotification[] = [];
  private readonly counts = new Map<string, number>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private readonly flushIntervalMs: number;
  private readonly maxPerSession: number;

  constructor(
    private readonly send: (channel: string, params: unknown) => void,
    opts: NotificationQueueOptions = {},
  ) {
    this.flushIntervalMs = opts.flushIntervalMs ?? 16;
    this.maxPerSession = opts.maxPerSession ?? 64;
  }

  push(n: QueuedNotification, opts: { urgent?: boolean } = {}): void {
    if (this.disposed) return;
    this.entries.push(n);
    const count = (this.counts.get(n.sessionId) ?? 0) + 1;
    this.counts.set(n.sessionId, count);
    if (count > this.maxPerSession) this.mergeSession(n.sessionId);
    if (opts.urgent) this.flushNow();
    else this.scheduleFlush();
  }

  /** 合并 sessionId 的相邻 chat.stream 条目（仅全局相邻才合并，保总序）。 */
  private mergeSession(sessionId: string): void {
    let merged = 0;
    for (let i = this.entries.length - 1; i > 0; i--) {
      const cur = this.entries[i]!;
      const prev = this.entries[i - 1]!;
      if (
        cur.channel === 'chat.stream' &&
        prev.channel === 'chat.stream' &&
        cur.sessionId === sessionId &&
        prev.sessionId === sessionId
      ) {
        const a = prev.params as StreamParams;
        const b = cur.params as StreamParams;
        this.entries.splice(i - 1, 2, {
          channel: 'chat.stream',
          sessionId,
          params: { sessionId: a.sessionId, text: a.text + b.text, seq: b.seq },
        });
        merged++;
      }
    }
    if (merged > 0) this.counts.set(sessionId, (this.counts.get(sessionId) ?? 0) - merged);
  }

  dropSession(sessionId: string): void {
    this.entries = this.entries.filter((e) => e.sessionId !== sessionId);
    this.counts.delete(sessionId);
  }

  flushNow(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const batch = this.entries;
    this.entries = [];
    this.counts.clear();
    for (const n of batch) this.send(n.channel, n.params);
  }

  private scheduleFlush(): void {
    if (this.timer || this.disposed) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flushNow();
    }, this.flushIntervalMs);
  }

  /** 测试观测：当前待发条数（按 session 或全局）。 */
  pendingCount(sessionId?: string): number {
    if (sessionId === undefined) return this.entries.length;
    return this.counts.get(sessionId) ?? 0;
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.entries = [];
    this.counts.clear();
  }
}
