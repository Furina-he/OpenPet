/**
 * StarHostService —— AstrBot Star 兼容宿主的 Main 侧（线 B-2 T6）。
 *
 * 生命周期：detectPython（python→python3，≥3.10）→ spawn `python main.py <pluginsDir>`
 * （venv python 优先——插件依赖装在 venv）→ stdout 行 JSON：plugins（元数据+健康证明，
 * 重置重启计数）/ result（按 id 唤醒 waiter）/ log。崩溃退避重启（provider-host 语义，
 * 耗尽 → error 广播）。tryHandle 未运行/超时一律 resolve null —— null=放行走 LLM，
 * **绝不阻塞聊天**。安装 = zip（zip-slip 校验 + GitHub 包一层剥壳）/文件夹 → pluginsDir，
 * requirements.txt 存在则 venv pip install（`star.pipIndexUrl` 作 -i 镜像）。
 */
import AdmZip from 'adm-zip';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { StarPluginMetaSchema, isSafeRelPath, type StarPluginMeta } from '@openpet/protocol';

export interface ChildLike {
  stdin: { write(s: string): void };
  stdout: { on(ev: 'data', cb: (b: Buffer | string) => void): void };
  stderr?: { on(ev: 'data', cb: (b: Buffer | string) => void): void };
  on(ev: 'exit', cb: (code: number | null) => void): void;
  kill(): void;
}

export interface StarHostServiceDeps {
  /** resources/star-host（main.py 所在）。 */
  hostDir: string;
  /** userData/star-plugins。 */
  pluginsDir: string;
  /** userData/star-host/venv。 */
  venvDir: string;
  broadcast: (channel: string, params: unknown) => void;
  /** 生产 child_process.spawn；测试注入 fake child。 */
  spawnImpl?: (cmd: string, args: string[]) => ChildLike;
  /** 探测/venv/pip 用命令执行器（生产 execFile）。 */
  execImpl?: (cmd: string, args: string[]) => Promise<{ stdout: string }>;
  /** 显式 python 路径（缺省 python→python3 探测）。 */
  pythonPath?: string;
  /** tryHandle 同步等待上限（默认 2000ms）。 */
  timeoutMs?: number;
  restartDelays?: number[];
  delay?: (ms: number) => Promise<void>;
  pipIndexUrl?: () => string;
  /** 禁用目录列表（`star.disabled` prefs）——spawn 时作 argv[2] 传宿主，加载层跳过。 */
  disabledDirs?: () => string[];
  log?: (msg: string) => void;
}

export interface StarHostService {
  detectPython(): Promise<{ found: boolean; version?: string }>;
  /** 同步读探测缓存（plugins.list 用；未探测过 → {found:false}）。 */
  pythonInfo(): { found: boolean; version?: string };
  start(): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<void>;
  metas(): StarPluginMeta[];
  tryHandle(
    origin: string,
    kind: 'private' | 'group',
    senderId: string,
    senderName: string,
    text: string,
    isAdmin: boolean,
  ): Promise<{ handled: boolean; replies: string[] } | null>;
  installStar(srcPath: string): Promise<{ dir: string }>;
  uninstallStar(dir: string): Promise<void>;
}

