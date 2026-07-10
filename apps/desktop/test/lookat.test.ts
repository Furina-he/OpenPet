import { describe, it, expect } from 'vitest';
import { normalizedFromScreen, lookAtWorldTarget, damp } from '../src/renderer/character/lookat';

const WIN = { x: 1000, y: 500, width: 320, height: 480 };

describe('normalizedFromScreen', () => {
  it('window center maps to (0, 0)', () => {
    const n = normalizedFromScreen(1160, 740, WIN);
    expect(n.nx).toBeCloseTo(0);
    expect(n.ny).toBeCloseTo(0);
  });

  it('right edge → nx=1, top edge → ny=1 (向上为正)', () => {
    expect(normalizedFromScreen(1320, 740, WIN).nx).toBeCloseTo(1);
    expect(normalizedFromScreen(1160, 500, WIN).ny).toBeCloseTo(1);
    expect(normalizedFromScreen(1160, 980, WIN).ny).toBeCloseTo(-1);
  });

  it('clamps far-away cursor to ±2 (窗外仍可远望不发散)', () => {
    const n = normalizedFromScreen(9000, -9000, WIN);
    expect(n.nx).toBe(2);
    expect(n.ny).toBe(2);
  });
});

describe('lookAtWorldTarget', () => {
  const head = { x: 0, y: 1.35, z: 0 };

  it('centered gaze looks straight ahead of the head', () => {
    const t = lookAtWorldTarget(head, { nx: 0, ny: 0 });
    expect(t.x).toBeCloseTo(0);
    expect(t.y).toBeCloseTo(1.35);
    expect(t.z).toBeGreaterThan(0.5); // 目标在头前方（相机方向 +z，S3 相机位 z=2.2）
  });

  it('nx>0 (屏幕右) 把目标推向头部 -x（镜像：用户右 = 角色左）', () => {
    const t = lookAtWorldTarget(head, { nx: 1, ny: 0 });
    expect(t.x).toBeLessThan(0);
  });

  it('ny>0 (屏幕上) 抬高目标', () => {
    const t = lookAtWorldTarget(head, { nx: 0, ny: 1 });
    expect(t.y).toBeGreaterThan(1.35);
  });
});

describe('damp', () => {
  it('moves toward target, framerate-independently', () => {
    // 同样 100ms：一步到位 vs 10 步×10ms，结果应几乎一致（指数阻尼性质）
    const oneStep = damp(0, 1, 8, 0.1);
    let v = 0;
    for (let i = 0; i < 10; i++) v = damp(v, 1, 8, 0.01);
    expect(Math.abs(oneStep - v)).toBeLessThan(1e-6);
    expect(oneStep).toBeGreaterThan(0.5); // λ=8 时 100ms 应走过一半以上
    expect(oneStep).toBeLessThan(1);
  });

  it('already at target stays put', () => {
    expect(damp(0.7, 0.7, 8, 0.016)).toBeCloseTo(0.7);
  });
});
