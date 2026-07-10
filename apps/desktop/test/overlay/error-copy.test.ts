import { describe, it, expect } from 'vitest';
import { errorCopy } from '../../src/renderer/overlay/error-copy';

describe('errorCopy（J3 §14.3 分级）', () => {
  it('timeout/network → 连不上 + 重试/换模型', () => {
    expect(errorCopy('timeout')).toEqual({
      line: 'overlay.error.network',
      actions: ['retry', 'switchModel'],
    });
    expect(errorCopy('network')).toEqual({
      line: 'overlay.error.network',
      actions: ['retry', 'switchModel'],
    });
  });
  it('auth → 钥匙不对 + 改 Key', () => {
    expect(errorCopy('auth')).toEqual({ line: 'overlay.error.auth', actions: ['changeKey'] });
  });
  it('rate_limit → 额度用完 + 换模型', () => {
    expect(errorCopy('rate_limit')).toEqual({
      line: 'overlay.error.rateLimit',
      actions: ['switchModel'],
    });
  });
  it('server/unknown/缺省 → 卡了一下 + 重试', () => {
    const fallback = { line: 'overlay.error.fallback', actions: ['retry'] };
    expect(errorCopy('server')).toEqual(fallback);
    expect(errorCopy('unknown')).toEqual(fallback);
    expect(errorCopy(undefined)).toEqual(fallback);
  });
});