export function createStarHostService(deps: StarHostServiceDeps): StarHostService {
  const spawnImpl = deps.spawnImpl ?? (() => {
    throw new Error('spawnImpl not configured');
  });
  const execImpl = deps.execImpl ?? (() => Promise.reject(new Error('execImpl not configured')));
  const timeoutMs = deps.timeoutMs ?? 2_000;
  const delays = deps.restartDelays ?? [500, 1_000, 2_000];
  const delay = deps.delay ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const log = deps.log ?? ((msg: string) => console.info(`[star-host] ${msg}`));
  const mainPy = path.join(deps.hostDir, 'main.py');

  let detected: { found: boolean; version?: string } | null = null;
  let pythonCmd: string | null = null;
  let current: ChildLike | null = null;
  let stopped = false;
  let attempts = 0;
  let seq = 0;
  let metas: StarPluginMeta[] = [];
  const waiters = new Map<number, (r: { handled: boolean; replies: string[] } | null) => void>();

  const venvPython = (): string | null => {
    const p =
      process.platform === 'win32'
        ? path.join(deps.venvDir, 'Scripts', 'python.exe')
        : path.join(deps.venvDir, 'bin', 'python');
    return existsSync(p) ? p : null;
  };

  const status = (s: 'running' | 'restarting' | 'error', lastError?: string): void => {
    deps.broadcast('plugin.status', {
      runtime: 'star',
      id: 'star-host',
      status: s,
      ...(lastError !== undefined ? { lastError } : {}),
    });
  };

  const handleLine = (line: string): void => {
    let f: Record<string, unknown>;
    try {
      f = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return; // 坏行丢弃
    }
    if (f.type === 'plugins') {
      const parsed: StarPluginMeta[] = [];
      for (const item of (f.list as unknown[]) ?? []) {
        const r = StarPluginMetaSchema.safeParse(item);
        if (r.success) parsed.push(r.data);
      }
      metas = parsed;
      attempts = 0; // 健康证明：成功起来才重置重启计数
      status('running');
    } else if (f.type === 'result') {
      const w = waiters.get(f.id as number);
      if (!w) return;
      waiters.delete(f.id as number);
      w({
        handled: Boolean(f.handled),
        replies: ((f.replies as unknown[]) ?? []).map(String),
      });
    } else if (f.type === 'log') {
      log(`${String(f.level)}: ${String(f.msg)}`);
    }
  };

  const spawnHost = (): void => {
    const cmd = venvPython() ?? pythonCmd;
    if (!cmd) return;
    const disabled = deps.disabledDirs?.() ?? [];
    const c = spawnImpl(cmd, [mainPy, deps.pluginsDir, disabled.join(',')]);
    current = c;
    let buf = '';
    c.stdout.on('data', (d) => {
      buf += d.toString();
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line) handleLine(line);
      }
    });
    c.stderr?.on('data', (d) => log(`stderr: ${d.toString().trim()}`));
    c.on('exit', (code) => {
      if (current !== c) return; // 已 stop / 已被替换
      current = null;
      for (const [, w] of waiters) w(null);
      waiters.clear();
      const next = attempts + 1;
      if (next > delays.length) {
        status('error', `star-host exited (code ${code}), restarts exhausted`);
        return;
      }
      attempts = next;
      status('restarting');
      void delay(delays[next - 1] ?? 0).then(() => {
        if (!stopped && !current) spawnHost();
      });
    });
  };

  const service: StarHostService = {
    async detectPython() {
      if (detected) return detected;
      const candidates = deps.pythonPath ? [deps.pythonPath] : ['python', 'python3'];
      for (const cmd of candidates) {
        try {
          const { stdout } = await execImpl(cmd, ['--version']);
          const m = /Python (\d+)\.(\d+)(?:\.(\d+))?/.exec(stdout);
          if (m && (Number(m[1]) > 3 || (Number(m[1]) === 3 && Number(m[2]) >= 10))) {
            pythonCmd = cmd;
            detected = {
              found: true,
              version: `${m[1]}.${m[2]}${m[3] !== undefined ? `.${m[3]}` : ''}`,
            };
            return detected;
          }
        } catch {
          /* 下一个候选 */
        }
      }
      detected = { found: false };
      return detected;
    },

    pythonInfo() {
      return detected ?? { found: false };
    },

    async start() {
      if (current) return;
      const d = await service.detectPython();
      if (!d.found) return; // Star 区降级：无 python 不 spawn，桌面/Desktop 插件不受影响
      stopped = false;
      spawnHost();
    },

    async stop() {
      stopped = true;
      const c = current;
      current = null; // 先置空：exit handler 身份不符 → 不触发重启
      for (const [, w] of waiters) w(null);
      waiters.clear();
      c?.kill();
    },

    async restart() {
      await service.stop();
      attempts = 0;
      await service.start();
    },

    metas() {
      return metas;
    },

    tryHandle(origin, kind, senderId, senderName, text, isAdmin) {
      const c = current;
      if (!c) return Promise.resolve(null);
      seq += 1;
      const id = seq;
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          waiters.delete(id);
          resolve(null); // 超时=放行走 LLM，绝不阻塞聊天
        }, timeoutMs);
        waiters.set(id, (r) => {
          clearTimeout(timer);
          resolve(r);
        });
        c.stdin.write(
          `${JSON.stringify({ type: 'event', id, origin, kind, senderId, senderName, text, isAdmin })}\n`,
        );
      });
    },

    async installStar(srcPath) {
      mkdirSync(deps.pluginsDir, { recursive: true });
      let stagedRoot: string;
      let dirName: string;
      let cleanup: (() => void) | null = null;

      if (statSync(srcPath).isDirectory()) {
        stagedRoot = srcPath;
        dirName = path.basename(srcPath);
      } else {
        const zip = new AdmZip(srcPath);
        for (const e of zip.getEntries()) {
          const name = e.entryName.replace(/\/$/, '');
          if (name.length > 0 && !isSafeRelPath(name)) {
            throw new Error(`包内非法路径: ${e.entryName}`);
          }
        }
        const staging = mkdtempSync(path.join(tmpdir(), 'ds-star-'));
        cleanup = () => rmSync(staging, { recursive: true, force: true });
        zip.extractAllTo(staging, true);
        if (existsSync(path.join(staging, 'main.py'))) {
          stagedRoot = staging;
          dirName = path.basename(srcPath).replace(/\.(zip|tar\.gz)$/i, '');
        } else {
          // GitHub 下载的 zip 通常包一层 <repo>-<branch>/ —— 唯一子目录剥壳。
          const entries = readdirSync(staging).filter((n) =>
            statSync(path.join(staging, n)).isDirectory(),
          );
          const sub = entries.length === 1 ? entries[0] : undefined;
          if (sub === undefined || !existsSync(path.join(staging, sub, 'main.py'))) {
            cleanup();
            throw new Error('插件包缺少 main.py');
          }
          stagedRoot = path.join(staging, sub);
          dirName = sub;
        }
      }

      try {
        if (!existsSync(path.join(stagedRoot, 'main.py'))) {
          throw new Error('插件包缺少 main.py');
        }
        const dest = path.join(deps.pluginsDir, dirName);
        if (existsSync(dest)) throw new Error(`Star 插件 "${dirName}" 已存在`);
        cpSync(stagedRoot, dest, { recursive: true });

        // 依赖装配：requirements.txt 存在 → 确保 venv + pip install（镜像可配）。
        const req = path.join(dest, 'requirements.txt');
        if (existsSync(req) && pythonCmd) {
          if (!venvPython()) {
            await execImpl(pythonCmd, ['-m', 'venv', deps.venvDir]);
          }
          const pipUrl = deps.pipIndexUrl?.() ?? 'https://pypi.tuna.tsinghua.edu.cn/simple';
          await execImpl(venvPython() ?? pythonCmd, [
            '-m',
            'pip',
            'install',
            '-r',
            req,
            '-i',
            pipUrl,
          ]);
        }
      } finally {
        cleanup?.();
      }

      await service.restart();
      return { dir: dirName };
    },

    async uninstallStar(dir) {
      rmSync(path.join(deps.pluginsDir, dir), { recursive: true, force: true });
      await service.restart();
    },
  };

  return service;
}
