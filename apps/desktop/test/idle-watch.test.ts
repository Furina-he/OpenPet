import { describe, it, expect } from 'vitest';
import { IdleWatch, IDLE_TIMEOUT_MS } from '../src/renderer/character/idle-watch';

describe('IdleWatch', () => {
  it('default timeout is 90s (tech-design §7)', () => {
    expect(IDLE_TIMEOUT_MS).toBe(90_000);
  });

  it('fires once after timeoutMs of no activity', () => {
    const fired: number[] = [];
    const w = new IdleWatch(90_000, (idleMs) => fired.push(idleMs));
    w.activity(0);
    w.tick(89_999);
    expect(fired).toEqual([]);
    w.tick(90_000);
    expect(fired).toEqual([90_000]);
  });

  it('does not re-fire while still idle (单发，不连发)', () => {
    const fired: number[] = [];
    const w = new IdleWatch(90_000, (ms) => fired.push(ms));
    w.activity(0);
    w.tick(90_000);
    w.tick(180_000);
    w.tick(400_000);
    expect(fired).toEqual([90_000]);
  });

  it('re-arms after new activity', () => {
    const fired: number[] = [];
    const w = new IdleWatch(90_000, (ms) => fired.push(ms));
    w.activity(0);
    w.tick(90_000); // fire #1
    w.activity(100_000);
    w.tick(189_999);
    expect(fired).toHaveLength(1);
    w.tick(190_000); // fire #2
    expect(fired).toEqual([90_000, 90_000]);
  });

  it('activity before timeout postpones firing', () => {
    const fired: number[] = [];
    const w = new IdleWatch(90_000, (ms) => fired.push(ms));
    w.activity(0);
    w.tick(60_000);
    w.activity(60_000);
    w.tick(120_000);
    expect(fired).toEqual([]);
    w.tick(150_000);
    expect(fired).toEqual([90_000]);
  });

  it('does not fire before any activity is recorded (启动即静置不算)', () => {
    const fired: number[] = [];
    const w = new IdleWatch(90_000, (ms) => fired.push(ms));
    w.tick(500_000);
    expect(fired).toEqual([]);
  });
});
