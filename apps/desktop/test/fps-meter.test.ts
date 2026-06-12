import { describe, it, expect } from 'vitest';
import { FpsMeter, FPS_WINDOW_MS } from '../src/renderer/character/fps-meter';

/** 以恒定 fps 喂 meter 共 durationMs（时间戳从 t0 开始）。 */
function feed(meter: FpsMeter, fps: number, durationMs: number, t0 = 0): number {
  const step = 1000 / fps;
  let t = t0;
  for (; t < t0 + durationMs; t += step) meter.tick(t);
  return t;
}

describe('FpsMeter', () => {
  it('window constant is 30s', () => {
    expect(FPS_WINDOW_MS).toBe(30_000);
  });

  it('averages a steady 60fps stream to ~60', () => {
    const m = new FpsMeter();
    feed(m, 60, 10_000);
    expect(m.average()).toBeGreaterThan(55);
    expect(m.average()).toBeLessThan(65);
  });

  it('rolls off samples older than the window', () => {
    const m = new FpsMeter();
    const t1 = feed(m, 60, 10_000); // 0–10s @60
    feed(m, 20, 40_000, t1); // 10–50s @20：30s 窗口已完全滚出 60fps 段
    expect(m.average()).toBeGreaterThan(15);
    expect(m.average()).toBeLessThan(25);
  });

  it('returns 0 before any full second elapses', () => {
    const m = new FpsMeter();
    m.tick(0);
    m.tick(16);
    expect(m.average()).toBe(0);
  });
});
