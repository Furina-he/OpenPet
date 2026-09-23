import { describe, it, expect } from 'vitest';
import {
  POSTURE_TABLE,
  POSTURE_MS,
  PostureLayer,
  postureFor,
} from '../src/renderer/character/posture';
import { ZERO_OFFSETS } from '../src/renderer/character/actions';

describe('POSTURE_TABLE / postureFor', () => {
  it('表内每情绪有目标；未知情绪零；spec 语义对得上', () => {
    expect(POSTURE_TABLE.shy!.headPitch).toBeCloseTo(0.08, 9);
    expect(POSTURE_TABLE.angry!.spinePitch).toBeLessThan(0);
    expect(postureFor('sad', 0).headPitch).toBeCloseTo(0.1, 9);
    expect(postureFor('sleepy', 0)).toEqual(postureFor('confused', 0));
    expect(postureFor('happy', 0).hipsY).toBeCloseTo(0.005, 9);
    expect(postureFor('surprised', 0).headPitch).toBeLessThan(0);
    expect(postureFor('neutral', 0)).toEqual(ZERO_OFFSETS);
    expect(postureFor('relaxed', 0)).toEqual(ZERO_OFFSETS);
  });

  it('心情低落且无情绪姿态 → 常驻微垂头/脊柱塌；有情绪姿态时不叠', () => {
    const low = postureFor('neutral', -0.8);
    expect(low.headPitch).toBeGreaterThan(0);
    expect(low.spinePitch).toBeGreaterThan(0);
    expect(postureFor('angry', -0.8)).toEqual(postureFor('angry', 0));
  });
});

describe('PostureLayer', () => {
  it('600ms easeInOut 到目标；中点为一半', () => {
    const p = new PostureLayer();
    p.set('sad', 0, 0);
    expect(p.sample(0).headPitch).toBeCloseTo(0, 9);
    expect(p.sample(POSTURE_MS / 2).headPitch).toBeCloseTo(0.05, 9);
    expect(p.sample(POSTURE_MS).headPitch).toBeCloseTo(0.1, 9);
    expect(p.sample(10_000).headPitch).toBeCloseTo(0.1, 9);
  });

  it('切换情绪从当前值起缓动；同目标重复 set 不重启', () => {
    const p = new PostureLayer();
    p.set('sad', 0, 0);
    p.sample(POSTURE_MS);
    p.set('sad', 0, POSTURE_MS + 100); // 重复
    expect(p.sample(POSTURE_MS + 100).headPitch).toBeCloseTo(0.1, 9);
    p.set('surprised', 0, 2000);
    const mid = p.sample(2000 + POSTURE_MS / 2).headPitch;
    expect(mid).toBeCloseTo((0.1 + -0.06) / 2, 9);
  });

  it('override 临时换姿态，再 set 恢复', () => {
    const p = new PostureLayer();
    p.set('neutral', 0, 0);
    p.override('sad', 0);
    expect(p.sample(POSTURE_MS).headPitch).toBeCloseTo(0.1, 9);
    p.set('neutral', 0, POSTURE_MS);
    expect(p.currentEmotion()).toBe('neutral');
    expect(p.sample(POSTURE_MS * 2).headPitch).toBeCloseTo(0, 9);
  });
});
