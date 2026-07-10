import { describe, it, expect } from 'vitest';
import {
  STEPS,
  initialWizard,
  next,
  back,
  currentStep,
  stepNumber,
  wizardFromStep,
} from '../../src/renderer/onboarding/wizard';

describe('onboarding wizard 状态机', () => {
  it('STEPS = 欢迎/模型/角色/首句（4 步指示器）', () => {
    expect(STEPS).toEqual(['welcome', 'model', 'character', 'firstchat']);
  });
  it('next 逐步前进：welcome→model→character→firstchat→finished(完成页)', () => {
    let s = initialWizard;
    expect(currentStep(s)).toBe('welcome');
    s = next(s);
    expect(currentStep(s)).toBe('model');
    s = next(s);
    expect(currentStep(s)).toBe('character');
    s = next(s);
    expect(currentStep(s)).toBe('firstchat');
    s = next(s);
    expect(s.finished).toBe(true);
    expect(next(s)).toEqual(s); // finished 后 next 幂等
  });
  it('back 逆行；从完成页 back 回 firstchat', () => {
    const finished = { stepIndex: 3, finished: true };
    expect(back(finished)).toEqual({ stepIndex: 3, finished: false });
    expect(back({ stepIndex: 1, finished: false })).toEqual({ stepIndex: 0, finished: false });
    expect(back(initialWizard)).toEqual(initialWizard); // 首步 back 幂等
  });
  it('stepNumber 为 1-based（指示器用）', () => {
    expect(stepNumber(initialWizard)).toBe(1);
    expect(stepNumber({ stepIndex: 3, finished: false })).toBe(4);
  });
  it('wizardFromStep 支持 ?step= harness（含 done）', () => {
    expect(wizardFromStep('character')).toEqual({ stepIndex: 2, finished: false });
    expect(wizardFromStep('done')).toEqual({ stepIndex: 3, finished: true });
    expect(wizardFromStep(null)).toEqual(initialWizard);
    expect(wizardFromStep('bogus')).toEqual(initialWizard);
  });
});
