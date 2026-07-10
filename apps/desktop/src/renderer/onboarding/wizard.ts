/**
 * 首启引导步骤状态机（纯函数，便于单测）。
 * 4 步指示器：welcome/model/character/firstchat；firstchat 之后是完成页（finished=true，
 * 不计入指示器）。next/back 为不可变 reducer，App.vue 持 ref<WizardState> 调用。
 */
export const STEPS = ['welcome', 'model', 'character', 'firstchat'] as const;
export type Step = (typeof STEPS)[number];

export interface WizardState {
  stepIndex: number;
  finished: boolean;
}

export const initialWizard: WizardState = { stepIndex: 0, finished: false };

export function next(s: WizardState): WizardState {
  if (s.finished) return s;
  if (s.stepIndex >= STEPS.length - 1) return { ...s, finished: true };
  return { ...s, stepIndex: s.stepIndex + 1 };
}

export function back(s: WizardState): WizardState {
  if (s.finished) return { ...s, finished: false };
  return { ...s, stepIndex: Math.max(0, s.stepIndex - 1) };
}

export function currentStep(s: WizardState): Step {
  return STEPS[s.stepIndex]!;
}

/** 1-based 步序，给指示器显示「第 N 步 / 共 4 步」。 */
export function stepNumber(s: WizardState): number {
  return s.stepIndex + 1;
}

/** dev harness：`?step=welcome|model|character|firstchat|done` → 初始态。 */
export function wizardFromStep(name: string | null): WizardState {
  if (name === 'done') return { stepIndex: STEPS.length - 1, finished: true };
  const i = STEPS.indexOf(name as Step);
  return i >= 0 ? { stepIndex: i, finished: false } : initialWizard;
}
