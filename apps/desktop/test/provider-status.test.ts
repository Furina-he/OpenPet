import { describe, it, expect } from 'vitest';
import { providerDot } from '../src/renderer/settings/provider-status';

describe('providerDot（§7.3 绿=可用/灰=待填Key/红=测失败）', () => {
  it('测失败优先 → fail', () => {
    expect(providerDot({ hasKey: true, lastTestOk: false })).toBe('fail');
  });
  it('有 Key（或免 Key）且未测失败 → ok', () => {
    expect(providerDot({ hasKey: true })).toBe('ok');
    expect(providerDot({ hasKey: true, lastTestOk: true })).toBe('ok');
  });
  it('无 Key → pending', () => {
    expect(providerDot({ hasKey: false })).toBe('pending');
  });
});
