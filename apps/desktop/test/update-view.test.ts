import { describe, it, expect } from 'vitest';
import { updateButtonView } from '../src/renderer/settings/update-view.js';

describe('updateButtonView（关于页按钮状态机映射）', () => {
  it('idle → 检查更新可点', () => {
    const v = updateButtonView({ state: 'idle' });
    expect(v.labelKey).toBe('settings.about.checkUpdate');
    expect(v.action).toBe('check');
    expect(v.disabled).toBe(false);
    expect(v.badge).toBe(false);
  });

  it('disabled(dev/portable) → 禁用 + 对应指引', () => {
    expect(updateButtonView({ state: 'disabled', reason: 'dev' }).hintKey).toBe(
      'settings.about.updateDevHint',
    );
    const p = updateButtonView({ state: 'disabled', reason: 'portable' });
    expect(p.hintKey).toBe('settings.about.updatePortableHint');
    expect(p.disabled).toBe(true);
  });

  it('checking → 检查中禁用', () => {
    const v = updateButtonView({ state: 'checking' });
    expect(v.labelKey).toBe('settings.about.updateChecking');
    expect(v.disabled).toBe(true);
  });

  it('available → 下载 v{version} + badge + notes', () => {
    const v = updateButtonView({ state: 'available', version: '0.2.0', notes: '修复' });
    expect(v.labelKey).toBe('settings.about.updateDownload');
    expect(v.labelParams).toEqual({ version: '0.2.0' });
    expect(v.action).toBe('download');
    expect(v.badge).toBe(true);
    expect(v.notes).toBe('修复');
  });

  it('none → 已最新 hint，可再查', () => {
    const v = updateButtonView({ state: 'none', checkedAt: 1 });
    expect(v.hintKey).toBe('settings.about.updateUpToDate');
    expect(v.action).toBe('check');
  });

  it('downloading → 进度%（取整）禁用', () => {
    const v = updateButtonView({ state: 'downloading', percent: 41.5 });
    expect(v.labelParams).toEqual({ percent: 42 });
    expect(v.disabled).toBe(true);
  });

  it('ready → 重启更新 + badge', () => {
    const v = updateButtonView({ state: 'ready', version: '0.2.0' });
    expect(v.labelKey).toBe('settings.about.updateRestart');
    expect(v.action).toBe('install');
    expect(v.badge).toBe(true);
  });

  it('error → 检查失败 hint + 原始 message 进 title，可重查', () => {
    const v = updateButtonView({ state: 'error', message: 'ETIMEDOUT', checkedAt: 1 });
    expect(v.hintKey).toBe('settings.about.updateFailed');
    expect(v.errorMessage).toBe('ETIMEDOUT');
    expect(v.action).toBe('check');
  });
});
