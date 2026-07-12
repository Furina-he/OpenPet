/**
 * update-service（⑪ 发布批次）——electron-updater 集成：自动检查、手动装。
 *
 * - 状态机 idle/disabled/checking/available/none/downloading/ready/error，每次迁移
 *   广播 `update.status`（关于页驱动；schema 见 @openpet/protocol update-config）。
 * - 门控：dev（isPackaged=false）与 portable（PORTABLE_EXECUTABLE_DIR）全禁用。
 * - 周期：start() 后 30s 首查 + 每 24h（`general.autoUpdate` pref 门，tick 时现读——
 *   关掉只跳过本次，排程保持，改回开即恢复）；手动 check 不受 pref 门（用户主动）。
 * - autoDownload:false 硬约束（自动查手动装）；install 走确认对话框后 quitAndInstall，
 *   绝不静默重启（桌宠常驻场景尊重用户）。
 * - 检查失败静默广播 error 状态（中国网络到 GitHub 不稳是常态，不弹窗骚扰）。
 *
 * updater 实例注入（UpdaterLike 窄接口）——状态机与节流逻辑纯单测。
 */
import type { Prefs, UpdateStatus } from '@openpet/protocol';

export interface UpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit?: boolean;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(): void;
}

export type UpdateMode = 'packaged' | 'dev' | 'portable';

export interface UpdateServiceOptions {
  updater: UpdaterLike;
  mode: UpdateMode;
  getPrefs: () => Prefs;
  broadcast: (channel: string, params: unknown) => void;
  /** 重启安装确认（生产 dialog.showMessageBox；测试注入）。 */
  confirmInstall: () => Promise<boolean>;
  /** 定时注入（测试手动触发）；缺省真 setTimeout（unref 防阻退出）。 */
  schedule?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearSchedule?: (t: ReturnType<typeof setTimeout>) => void;
  now?: () => number;
}

export const FIRST_CHECK_DELAY_MS = 30_000;
export const CHECK_INTERVAL_MS = 24 * 3600_000;

/** electron-updater releaseNotes 归一：string | ReleaseNoteInfo[] | null → string。 */
export function normalizeNotes(notes: unknown): string {
  if (typeof notes === 'string') return notes;
  if (Array.isArray(notes)) {
    return notes
      .map((n) => (typeof (n as { note?: unknown }).note === 'string' ? (n as { note: string }).note : ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

export interface UpdateService {
  /** 手动触发检查（关于页按钮）；返回触发后即时状态。 */
  check(): Promise<UpdateStatus>;
  download(): Promise<void>;
  install(): Promise<void>;
  /** 启动周期检查（whenReady 后调一次）。 */
  start(): void;
  stop(): void;
  status(): UpdateStatus;
}

export function createUpdateService(opts: UpdateServiceOptions): UpdateService {
  const {
    updater,
    mode,
    getPrefs,
    broadcast,
    confirmInstall,
    now = Date.now,
  } = opts;
  const schedule =
    opts.schedule ??
    ((fn: () => void, ms: number) => {
      const t = setTimeout(fn, ms);
      t.unref?.();
      return t;
    });
  const clearSchedule = opts.clearSchedule ?? ((t: ReturnType<typeof setTimeout>) => clearTimeout(t));

  let current: UpdateStatus =
    mode === 'packaged' ? { state: 'idle' } : { state: 'disabled', reason: mode };
  let timer: ReturnType<typeof setTimeout> | null = null;

  const set = (next: UpdateStatus): void => {
    current = next;
    broadcast('update.status', next);
  };

  // 事件面（electron-updater 命名）：状态机唯一迁移入口。
  updater.autoDownload = false; // 自动查手动装（硬约束）
  if ('autoInstallOnAppQuit' in updater) updater.autoInstallOnAppQuit = false;
  updater.on('checking-for-update', () => set({ state: 'checking' }));
  updater.on('update-available', (...args: unknown[]) => {
    const info = (args[0] ?? {}) as { version?: string; releaseNotes?: unknown };
    set({
      state: 'available',
      version: info.version ?? '?',
      notes: normalizeNotes(info.releaseNotes),
    });
  });
  updater.on('update-not-available', () => set({ state: 'none', checkedAt: now() }));
  updater.on('download-progress', (...args: unknown[]) => {
    const p = (args[0] ?? {}) as { percent?: number };
    set({ state: 'downloading', percent: Math.min(100, Math.max(0, p.percent ?? 0)) });
  });
  updater.on('update-downloaded', (...args: unknown[]) => {
    const info = (args[0] ?? {}) as { version?: string };
    set({ state: 'ready', version: info.version ?? '?' });
  });
  updater.on('error', (...args: unknown[]) => {
    // 静默：广播 error 态记入状态（关于页显示上次检查结果），不打扰
    const e = args[0];
    console.warn('[update] electron-updater error:', e);
    set({ state: 'error', message: String((e as Error)?.message ?? e), checkedAt: now() });
  });

  const doCheck = async (): Promise<UpdateStatus> => {
    if (mode !== 'packaged') return current; // disabled 恒定
    if (current.state === 'checking' || current.state === 'downloading') return current;
    try {
      await updater.checkForUpdates(); // 'checking-for-update' 事件迁移状态
    } catch (e) {
      console.warn('[update] checkForUpdates failed:', e);
      set({ state: 'error', message: String((e as Error)?.message ?? e), checkedAt: now() });
    }
    return current;
  };

  const tick = (): void => {
    // 每轮现读 pref：关 = 跳过本次；排程保持（改回开下一轮生效）
    if (getPrefs()['general.autoUpdate'] === true) void doCheck();
    timer = schedule(tick, CHECK_INTERVAL_MS);
  };

  return {
    check: () => doCheck(),
    async download(): Promise<void> {
      if (mode !== 'packaged') return;
      if (current.state !== 'available') return;
      try {
        await updater.downloadUpdate(); // 进度/完成走事件
      } catch (e) {
        console.warn('[update] downloadUpdate failed:', e);
        set({ state: 'error', message: String((e as Error)?.message ?? e), checkedAt: now() });
      }
    },
    async install(): Promise<void> {
      if (current.state !== 'ready') return;
      if (await confirmInstall()) updater.quitAndInstall();
    },
    start(): void {
      if (mode !== 'packaged' || timer !== null) return;
      timer = schedule(tick, FIRST_CHECK_DELAY_MS);
    },
    stop(): void {
      if (timer !== null) clearSchedule(timer);
      timer = null;
    },
    status: () => current,
  };
}
