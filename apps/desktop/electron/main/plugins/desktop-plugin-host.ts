/**
 * DesktopPluginHost — Desktop 插件 worker 监督者（线 B-2 T3，provider-host 同款语义）。
 *
 *  - 每插件一个 worker_threads（sidecar dist plugin-entry.js），init 帧喂
 *    manifest/entry/config，ready 帧回 tools/cues。
 *  - 工具连线名 = pluginToolWireName（p_<id>_<tool>）；toolNameMap 存 wire→local，
 *    callTool 按 wire 名路由回对应 worker 的 local 名。
 *  - 崩溃监督：意外退出 → 按 restartDelays 递进重启；ready 视为健康证明重置计数
 *    （provider-host「收到消息才重置退避」语义）；重启机会耗尽 → error + 不再重启。
 *  - 密钥永不进 worker：env:{} 不继承环境变量。
 */
import { Worker } from 'node:worker_threads';
import { pluginToolWireName, CueSchema } from '@openpet/protocol';
import type {
  ChatTool,
  Cue,
  DesktopPluginManifest,
  PluginRuntimeStatus,
} from '@openpet/protocol';

export interface DesktopPluginHostDeps {
  /** sidecar dist plugin-entry（index.ts 照 providerEntryPath 同款 require.resolve）。 */
  entryPath: string;
  broadcast: (channel: string, params: unknown) => void;
  /** 'say' 能力落点（pet.say）。 */
  say: (text: string) => void;
  /** 'fetch' 能力落点（Main 侧代理 + 域名日志）。 */
  proxyFetch: (
    url: string,
    init: Record<string, unknown>,
  ) => Promise<{ status: number; body: string }>;
  getConfig: (id: string) => Record<string, unknown>;
  /** 崩溃重启延迟序列（默认 [500,1000,2000]ms；长度即重启机会数，耗尽 → error）。 */
  restartDelays?: number[];
  /** 重启等待实现（默认真 setTimeout）；测试注入立即 resolve 防 flaky。 */
  delay?: (ms: number) => Promise<void>;
  /** callTool 无回包超时（默认 15s）。 */
  toolTimeoutMs?: number;
  /** 测试注入 worker 工厂。 */
  workerFactory?: (entryPath: string) => Worker;
}

type Frame = Record<string, unknown> & { t: string };

interface Running {
  worker: Worker;
  manifest: DesktopPluginManifest;
  dir: string;
  entryFile: string;
  tools: ChatTool[]; // wire 名（p_<id>_<tool>）
  toolNameMap: Map<string, string>; // wire → local
  cues: Cue[];
  status: PluginRuntimeStatus;
  restarts: number;
  lastError?: string;
  waiters: Map<number, { resolve: (v: string) => void; reject: (e: Error) => void }>;
}

export class DesktopPluginHost {
  private readonly running = new Map<string, Running>();
  private callSeq = 0;
  private readonly delay: (ms: number) => Promise<void>;

