import { describe, it, expect } from 'vitest';
import { resolveSendTarget } from '../electron/main/chat-resolve';

describe('resolveSendTarget', () => {
  it('显式 providerId 优先，忽略 resolved', () => {
    expect(resolveSendTarget('openai', ['claude'], { providerId: 'gemini', model: 'g' })).toEqual({
      chain: ['openai'],
    });
  });
  it('无显式时用 resolved.providerId 作 chain 首项 + 透传 model', () => {
    expect(
      resolveSendTarget(undefined, ['claude'], { providerId: 'gemini', model: 'g-1.5' }),
    ).toEqual({
      chain: ['gemini'],
      model: 'g-1.5',
    });
  });
  it('resolved 无 providerId → 回退静态 chain；无 model 则不带键', () => {
    expect(resolveSendTarget(undefined, ['claude'], { model: 'x' })).toEqual({
      chain: ['claude'],
      model: 'x',
    });
    expect(resolveSendTarget(undefined, [], undefined)).toEqual({ chain: [] });
  });
});
