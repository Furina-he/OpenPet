import { describe, it, expect, vi } from 'vitest';
import { createOnboardingService } from '../electron/main/onboarding-service';

function fakeWin() {
  return { isDestroyed: () => false, hide: vi.fn(), show: vi.fn() };
}

describe('onboarding-service · finishOnboarding', () => {
  it('置 onboarding.completed=true + 隐引导窗 + 显 overlay', async () => {
    const set = vi.fn();
    const onboarding = fakeWin();
    const overlay = fakeWin();
    const svc = createOnboardingService({
      prefsStore: { set, getAll: () => ({}) as never, close: () => {} },
      onboardingWindow: () => onboarding as never,
      overlayWindow: () => overlay as never,
    });
    const r = await svc['app.window.finishOnboarding']();
    expect(r).toEqual({ ok: true });
    expect(set).toHaveBeenCalledWith('onboarding.completed', true);
    expect(onboarding.hide).toHaveBeenCalled();
    expect(overlay.show).toHaveBeenCalled();
  });

  it('窗口缺失时安全 no-op（仍置 flag）', async () => {
    const set = vi.fn();
    const svc = createOnboardingService({
      prefsStore: { set, getAll: () => ({}) as never, close: () => {} },
      onboardingWindow: () => null,
      overlayWindow: () => null,
    });
    await expect(svc['app.window.finishOnboarding']()).resolves.toEqual({ ok: true });
    expect(set).toHaveBeenCalledWith('onboarding.completed', true);
  });
});
