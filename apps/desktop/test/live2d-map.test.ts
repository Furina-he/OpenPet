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
