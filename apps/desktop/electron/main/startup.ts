/**
 * 启动期决策（纯函数，无 Electron 依赖，便于单测）。
 * M7b-2：未完成首启引导 → 先显引导窗、暂不显 overlay；否则常规流程。
 */
import type { Prefs } from '@desksoul/protocol';

export interface StartupDecision {
  showOnboarding: boolean;
}

export function decideStartup(prefs: Prefs): StartupDecision {
  return { showOnboarding: !prefs['onboarding.completed'] };
}
