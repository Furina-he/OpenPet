import { describe, it, expect } from 'vitest';
import { errorCopy } from '../../src/renderer/overlay/error-copy';

describe('errorCopy（J3 §14.3 分级）', () => {
  it('timeout/network → 连不上 + 重试/换模型', () => {
    expect(errorCopy('timeout')).toEqual({
      line: '「歪头」我没法连上大脑诶…',
      actions: ['retry', 'switchModel'],
    });
    expect(errorCopy('network')).toEqual({
      line: '「歪头」我没法连上大脑诶…',
      actions: ['retry', 'switchModel'],
    });
  });
  it('auth → 钥匙不对 + 改 Key', () => {
    expect(errorCopy('auth')).toEqual({ line: '「眨眼」哎，钥匙好像不对', actions: ['changeKey'] });
  });
  it('rate_limit → 额度用完 + 换模型', () => {
    expect(errorCopy('rate_limit')).toEqual({
      line: '「叹气」今天的额度用完啦',
      actions: ['switchModel'],
    });
  });
  it('server/unknown/缺省 → 卡了一下 + 重试', () => {
    const fallback = { line: '「困惑」大脑卡了一下，再说一次？', actions: ['retry'] };
    expect(errorCopy('server')).toEqual(fallback);
    expect(errorCopy('unknown')).toEqual(fallback);
    expect(errorCopy(undefined)).toEqual(fallback);
  });
});
