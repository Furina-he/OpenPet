/**
 * OnboardingService —— app.window.finishOnboarding 的 Main 编排（M7b-2）。
 * renderer 调一次即完成三动作：置完成 flag（直接 prefsStore.set，无需广播——
 * 仅下次启动判定用）+ 隐引导窗 + 显 overlay。仿 app-service 工厂，注入便于测。
 */
import type { BrowserWindow } from 'electron';
import type { PrefsStore } from './prefs/index.js';

export interface OnboardingServiceDeps {
  prefsStore: PrefsStore;
  onboardingWindow: () => BrowserWindow | null;
  overlayWindow: () => BrowserWindow | null;
}

export function createOnboardingService(deps: OnboardingServiceDeps) {
  return {
    'app.window.finishOnboarding': async () => {
      deps.prefsStore.set('onboarding.completed', true);
      const ob = deps.onboardingWindow();
      if (ob && !ob.isDestroyed()) ob.hide();
      const ov = deps.overlayWindow();
      if (ov && !ov.isDestroyed()) ov.show();
      return { ok: true as const };
    },
  };
}
