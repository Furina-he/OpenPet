import { Worker } from 'node:worker_threads';

export interface PluginHostOptions {
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  /** Called when a respawn is scheduled, with the delay used. For tests/observability. */
  onRespawnScheduled?: (waitMs: number) => void;
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

interface WorkerMessage {
  id?: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/**
 * Supervises a single worker_threads worker running the sidecar JSON-RPC server.
 * Round-trips `call(method, params)` over MessagePort; on worker death restarts
 * with exponential backoff. Backoff resets only on a healthy response (proof of
 * life), so a crash-on-start worker keeps climbing toward the cap.
 */
export class PluginHost {
  private worker: Worker | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private readonly base: number;
  private readonly max: number;
  private backoff: number;
  private disposed = false;
  private restarting = false;
  private respawnTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly onRespawnScheduled: ((waitMs: number) => void) | undefined;

  constructor(
    private readonly entryPath: string,
    opts: PluginHostOptions = {},
  ) {
    this.base = opts.baseBackoffMs ?? 1_000;
    this.max = opts.maxBackoffMs ?? 30_000;
    this.backoff = this.base;
    this.onRespawnScheduled = opts.onRespawnScheduled;
    this.spawn();
  }

  private spawn(): void {
    if (this.disposed) return;
    this.restarting = false;
    const worker = new Worker(this.entryPath, {
      resourceLimits: { maxOldGenerationSizeMb: 128 },
    });
    this.worker = worker;

    worker.on('message', (msg: WorkerMessage) => {
      this.backoff = this.base; // healthy: a reply came back
      if (typeof msg.id !== 'number') return;
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) {
        p.reject(Object.assign(new Error(msg.error.message), msg.error));
      } else {
        p.resolve(msg.result);
      }
    });
    worker.on('error', (e) => this.handleDeath(e));
    worker.on('exit', (code) => {
      if (code !== 0) this.handleDeath(new Error(`worker exited with code ${code}`));
    });
  }

  private handleDeath(err: Error): void {
    if (this.restarting || this.disposed) return;
    this.restarting = true;
    this.worker = null;
    for (const p of this.pending.values()) p.reject(new Error(`worker died: ${err.message}`));
    this.pending.clear();

    const wait = this.backoff;
    this.backoff = Math.min(this.backoff * 2, this.max);
    this.onRespawnScheduled?.(wait);
    this.respawnTimer = setTimeout(() => this.spawn(), wait);
  }

  async call(method: string, params?: unknown): Promise<unknown> {
    if (this.disposed) throw new Error('PluginHost disposed');
    const worker = this.worker;
    if (!worker) throw new Error('worker not ready');
    const id = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ jsonrpc: '2.0', id, method, params });
    });
  }

  /** Spike-only: simulate a crash. Triggers exit → backoff respawn. */
  terminate(): void {
    void this.worker?.terminate();
  }

  /** Permanent shutdown: stop respawning and clear timers/pending. */
  async dispose(): Promise<void> {
    this.disposed = true;
    if (this.respawnTimer) {
      clearTimeout(this.respawnTimer);
      this.respawnTimer = null;
    }
    for (const p of this.pending.values()) p.reject(new Error('PluginHost disposed'));
    this.pending.clear();
    const w = this.worker;
    this.worker = null;
    if (w) await w.terminate();
  }
}
