import { describe, expect, it } from 'vitest';
import type { CharacterManifest } from '@openpet/protocol';
import {
  resolveEmotion,
  resolveMotion,
  dragToParams,
  clamp01,
} from '../src/renderer/character/live2d-map';

const M = {
  id: 'h',
  name: 'H',
  version: '1',
  engine: 'live2d',
  model: 'h.model3.json',
  live2dEmotions: { happy: 'exp_smile' },
  live2dMotions: { wave: { group: 'TapBody', index: 1 } },
} as unknown as CharacterManifest;

describe('live2d-map（批次⑤）', () => {
  it('resolveEmotion：查表命中；neutral → null(清表情)；未知 → undefined(no-op)', () => {
    expect(resolveEmotion(M, 'happy')).toBe('exp_smile');
    expect(resolveEmotion(M, 'neutral')).toBeNull();
    expect(resolveEmotion(M, 'sad')).toBeUndefined();
  });
  it('resolveMotion：查表命中；无表项 → 同名组兜底', () => {
    expect(resolveMotion(M, 'wave')).toEqual({ group: 'TapBody', index: 1 });
    expect(resolveMotion(M, 'nod')).toEqual({ group: 'nod' });
  });
  it('dragToParams：vx → AngleZ(度, 限幅) + BodyAngleX 微量', () => {
    const p = dragToParams(10, 0);
    expect(p.angleZ).toBeLessThanOrEqual(30);
    expect(dragToParams(-10, 0).angleZ).toBe(-p.angleZ);
    expect(dragToParams(0, 0)).toEqual({ angleZ: 0, bodyAngleX: 0 });
  });
  it('clamp01', () => {
    expect(clamp01(1.5)).toBe(1);
    expect(clamp01(-0.1)).toBe(0);
  });
});

describe('⑱ Live2D 生命层参数映射', () => {
  it('lifeToParams：rad→deg + 视线带头部朝向；AngleY 取反；全部夹紧', async () => {
    const { lifeToParams } = await import('../src/renderer/character/live2d-map');
    const p = lifeToParams(
      { headYaw: 0.1, headPitch: 0.1, headRoll: -0.05, spineYaw: 0.02, spineRoll: 0.01, chestPitch: 0.03 },
      { nx: 0.5, ny: -0.25 },
    );
    expect(p.ParamAngleX).toBeCloseTo(0.1 * (180 / Math.PI) + 6, 6);
    expect(p.ParamAngleY).toBeCloseTo(-0.1 * (180 / Math.PI) - 2, 6);
    expect(p.ParamAngleZ).toBeCloseTo(-0.05 * (180 / Math.PI), 6);
    expect(p.ParamBodyAngleX).toBeCloseTo(0.03 * (180 / Math.PI), 6);
    expect(p.ParamEyeBallX).toBe(0.5);
    expect(p.ParamEyeBallY).toBe(-0.25);
    expect(p.ParamBreath).toBeGreaterThan(0);
    const big = lifeToParams(
      { headYaw: 5, headPitch: -5, headRoll: 5, spineYaw: 5, spineRoll: 0, chestPitch: 1 },
      { nx: 3, ny: -3 },
    );
    expect(big.ParamAngleX).toBe(30);
    expect(big.ParamAngleY).toBe(30);
    expect(big.ParamBodyAngleX).toBe(10);
    expect(big.ParamEyeBallX).toBe(1);
    expect(big.ParamBreath).toBe(0.5);
  });

  it('pickIdleGroup：按 energy 选 IdleLow/IdleHigh，缺则回 Idle，再缺取首组', async () => {
    const { pickIdleGroup } = await import('../src/renderer/character/live2d-map');
    expect(pickIdleGroup(['Idle', 'IdleLow', 'IdleHigh'], 'low')).toBe('IdleLow');
    expect(pickIdleGroup(['Idle', 'IdleLow', 'IdleHigh'], 'high')).toBe('IdleHigh');
    expect(pickIdleGroup(['Idle', 'IdleLow', 'IdleHigh'], 'mid')).toBe('Idle');
    expect(pickIdleGroup(['Idle'], 'high')).toBe('Idle');
    expect(pickIdleGroup(['Tap'], 'high')).toBe('Tap');
  });

  it('beatMotionName：question→tilt，exclaim/period→nod', async () => {
    const { beatMotionName } = await import('../src/renderer/character/live2d-map');
    expect(beatMotionName('question')).toBe('tilt');
    expect(beatMotionName('exclaim')).toBe('nod');
    expect(beatMotionName('period')).toBe('nod');
  });
});
