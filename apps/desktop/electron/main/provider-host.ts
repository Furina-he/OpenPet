/**
 * ProviderHost — Main 侧 provider worker 监督者（S2+S4+S5 合并生产版）。
 *
 * 职责（M1 范围）：
 *  - 流式驱动：`send`/`cancel` 把 chat.start / chat.cancel 帧发给 worker，
 *    把 chat.event 帧经 `onEvent` 回调交给 ConversationCore。
 *  - 取消兜底（S4）：cancel 先协作，200ms watchdog 超时则强杀 worker、
 *    合成 done{cancel} 并立即重生（主动手术不计退避）。
 *  - 崩溃监督（S2）：worker 意外死亡 → 指数退避重启（封顶 30s）；
 *    **收到 worker 任何消息才重置退避**（健康证明），spawn 不重置 —— 否则
 *    crash-on-start 的 worker 会无限快速重启（S2 实证）。
 *  - 隔离（S5 子集）：`env:{}`，worker 不继承任何环境变量。
 *    `--permission` fs jail 与 fetch 网关随 M5 接入。
 *
 * 死亡清算：worker 死掉时所有 inflight 流收到合成 done —— 被 cancel 的收
 * `cancel`，其余收 `error`。UI 因此永不挂起。
 */
import { Worker } from 'node:worker_threads';
import type {
  ChatEvent,
  ChatStartFrame,
  ProviderOutboundFrame,
  PluginRequestFrame,
  PluginResponseFrame,
} from '@desksoul/protocol';

export interface ProviderHostOptions {
  /** 协作取消的宽限期，超时强杀（默认 200ms）。 */
  cancelGraceMs?: number;
  /** 意外死亡的重启退避基值（默认 1s）。 */
  baseBackoffMs?: number;
  /** 退避封顶（默认 30s）。 */
  maxBackoffMs?: number;
  /** 透传给 mock provider 的出块间隔（测试用）。 */
  intervalMs?: number;
  /** 观测钩子：watchdog 强杀时触发。 */
  onForceTerminate?: (requestId: string) => void;
  /** 观测钩子：调度重启时触发（参数为本次等待 ms）。 */
  onRespawnScheduled?: (waitMs: number) => void;
  /** Worker → Main 的 plugin.request 处理器（PluginGateway.handle）；缺省一律 -32601。 */
  onPluginRequest?: (frame: PluginRequestFrame) => Promise<PluginResponseFrame>;
}

interface Inflight {
  sessionId: string;
  cancelTimer: ReturnType<typeof setTimeout> | null;
}

export class ProviderHost {
  private worker: Worker | null = null;
  private readonly inflight = new Map<string, Inflight>();
  private nextRequestId = 1;
  private disposed = false;
  private readonly cancelGraceMs: number;
  private readonly base: number;
  private readonly max: number;
  private backoff: number;
  private respawnTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly intervalMs: number | undefined;
  private readonly onForceTerminate: ((requestId: string) => void) | undefined;
  private readonly onRespawnScheduled: ((waitMs: number) => void) | undefined;
  private readonly onPluginRequest:
    | ((frame: PluginRequestFrame) => Promise<PluginResponseFrame>)
    | undefined;

  constructor(
    private readonly entryPath: string,
    private readonly onEvent: (sessionId: string, event: ChatEvent) => void,
    opts: ProviderHostOptions = {},
  ) {
    this.cancelGraceMs = opts.cancelGraceMs ?? 200;
    this.base = opts.baseBackoffMs ?? 1_000;
    this.max = opts.maxBackoffMs ?? 30_000;
    this.backoff = this.base;
    this.intervalMs = opts.intervalMs;
    this.onForceTerminate = opts.onForceTerminate;
    this.onRespawnScheduled = opts.onRespawnScheduled;
    this.onPluginRequest = opts.onPluginRequest;
    this.spawn();
  }

  private spawn(): void {
    if (this.disposed) return;
    this.respawnTimer = null;
    const worker = new Worker(this.entryPath, {
      env: {}, // S5: 不继承环境变量，密钥隔离的零成本部分
      resourceLimits: { maxOldGenerationSizeMb: 128 },
    });
    this.worker = worker;
    worker.on('message', (msg: ProviderOutboundFrame) => {
      this.backoff = this.base; // 收到任何消息 = 健康证明，此刻才重置退避
      if (msg.kind === 'plugin.request') {
        void this.dispatchPluginRequest(worker, msg);
        return;
      }
      this.onWorkerMessage(msg);
    });
    // error 与 exit 可能对同一次死亡都触发；onDeath 以 worker 身份去重。
    worker.on('error', () => this.onDeath(worker));
    worker.on('exit', () => this.onDeath(worker));
  }

