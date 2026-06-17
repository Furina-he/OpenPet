import { describe, it, expect } from 'vitest';
import { createPrefEffects, applyAllEffects } from '../../electron/main/prefs/effects';
import { DEFAULT_PREFS } from '@desksoul/protocol';

describe('pref effects registry', () => {
  it('M7a registry has no Main-side effects (theme reaches renderers via broadcast)', () => {
    const effects = createPrefEffects();
    expect(effects['display.theme']).toBeUndefined();
  });

  it('applyAllEffects is a no-op-safe sweep over current prefs', () => {
    const calls: string[] = [];
    // 注入一个临时 effect 验证 sweep 会按 key 调用
    const effects = {
      'display.alwaysOnTop': () => calls.push('aot'),
    } as ReturnType<typeof createPrefEffects>;
    applyAllEffects(effects, DEFAULT_PREFS);
    expect(calls).toEqual(['aot']); // 仅注册了的 key 被调用，其余无副作用
  });
});