  constructor(private readonly deps: DesktopPluginHostDeps) {
    this.delay = deps.delay ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /** 启动（或重启）一个插件 worker；ready 前 tools/cues 为空。 */
  start(manifest: DesktopPluginManifest, dir: string, entryFile: string): void {
    this.spawn(manifest, dir, entryFile, 0);
  }

  private spawn(
    manifest: DesktopPluginManifest,
    dir: string,
    entryFile: string,
    attempt: number,
  ): void {
    const worker = (this.deps.workerFactory ?? ((p) => new Worker(p, { env: {} })))(
      this.deps.entryPath,
    );
    const r: Running = {
      worker,
      manifest,
      dir,
      entryFile,
      tools: [],
      toolNameMap: new Map(),
      cues: [],
      status: 'running',
      restarts: attempt,
      waiters: new Map(),
    };
    this.running.set(manifest.id, r);

    worker.on('message', (f: Frame) => {
      if (f.t === 'ready') {
        r.restarts = 0; // 健康证明：成功起来才重置重启计数
        const raw = f.tools as Array<{ name: string; description: string; parameters: unknown }>;
        r.toolNameMap = new Map(
          raw.map((t) => [pluginToolWireName(manifest.id, t.name), t.name]),
        );
        r.tools = raw.map((t) => ({ ...t, name: pluginToolWireName(manifest.id, t.name) }));
        const cues: Cue[] = [];
        for (const c of f.cues as unknown[]) {
          const parsed = CueSchema.safeParse(c);
          if (parsed.success) cues.push(parsed.data);
        }
        r.cues = cues;
        this.deps.broadcast('plugin.status', {
          runtime: 'desktop',
          id: manifest.id,
          status: 'running',
        });
      } else if (f.t === 'say') {
        this.deps.say(String(f.text));
      } else if (f.t === 'log') {
        console.info(`[plugin:${manifest.id}] ${String(f.msg)}`);
      } else if (f.t === 'toolResult') {
        const w = r.waiters.get(f.id as number);
        r.waiters.delete(f.id as number);
        if (!w) return;
        if (f.ok) w.resolve(JSON.stringify(f.result ?? null));
        else w.reject(new Error(String(f.error)));
      } else if (f.t === 'fetchRequest') {
        void this.deps
          .proxyFetch(String(f.url), (f.init as Record<string, unknown>) ?? {})
          .then((res) => worker.postMessage({ t: 'fetchResult', id: f.id, ...res }))
          .catch((e) =>
            worker.postMessage({ t: 'fetchResult', id: f.id, status: 0, body: String(e) }),
          );
      }
    });

    worker.on('exit', (code) => {
      if (this.running.get(manifest.id) !== r) return; // 已 stop / 已被新 worker 替换
      for (const [, w] of r.waiters) w.reject(new Error('plugin worker exited'));
      r.waiters.clear();
      const delays = this.deps.restartDelays ?? [500, 1000, 2000];
      const nextAttempt = r.restarts + 1;
      if (code === 0 || nextAttempt > delays.length) {
        r.status = 'error';
        r.lastError = `worker exited (code ${code}), restarts exhausted`;
        this.deps.broadcast('plugin.status', {
          runtime: 'desktop',
          id: manifest.id,
          status: 'error',
          lastError: r.lastError,
        });
        return;
      }
      r.status = 'restarting';
      this.deps.broadcast('plugin.status', {
        runtime: 'desktop',
        id: manifest.id,
        status: 'restarting',
      });
      void this.delay(delays[nextAttempt - 1] ?? 0).then(() => {
        if (this.running.get(manifest.id) !== r) return; // 等待期间被 stop
        this.spawn(manifest, dir, entryFile, nextAttempt);
      });
    });

    worker.postMessage({
      t: 'init',
      manifest,
      entryPath: entryFile,
      config: this.deps.getConfig(manifest.id),
    });
  }

  async stop(id: string): Promise<void> {
    const r = this.running.get(id);
    if (!r) return;
    this.running.delete(id);
    for (const [, w] of r.waiters) w.reject(new Error('plugin stopped'));
    r.waiters.clear();
    await r.worker.terminate();
  }

  async stopAll(): Promise<void> {
    for (const id of [...this.running.keys()]) await this.stop(id);
  }

  pushConfig(id: string, config: Record<string, unknown>): void {
    this.running.get(id)?.worker.postMessage({ t: 'config', config });
  }

  /** 工具口（wire 名）——tool-port-merge 消费。 */
  activeToolDefs(): ChatTool[] {
    return [...this.running.values()]
      .filter((r) => r.status === 'running')
      .flatMap((r) => r.tools);
  }

  ownsTool(name: string): boolean {
    return [...this.running.values()].some((r) => r.toolNameMap.has(name));
  }

  callTool(name: string, args: unknown): Promise<string> {
    const r = [...this.running.values()].find((x) => x.toolNameMap.has(name));
    const localName = r?.toolNameMap.get(name);
    if (!r || localName === undefined) {
      return Promise.reject(new Error(`no plugin owns tool ${name}`));
    }
    this.callSeq += 1;
    const id = this.callSeq;
    const timeoutMs = this.deps.toolTimeoutMs ?? 15_000;
    return new Promise<string>((resolve, reject) => {
      r.waiters.set(id, { resolve, reject });
      r.worker.postMessage({ t: 'toolCall', id, name: localName, args });
      setTimeout(() => {
        if (r.waiters.delete(id)) reject(new Error(`plugin tool ${name} timeout`));
      }, timeoutMs);
    });
  }

  activeCues(): Cue[] {
    return [...this.running.values()]
      .filter((r) => r.status === 'running')
      .flatMap((r) => r.cues);
  }

  statuses(): Array<{ id: string; status: PluginRuntimeStatus; lastError?: string }> {
    return [...this.running.values()].map((r) => ({
      id: r.manifest.id,
      status: r.status,
      ...(r.lastError !== undefined ? { lastError: r.lastError } : {}),
    }));
  }
}
