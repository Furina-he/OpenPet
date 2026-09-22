import { describe, it, expect } from 'vitest';
import {
  EmotionEnvelope,
  ENVELOPE,
  attackCurve,
  baselineForMood,
} from '../src/renderer/character/emotion-envelope';

const NAMES = ['happy', 'sad', 'relaxed', 'angry'];

describe('attackCurve', () => {
  it('0 起、120ms 处过冲 1.08、180ms 回 1、之后保持 1', () => {
    expect(attackCurve(0)).toBe(0);
    expect(attackCurve(ENVELOPE.overshootAtMs)).toBeCloseTo(1 + ENVELOPE.overshoot, 6);
    expect(attackCurve(ENVELOPE.attackMs)).toBeCloseTo(1, 6);
    expect(attackCurve(600)).toBe(1);
  });
});

describe('baselineForMood', () => {
  it('三档表：>0.4 happy/relaxed；<-0.3 sad；其余 relaxed .08', () => {
    expect(baselineForMood(0.8)).toEqual({ happy: 0.15, relaxed: 0.2 });
    expect(baselineForMood(-0.8)).toEqual({ sad: 0.12 });
    expect(baselineForMood(0)).toEqual({ relaxed: 0.08 });
  });
});

describe('EmotionEnvelope', () => {
  it('时间点采样：0 / 120 / 180 / 600 ms（起、过冲、到位、保持）', () => {
    const env = new EmotionEnvelope(NAMES);
    env.trigger({ happy: 0.5 }, 0);
    expect(env.sample(0).happy).toBeCloseTo(0, 6);
    expect(env.sample(120).happy).toBeCloseTo(0.54, 6); // 0.5 × 1.08
    expect(env.sample(180).happy).toBeCloseTo(0.5, 6);
    expect(env.sample(600).happy).toBeCloseTo(0.5, 6); // hold，不自动回落
    expect(env.currentPhase()).toBe('attack');
  });

  it('满强度目标过冲被 clamp 到 1（不外溢）', () => {
    const env = new EmotionEnvelope(NAMES);
    env.trigger({ happy: 1 }, 0);
    expect(env.sample(120).happy).toBe(1);
  });

  it('release：1200ms easeInOut 退到基线；退完进 rest 跟随基线', () => {
    const env = new EmotionEnvelope(NAMES);
    env.setBaseline({ relaxed: 0.08 }, -10_000); // 早已稳定的基线
    env.trigger({ happy: 1 }, 0);
    env.sample(180);
    env.release(180);
    const mid = env.sample(180 + 600);
    expect(mid.happy).toBeCloseTo(0.5, 6);
    expect(mid.relaxed).toBeCloseTo(0.04, 6);
    const end = env.sample(180 + 1200);
    expect(end.happy).toBeCloseTo(0, 6);
    expect(end.relaxed).toBeCloseTo(0.08, 6);
    expect(env.currentPhase()).toBe('rest');
    expect(env.sample(60_000).relaxed).toBeCloseTo(0.08, 6); // 1 分钟后仍有基线
  });

  it('连发重新起算：第二次 trigger 从当前值起、不排队', () => {
    const env = new EmotionEnvelope(NAMES);
    env.trigger({ happy: 1 }, 0);
    env.sample(180);
    env.trigger({ sad: 1 }, 200);
    const s = env.sample(200);
    expect(s.happy).toBeCloseTo(1, 6); // 起点=当前
    expect(s.sad).toBeCloseTo(0, 6);
    const e = env.sample(200 + 180);
    expect(e.happy).toBeCloseTo(0, 6);
    expect(e.sad).toBeCloseTo(1, 6);
  });

  it('全零目标（neutral）= release', () => {
    const env = new EmotionEnvelope(NAMES);
    env.trigger({ happy: 1 }, 0);
    env.sample(500);
    env.trigger({}, 500);
    expect(env.currentPhase()).toBe('release');
  });

  it('基线 2s 缓变；同目标重复 setBaseline 不重启过渡', () => {
    const env = new EmotionEnvelope(NAMES);
    env.setBaseline({ relaxed: 0.08 }, -10_000);
    env.setBaseline({ happy: 0.15, relaxed: 0.2 }, 0);
    env.setBaseline({ happy: 0.15, relaxed: 0.2 }, 1000); // 重复：不应重置 baseStart
    const mid = env.sample(1000);
    expect(mid.happy).toBeCloseTo(0.075, 6);
    expect(mid.relaxed).toBeCloseTo(0.14, 6);
    expect(env.sample(2000).happy).toBeCloseTo(0.15, 6);
  });

  it('词表外名字被丢弃（基线 sad 不在词表 → 全零）', () => {
    const env = new EmotionEnvelope(['happy']);
    env.setBaseline({ sad: 0.12 }, 0);
    expect(env.sample(5000)).toEqual({ happy: 0 });
    env.trigger({ sad: 1 }, 5000);
    expect(env.currentPhase()).toBe('rest'); // 无有效目标 → release → 本就 rest
  });
});
