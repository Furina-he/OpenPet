import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { createUpdateService, type UpdaterLike } from '../electron/main/update-service.js';
import { DEFAULT_PREFS, type Prefs } from '@openpet/protocol';

/** electron-updater autoUpdater 的可控 fake：真事件面 + 可编程结果。 */
class FakeUpdater extends EventEmitter implements UpdaterLike {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  checkCalls = 0;
  downloadCalls = 0;
  installCalls = 0;
  checkForUpdates(): Promise<unknown> {
    this.checkCalls += 1;
    this.emit('checking-for-update');
    return Promise.resolve(null);
  }
  downloadUpdate(): Promise<unknown> {
    this.downloadCalls += 1;
    return Promise.resolve(null);
  }
  quitAndInstall(): void {
    this.installCalls += 1;
  }
}

function prefs(over: Partial<Prefs> = {}): Prefs {
  return { ...DEFAULT_PREFS, ...over };
}

interface SetupOpts {
  mode?: 'packaged' | 'dev' | 'portable';
  autoUpdate?: boolean;
  confirm?: boolean;
}
function setup(o: SetupOpts = {}) {
  const updater = new FakeUpdater();
  const sent: { channel: string; params: unknown }[] = [];
  const timers: { fn: () => void; ms: number }[] = [];
  const confirmInstall = vi.fn(async () => o.confirm ?? true);
  const svc = createUpdateService({
    updater,
    mode: o.mode ?? 'packaged',
    getPrefs: () => prefs({ 'general.autoUpdate': o.autoUpdate ?? true }),
    broadcast: (channel, params) => sent.push({ channel, params }),
    confirmInstall,
    schedule: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length - 1 as unknown as ReturnType<typeof setTimeout>;
    },
    clearSchedule: () => {},
  });
  const statuses = () =>
    sent.filter((s) => s.channel === 'update.status').map((s) => s.params as { state: string });
  return { svc, updater, sent, timers, statuses, confirmInstall };
}

describe('update-service · 门控', () => {
  it('dev 模式：check 返回 disabled(dev)，绝不碰 updater', async () => {
    const { svc, updater } = setup({ mode: 'dev' });
    const r = await svc.check();
    expect(r).toEqual({ state: 'disabled', reason: 'dev' });
    expect(updater.checkCalls).toBe(0);
  });

  it('portable 模式：disabled(portable)（关于页显示手动下载指引）', async () => {
    const { svc } = setup({ mode: 'portable' });
    expect(await svc.check()).toEqual({ state: 'disabled', reason: 'portable' });
  });

  it('构造即关 autoDownload（自动查手动装的硬约束）', () => {
    const { updater } = setup();
    expect(updater.autoDownload).toBe(false);
  });
});

describe('update-service · 状态机（事件 → update.status 广播）', () => {
  it('check → checking；update-available → available{version,notes}', async () => {
    const { svc, updater, statuses } = setup();
    await svc.check();
    updater.emit('update-available', { version: '0.2.0', releaseNotes: '修复若干' });
    const st = statuses();
    expect(st.some((s) => s.state === 'checking')).toBe(true);
    expect(st.at(-1)).toEqual({ state: 'available', version: '0.2.0', notes: '修复若干' });
    expect(svc.status()).toEqual({ state: 'available', version: '0.2.0', notes: '修复若干' });
  });

  it('update-not-available → none{checkedAt}', async () => {
    const { svc, updater, statuses } = setup();
    await svc.check();
    updater.emit('update-not-available', {});
    expect(statuses().at(-1)?.state).toBe('none');
  });

  it('download → download-progress → downloading{percent}；update-downloaded → ready{version}', async () => {
    const { svc, updater, statuses } = setup();
    await svc.check();
    updater.emit('update-available', { version: '0.2.0', releaseNotes: null });
    await svc.download();
    expect(updater.downloadCalls).toBe(1);
    updater.emit('download-progress', { percent: 41.5 });
    expect(statuses().at(-1)).toEqual({ state: 'downloading', percent: 41.5 });
    updater.emit('update-downloaded', { version: '0.2.0' });
    expect(statuses().at(-1)).toEqual({ state: 'ready', version: '0.2.0' });
  });

  it('error 事件 → error{message}（静默广播，不 throw）', async () => {
    const { svc, updater, statuses } = setup();
    await svc.check();
    updater.emit('error', new Error('ETIMEDOUT'));
    expect(statuses().at(-1)?.state).toBe('error');
    expect((statuses().at(-1) as { message?: string }).message).toContain('ETIMEDOUT');
  });

  it('checking 中重复 check 防抖（不二次触发 updater）', async () => {
    const { svc, updater } = setup();
    await svc.check();
    await svc.check();
    expect(updater.checkCalls).toBe(1);
  });

  it('richNotes（HTML string releaseNotes）与缺失都归一为 string', async () => {
    const { svc, updater } = setup();
    await svc.check();
    updater.emit('update-available', { version: '0.2.0' });
    expect((svc.status() as { notes?: string }).notes).toBe('');
  });
});

describe('update-service · install 确认', () => {
  it('确认 → quitAndInstall；拒绝 → 不装', async () => {
    const a = setup({ confirm: true });
    await a.svc.check();
    a.updater.emit('update-downloaded', { version: '0.2.0' });
    await a.svc.install();
    expect(a.updater.installCalls).toBe(1);

    const b = setup({ confirm: false });
    await b.svc.check();
    b.updater.emit('update-downloaded', { version: '0.2.0' });
    await b.svc.install();
    expect(b.updater.installCalls).toBe(0);
  });

  it('未 ready 时 install 是 no-op（不弹确认框）', async () => {
    const { svc, updater, confirmInstall } = setup();
    await svc.install();
    expect(confirmInstall).not.toHaveBeenCalled();
    expect(updater.installCalls).toBe(0);
  });
});

describe('update-service · 周期检查（启动 30s + 每 24h，autoUpdate pref 门）', () => {
  it('packaged + autoUpdate 开：start 安排 30s 首查，触发后安排 24h 下一轮', async () => {
    const { svc, updater, timers } = setup({ autoUpdate: true });
    svc.start();
    expect(timers.length).toBe(1);
    expect(timers[0]!.ms).toBe(30_000);
    timers[0]!.fn();
    expect(updater.checkCalls).toBe(1);
    expect(timers.length).toBe(2);
    expect(timers[1]!.ms).toBe(24 * 3600_000);
  });

  it('autoUpdate 关：定时 tick 跳过检查但保持排程（改回开即恢复）', () => {
    const { svc, updater, timers } = setup({ autoUpdate: false });
    svc.start();
    timers[0]!.fn();
    expect(updater.checkCalls).toBe(0);
    expect(timers.length).toBe(2); // 下一轮仍在
  });

  it('dev 模式 start 不排程', () => {
    const { svc, timers } = setup({ mode: 'dev' });
    svc.start();
    expect(timers.length).toBe(0);
  });
});
