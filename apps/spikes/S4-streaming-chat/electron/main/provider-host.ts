/**
 * ProviderHost — Main-side supervisor for the streaming provider worker.
 *
 * Spawns one worker running the sidecar `provider-worker-entry`, drives chat
 * streams over MessagePort, and fans `chat.event` frames back out via `onEvent`.
 *
 * Cancel semantics (S4 success criterion): `cancel(sessionId)` asks the worker
 * to abort and starts a 200ms watchdog. If the worker emits its terminal `done`
 * in time, that's the graceful path. If it doesn't (a wedged/looping provider),
 * the host force-`terminate()`s the worker, respawns it, and synthesizes a
 * `done{finishReason:'cancel'}` so the UI never hangs.
 */
import { Worker } from 'node:worker_threads';

export type ChatEvent =
  | { type: 'delta'; text: string }
  | { type: 'done'; finishReason: 'stop' | 'cancel' };

interface EventMessage {
  kind: 'chat.event';
  requestId: string;
  sessionId: string;
  event: ChatEvent;
}

export interface ProviderHostOptions {
  /** ms to wait for a graceful cancel before terminating the worker (default 200). */
  cancelGraceMs?: number;
  /** Per-chunk delay forwarded to the mock provider (tests use 0/small). */
  intervalMs?: number;
  /** Observability hook: fired when the cancel watchdog had to terminate. */
  onForceTerminate?: (requestId: string) => void;
}

interface Inflight {
  sessionId: string;
  /** Set while a cancel watchdog is armed. */
  cancelTimer: ReturnType<typeof setTimeout> | null;
}

export class ProviderHost {
  private worker: Worker | null = null;
  private readonly inflight = new Map<string, Inflight>();
  private nextRequestId = 1;
  private disposed = false;
  private readonly cancelGraceMs: number;
  private readonly intervalMs: number | undefined;
  private readonly onForceTerminate: ((requestId: string) => void) | undefined;

  constructor(
    private readonly entryPath: string,
    private readonly onEvent: (sessionId: string, event: ChatEvent) => void,
    opts: ProviderHostOptions = {},
  ) {
    this.cancelGraceMs = opts.cancelGraceMs ?? 200;
    this.intervalMs = opts.intervalMs;
    this.onForceTerminate = opts.onForceTerminate;
    this.spawn();
  }

  private spawn(): void {
    if (this.disposed) return;
    const worker = new Worker(this.entryPath, {
      resourceLimits: { maxOldGenerationSizeMb: 128 },
    });
    this.worker = worker;
    worker.on('message', (msg: EventMessage) => this.onWorkerMessage(msg));
    // `error` and `exit` can both fire for one death, and a force-terminate also
    // ends in `exit`; `replace` is idempotent and ignores any worker that is no
    // longer the current one, so a single death yields a single respawn.
    worker.on('error', () => this.replace(worker));
    worker.on('exit', () => this.replace(worker));
  }

  /** Respawn only if `dead` is still the active worker (dedupes error+exit). */
  private replace(dead: Worker): void {
    if (this.disposed || this.worker !== dead) return;
    this.worker = null;
    this.spawn();
  }

  private onWorkerMessage(msg: EventMessage): void {
    if (msg.kind !== 'chat.event') return;
    const entry = this.inflight.get(msg.requestId);
    if (!entry) return; // already torn down by a force-terminate
    this.onEvent(msg.sessionId, msg.event);
    if (msg.event.type === 'done') this.settle(msg.requestId);
  }

  /** Begin a stream for `sessionId`. Returns the requestId driving it. */
  send(sessionId: string): string {
    if (this.disposed) throw new Error('ProviderHost disposed');
    if (!this.worker) throw new Error('worker not ready');
    const requestId = `r${this.nextRequestId++}`;
    this.inflight.set(requestId, { sessionId, cancelTimer: null });
    this.worker.postMessage({
      kind: 'chat.start',
      requestId,
      sessionId,
      ...(this.intervalMs !== undefined ? { intervalMs: this.intervalMs } : {}),
    });
    return requestId;
  }

  /**
   * Cancel every in-flight stream for `sessionId`. Sends a cooperative cancel and
   * arms the watchdog; if the worker doesn't settle within the grace window it is
   * terminated and a synthetic cancel `done` is emitted.
   */
  cancel(sessionId: string): void {
    for (const [requestId, entry] of this.inflight) {
      if (entry.sessionId !== sessionId || entry.cancelTimer) continue;
      this.worker?.postMessage({ kind: 'chat.cancel', requestId });
      entry.cancelTimer = setTimeout(() => this.forceTerminate(requestId), this.cancelGraceMs);
    }
  }

  private forceTerminate(requestId: string): void {
    const entry = this.inflight.get(requestId);
    if (!entry) return;
    this.onForceTerminate?.(requestId);
    // Drop the wedged worker and spawn a fresh one synchronously. The dead
    // worker's later `exit` sees `this.worker !== dead` (now the new one) and
    // is a no-op, so we don't double-spawn.
    void this.worker?.terminate();
    this.worker = null;
    this.settle(requestId);
    this.onEvent(entry.sessionId, { type: 'done', finishReason: 'cancel' });
    this.spawn();
  }

  private settle(requestId: string): void {
    const entry = this.inflight.get(requestId);
    if (entry?.cancelTimer) clearTimeout(entry.cancelTimer);
    this.inflight.delete(requestId);
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    for (const entry of this.inflight.values()) {
      if (entry.cancelTimer) clearTimeout(entry.cancelTimer);
    }
    this.inflight.clear();
    const w = this.worker;
    this.worker = null;
    if (w) await w.terminate();
  }
}
