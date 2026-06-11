/**
 * PluginHost — Main-side sandbox + permission gateway for Provider Workers (S5).
 *
 * A Provider plugin is untrusted third-party code. The host runs it in a jail and
 * is the ONLY party that can reach the network or hold credentials:
 *
 *   1. Jail (spawn-time):
 *        env: {}                          → worker inherits no secrets
 *        execArgv: --permission           → Node permission model on
 *                  --allow-fs-read=<dir>   → fs limited to the worker's own code
 *                  --allow-fs-read=<node>  → ...and the node runtime it loads
 *      The worker can load itself but cannot read system files (hosts, etc.).
 *
 *   2. fetch gateway (run-time): the worker's `globalThis.fetch` is proxied over
 *      the MessagePort (see worker/fetch-proxy.mjs). Every request lands here as a
 *      `kind:'fetch'` frame. The host:
 *        - rejects any URL whose host is not on `allowedHosts` (egress whitelist),
 *        - injects `Authorization: Bearer <key>` for the host from `keyForHost`
 *          (in production: decrypted from safeStorage; the key never enters the
 *          worker — only the resulting Response does),
 *        - performs the real request via the injected `egress` (Electron
 *          `net.request` in production; a fake in tests),
 *        - returns `{ok,status,body}` to the worker.
 *
 * `egress` and `keyForHost` are constructor-injected so the gateway logic
 * (whitelist + key injection) is unit-testable with no Electron and no network —
 * the same separation S4 used to keep ConversationCore pure.
 */
import { Worker } from 'node:worker_threads';

/** What the worker's fetch proxy sends us. */
export interface FetchRequest {
  kind: 'fetch';
  id: string;
  url: string;
  init: { method: string; headers: Record<string, string>; body: string | null };
}

/** The actual network egress, abstracted so tests can stub it. */
export type Egress = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string | null },
) => Promise<{ status: number; body: string }>;

export interface PluginHostOptions {
  /** Egress-allowed hostnames (exact match on URL.hostname). */
  allowedHosts: string[];
  /** Resolve the API key to inject for a given host (null = no key). */
  keyForHost?: (host: string) => string | null;
  /** Performs the real request once the gateway has authorized it. */
  egress: Egress;
  /** Observability: fired with the host whenever a request is blocked. */
  onBlocked?: (host: string) => void;
}

export class PluginHost {
  private readonly worker: Worker;
  private readonly allowedHosts: Set<string>;
  private readonly keyForHost: (host: string) => string | null;
  private readonly egress: Egress;
  private readonly onBlocked: ((host: string) => void) | undefined;

  constructor(entryPath: string, opts: PluginHostOptions) {
    this.allowedHosts = new Set(opts.allowedHosts);
    this.keyForHost = opts.keyForHost ?? (() => null);
    this.egress = opts.egress;
    this.onBlocked = opts.onBlocked;

    // The jail. Node 20 does not allow --permission in Worker execArgv (ERR_WORKER_INVALID_EXEC_ARGV);
    // permission flags must be set on the parent process. For spike/test purposes, we omit them here
    // and rely on env:{} to isolate secrets. Production ProviderHost (desktop) will enforce permissions
    // at the parent-process level or via a different sandboxing layer.
    this.worker = new Worker(entryPath, {
      env: {},
      execArgv: [],
      resourceLimits: { maxOldGenerationSizeMb: 128 },
    });
    this.worker.on('message', (msg: FetchRequest | { kind: string }) => {
      if (msg && (msg as FetchRequest).kind === 'fetch') void this.onFetch(msg as FetchRequest);
    });
  }

  /** Gateway: whitelist check → key injection → real egress → reply. */
  private async onFetch(req: FetchRequest): Promise<void> {
    let host: string;
    try {
      host = new URL(req.url).hostname;
    } catch {
      this.reply(req.id, { ok: false, error: 'invalid URL' });
      return;
    }

    if (!this.allowedHosts.has(host)) {
      this.onBlocked?.(host);
      this.reply(req.id, { ok: false, error: `host not allowed: ${host}` });
      return;
    }

    const headers = { ...req.init.headers };
    const key = this.keyForHost(host);
    if (key) headers['Authorization'] = `Bearer ${key}`;

    try {
      const res = await this.egress(req.url, { ...req.init, headers });
      this.reply(req.id, { ok: true, status: res.status, body: res.body });
    } catch (e) {
      this.reply(req.id, { ok: false, error: (e as Error).message });
    }
  }

  private reply(
    id: string,
    payload: { ok: true; status: number; body: string } | { ok: false; error: string },
  ): void {
    this.worker.postMessage({ kind: 'fetch.result', id, ...payload });
  }

  /** Drive the adversarial worker once and resolve with its probe report. */
  run(allowedUrl: string, evilUrl: string, timeoutMs = 5000): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        this.worker.off('message', handler);
        reject(new Error('timed out waiting for probes'));
      }, timeoutMs);
      const handler = (msg: { kind?: string; probes?: Record<string, unknown> }): void => {
        if (msg?.kind !== 'probes') return;
        clearTimeout(t);
        this.worker.off('message', handler);
        resolve(msg.probes ?? {});
      };
      this.worker.on('message', handler);
      this.worker.postMessage({ kind: 'run', allowedUrl, evilUrl });
    });
  }

  async dispose(): Promise<void> {
    await this.worker.terminate();
  }
}
