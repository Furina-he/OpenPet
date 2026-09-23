import { describe, it, expect } from 'vitest';
import { GAZE, GazeMachine, strengthFromPref } from '../src/renderer/character/gaze';

const WIN = { x: 1000, y: 500, width: 320, height: 480 };
const CENTER = { x: WIN.x + WIN.width / 2, y: WIN.y + WIN.height / 2 };

function machine(rands: number[] = [0.5]) {
  let i = 0;
  return new GazeMachine(0, () => rands[i++ % rands.length]!);
}

describe('strengthFromPref', () => {
  it('0–100 → 0.3–1.2（50 → 0.75）', () => {
    expect(strengthFromPref(0)).toBeCloseTo(0.3, 9);
    expect(strengthFromPref(50)).toBeCloseTo(0.75, 9);
    expect(strengthFromPref(100)).toBeCloseTo(1.2, 9);
    expect(strengthFromPref(500)).toBeCloseTo(1.2, 9);
  });
});

describe('GazeMachine 状态迁移', () => {
  it('无光标 → wander；光标在窗内动 → track；静止 3s → wander', () => {
    const g = machine();
    expect(g.state(0)).toBe('wander');
    g.cursor(CENTER.x + 10, CENTER.y, 100, WIN);
    expect(g.state(100)).toBe('track');
    g.cursor(CENTER.x + 10, CENTER.y, 200, WIN); // 同坐标 = 未动（不刷新 movedAt）
    expect(g.state(100 + GAZE.trackIdleMs)).toBe('track');
    expect(g.state(100 + GAZE.trackIdleMs + 1)).toBe('wander');
  });

  it('光标离窗超过 1.5 倍窗宽 → 不 track', () => {
    const g = machine();
    g.cursor(CENTER.x + WIN.width * 1.5 + 1, CENTER.y, 100, WIN);
    expect(g.state(100)).toBe('wander');
    g.cursor(CENTER.x + WIN.width * 1.5 - 1, CENTER.y, 200, WIN);
    expect(g.state(200)).toBe('track');
  });

  it('display.lookAt=false → 光标再动也不 track，仍 wander', () => {
    const g = machine();
    g.setLookAtPrefs(false, 50);
    g.cursor(CENTER.x, CENTER.y, 100, WIN);
    expect(g.state(100)).toBe('wander');
  });

  it('优先级：sleepy > speaking > thinking > track', () => {
    const g = machine();
    g.cursor(CENTER.x, CENTER.y, 0, WIN);
    g.emotionChanged('thinking');
    expect(g.state(0)).toBe('thinking');
    g.streamActive(true);
    expect(g.state(0)).toBe('speaking');
    g.emotionChanged('sleepy');
    expect(g.state(0)).toBe('sleepy');
    g.streamActive(false);
    g.emotionChanged('neutral');
    expect(g.state(0)).toBe('track');
  });
});

describe('GazeMachine 目标', () => {
  it('thinking → 左上 (−0.25, +0.2)（strength=1）', () => {
    const g = machine([0.5]);
    g.setLookAtPrefs(true, 78); // ≈1.0
    g.emotionChanged('thinking');
    const t = g.target(0);
    expect(t.nx).toBeCloseTo(-0.25 * strengthFromPref(78), 6);
    expect(t.ny).toBeCloseTo(0.2 * strengthFromPref(78), 6);
  });

  it('sleepy → 向下 + 眼睑地板 0.4', () => {
    const g = machine();
    g.emotionChanged('sleepy');
    expect(g.target(0).ny).toBeLessThan(0);
    expect(g.eyelidFloor(0)).toBe(GAZE.sleepyEyelidFloor);
    g.emotionChanged('neutral');
    expect(g.eyelidFloor(0)).toBe(0);
  });

  it('speaking → 看用户 (0,0)；rand 命中时瞥开 0.6s 再回', () => {
    const g = machine([0.99]); // 不瞥开
    g.streamActive(true);
    expect(g.target(0)).toEqual({ nx: 0, ny: 0, saccade: false });
    const g2 = machine([0.5, 0.0, 0.9, 0.9]); // 构造吃 1 个；第 2 个命中瞥开
    g2.streamActive(true);
    const away = g2.target(0);
    expect(Math.abs(away.nx) + Math.abs(away.ny)).toBeGreaterThan(0);
    expect(g2.target(GAZE.speakingGlanceMs + 1).nx).toBe(0);
  });

  it('wander：跳变后 80ms 内 saccade=true，保持 1–4s 内目标只微抖，之后再跳', () => {
    const g = machine([0.9, 0.1, 0.5]); // hold 3.7s；目标 (+0.24, −0.24)
    g.cursor(CENTER.x, CENTER.y, 0, WIN);
    const t0 = g.target(GAZE.trackIdleMs + 1); // 刚进入 wander → 立即选目标
    expect(t0.saccade).toBe(true);
    expect(g.takeSaccades()).toBe(1);
    const held = g.target(GAZE.trackIdleMs + 1 + 500);
    expect(held.saccade).toBe(false);
    expect(Math.abs(held.nx - t0.nx)).toBeLessThan(GAZE.wanderJitter * 2 + 1e-9);
    expect(Math.abs(t0.nx)).toBeLessThanOrEqual(GAZE.wanderRange + GAZE.wanderJitter);
    expect(g.takeSaccades()).toBe(0);
  });

  it('strength 缩放全部目标（0 → ×0.3）', () => {
    const g = machine();
    g.emotionChanged('thinking');
    g.setLookAtPrefs(true, 0);
    expect(g.target(0).nx).toBeCloseTo(-0.25 * 0.3, 6);
  });

  it('nudge：down 压视线 / user 看用户 / suppressWander 期间不跳变', () => {
    const g = machine([0.5]);
    g.emotionChanged('thinking');
    g.nudge('down', 0, 400);
    expect(g.target(200).ny).toBeLessThan(0.2 * 1 - 0.1);
    g.nudge('user', 1000, 400);
    expect(g.target(1100)).toMatchObject({ nx: 0, ny: 0 });
    expect(g.target(1500).nx).toBeCloseTo(-0.25, 6); // 过期恢复
    const w = machine([0.0]);
    w.nudge('suppressWander', 0, 2000);
    w.target(0);
    expect(w.takeSaccades()).toBe(0); // 被抑制：进入 wander 不跳
    w.target(2001);
    expect(w.takeSaccades()).toBe(1);
  });
});