  private onWorkerMessage(msg: Extract<ProviderOutboundFrame, { kind: 'chat.event' }>): void {
    const entry = this.inflight.get(msg.requestId);
    if (!entry) return; // 已被 force-terminate / 死亡清算掉
    this.onEvent(msg.sessionId, msg.event);
    if (msg.event.type === 'done') this.settle(msg.requestId);
  }

  /** plugin.request → gateway → 响应帧回 worker。worker 已换代/已 dispose 则丢弃响应。 */
  private async dispatchPluginRequest(worker: Worker, frame: PluginRequestFrame): Promise<void> {
    const respond = (res: PluginResponseFrame): void => {
      if (this.worker === worker && !this.disposed) worker.postMessage(res);
    };
    if (!this.onPluginRequest) {
      respond({
        kind: 'plugin.response',
        rpc: {
          jsonrpc: '2.0',
          id: frame.rpc.id,
          error: { code: -32601, message: 'plugin gateway unavailable' },
        },
      });
      return;
    }
    try {
      respond(await this.onPluginRequest(frame));
    } catch (e) {
      // gateway 契约是永不 reject；这里只是双保险
      respond({
        kind: 'plugin.response',
        rpc: {
          jsonrpc: '2.0',
          id: frame.rpc.id,
          error: { code: -32000, message: e instanceof Error ? e.message : String(e) },
        },
      });
    }
  }

  /** 意外死亡：清算 inflight（合成 error done），按指数退避重生。 */
  private onDeath(dead: Worker): void {
    if (this.disposed || this.worker !== dead) return;
    this.worker = null;
    for (const [requestId, entry] of this.inflight) {
      if (entry.cancelTimer) clearTimeout(entry.cancelTimer);
      this.inflight.delete(requestId);
      this.onEvent(entry.sessionId, { type: 'done', finishReason: 'error' });
    }
    const wait = this.backoff;
    this.backoff = Math.min(this.backoff * 2, this.max);
    this.onRespawnScheduled?.(wait);
    this.respawnTimer = setTimeout(() => this.spawn(), wait);
  }

  /** 开始一个流，返回驱动它的 requestId。 */
  send(sessionId: string): string {
    if (this.disposed) throw new Error('ProviderHost disposed');
    if (!this.worker) throw new Error('provider worker not ready');
    const requestId = `r${this.nextRequestId++}`;
    this.inflight.set(requestId, { sessionId, cancelTimer: null });
    const frame: ChatStartFrame = {
      kind: 'chat.start',
      requestId,
      sessionId,
      ...(this.intervalMs !== undefined ? { intervalMs: this.intervalMs } : {}),
    };
    this.worker.postMessage(frame);
    return requestId;
  }

  /** 取消 `sessionId` 的所有 inflight：协作 cancel + 武装 watchdog。 */
  cancel(sessionId: string): void {
    for (const [requestId, entry] of this.inflight) {
      if (entry.sessionId !== sessionId || entry.cancelTimer) continue;
      this.worker?.postMessage({ kind: 'chat.cancel', requestId });
      entry.cancelTimer = setTimeout(() => this.forceTerminate(requestId), this.cancelGraceMs);
    }
  }

  /** watchdog 超时：强杀 worker，被取消者收 cancel done，连带者收 error done，立即重生。 */
  private forceTerminate(requestId: string): void {
    const entry = this.inflight.get(requestId);
    if (!entry) return;
    this.onForceTerminate?.(requestId);
    const dead = this.worker;
    this.worker = null; // 先置空：dead 稍后的 exit 在 onDeath 因身份不符成为 no-op
    void dead?.terminate();

    this.settle(requestId);
    this.onEvent(entry.sessionId, { type: 'done', finishReason: 'cancel' });
    // 同一 worker 上其他 session 的流被连带杀死
    for (const [rid, other] of this.inflight) {
      if (other.cancelTimer) clearTimeout(other.cancelTimer);
      this.inflight.delete(rid);
      this.onEvent(other.sessionId, { type: 'done', finishReason: 'error' });
    }
    this.spawn(); // 主动手术：立即重生，不计退避
  }

  private settle(requestId: string): void {
    const entry = this.inflight.get(requestId);
    if (entry?.cancelTimer) clearTimeout(entry.cancelTimer);
    this.inflight.delete(requestId);
  }

  /** 仅测试用：模拟 worker 崩溃（触发 onDeath → 退避重启路径）。 */
  killWorkerForTest(): void {
    void this.worker?.terminate();
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    if (this.respawnTimer) {
      clearTimeout(this.respawnTimer);
      this.respawnTimer = null;
    }
    for (const entry of this.inflight.values()) {
      if (entry.cancelTimer) clearTimeout(entry.cancelTimer);
    }
    this.inflight.clear();
    const w = this.worker;
    this.worker = null;
    if (w) await w.terminate();
  }
}
