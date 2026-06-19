import { describe, it, expect } from 'vitest';
import { decideStartup } from '../electron/main/startup';
import { DEFAULT_PREFS } from '@desksoul/protocol';

describe('decideStartup（首启显引导 vs 常规）', () => {
  it('onboarding.completed=false → 显引导', () => {
    expect(decideStartup({ ...DEFAULT_PREFS, 'onboarding.completed': false })).toEqual({
      showOnboarding: true,
    });
  });
  it('onboarding.completed=true → 常规（不显引导）', () => {
    expect(decideStartup({ ...DEFAULT_PREFS, 'onboarding.completed': true })).toEqual({
      showOnboarding: false,
    });
  });
});
