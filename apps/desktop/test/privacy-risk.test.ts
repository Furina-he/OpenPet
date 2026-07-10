import { describe, it, expect } from 'vitest';
import { isHighRisk, needsConfirm } from '../src/renderer/settings/privacy-risk';

describe('privacy high-risk gating', () => {
  it('flags screenshot/camera as high-risk', () => {
    expect(isHighRisk('privacy.screenshot')).toBe(true);
    expect(isHighRisk('privacy.camera')).toBe(true);
    expect(isHighRisk('privacy.microphone')).toBe(false);
  });
  it('needsConfirm only on off→on of a high-risk key', () => {
    expect(needsConfirm('privacy.camera', false, true)).toBe(true);
    expect(needsConfirm('privacy.camera', true, false)).toBe(false); // 关闭不需确认
    expect(needsConfirm('privacy.microphone', false, true)).toBe(false);
  });
});
