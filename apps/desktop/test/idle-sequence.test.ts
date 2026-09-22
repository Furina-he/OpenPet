import { describe, it, expect } from 'vitest';
import {
  IDLE_POOL,
  IDLE_GAPS,
  IdleSequencer,
  pickWeighted,
  planNextIdle,
  selectIdleVariants,
  stepsOf,
} from '../src/renderer/character/idle-pool';
import { ACTION_NAMES } from '../src/renderer/character/actions';

const neutral = { mood: 'neutral', energy: 'mid' };

describe('⑱ IDLE_POOL 序列与权重', () => {
  it('序列步全��引用真实动作（或 hum 伪动作），幅度 ≤0.7', () => {
    for (const v of IDLE_POOL) {
      for (const s of stepsOf(v)) {
        expect([...ACTION_NAMES, 'hum']).toContain(s.action);
        expect(Math.abs(s.scale)).toBeLessThanOrEqual(0.7 + (s.action === 'hum' ? 1 : 0));
        expect(s.durationMs).toBeGreaterThan(0);
      }
    }
  });

  it('look-around 两步 tilt 反向；perk 仅 high；stretch-yawn 仅 low', () => {
    const la = IDLE_POOL.find((v) => v.id === 'look-around')!;
    expect(la.steps!.map((s) => Math.sign(s.scale))).toEqual([1, -1]);
    expect(selectIdleVariants({ mood: 'neutral', energy: 'high' }).map((v) => v.id)).toContain('perk');
    expect(selectIdleVariants(neutral).map((v) => v.id)).not.toContain('perk');
    expect(selectIdleVariants({ mood: 'neutral', energy: 'low' }).map((v) => v.id)).toContain(
      'stretch-yawn',
    );
  });

  it('glance-tilt-sigh 只在心情 < −0.3 时入选', () => {
    expect(selectIdleVariants(neutral).map((v) => v.id)).not.toContain('glance-tilt-sigh');
    expect(selectIdleVariants(neutral, { moodValue: -0.5 }).map((v) => v.id)).toContain(
      'glance-tilt-sigh',
    );
    expect(selectIdleVariants(neutral, { moodValue: 0.2 }).map((v) => v.id)).not.toContain(
      'glance-tilt-sigh',
    );
  });

  it('hum 仅 autoSpeak 关时入选', () => {
    expect(selectIdleVariants(neutral, { autoSpeak: false }).map((v) => v.id)).toContain('hum');
    expect(selectIdleVariants(neutral, { autoSpeak: true }).map((v) => v.id)).not.toContain('hum');
  });

  it('生活事件权重 0.3；加权抽样按累计区间落点', () => {
    const items = [{ id: 'a', weight: 1 }, { id: 'b', weight: 0.3 }, { id: 'c' }];
    expect(pickWeighted(items, 0).id).toBe('a');
    expect(pickWeighted(items, 0.99 / 2.3).id).toBe('a');
    expect(pickWeighted(items, 1.1 / 2.3).id).toBe('b');
    expect(pickWeighted(items, 1.5 / 2.3).id).toBe('c');
    expect(pickWeighted(items, 0.999999).id).toBe('c');
    // 分布：固定步进 rand，低权重项被抽中的比例 ≈ 0.3/2.3
    let b = 0;
    const N = 2300;
    for (let i = 0; i < N; i++) if (pickWeighted(items, (i + 0.5) / N).id === 'b') b += 1;
    expect(b / N).toBeCloseTo(0.3 / 2.3, 2);
  });

  it('间隔随 energy：low 8–16s / mid 5–11s / high 3–8s', () => {
    const subset = selectIdleVariants(neutral);
    expect(planNextIdle(0, subset, () => 0, 'low').at).toBe(IDLE_GAPS.low.min);
    expect(planNextIdle(0, subset, () => 0.999999, 'low').at).toBeLessThanOrEqual(IDLE_GAPS.low.max);
    expect(planNextIdle(0, subset, () => 0, 'high').at).toBe(IDLE_GAPS.high.min);
    expect(planNextIdle(0, subset, () => 0).at).toBe(IDLE_GAPS.mid.min);
  });
});

describe('IdleSequencer', () => {
  const steps = [
    { action: 'tilt', scale: 0.5, durationMs: 1000, gapMs: 200 },
    { action: 'tilt', scale: -0.5, durationMs: 1000, gapMs: 0 },
  ] as const;

  it('按步推进：第 2 步在 dur+gap 后才给；期间 active 为真（idle 不抢占）', () => {
    const q = new IdleSequencer();
    q.start(steps, 0);
    expect(q.next(0, false)?.scale).toBe(0.5);
    expect(q.active).toBe(true);
    expect(q.next(1100, false)).toBeNull(); // gap 内
    expect(q.next(1200, false)?.scale).toBe(-0.5);
    expect(q.active).toBe(false);
    expect(q.next(5000, false)).toBeNull();
  });

  it('播放器忙时不推进；abort 中止', () => {
    const q = new IdleSequencer();
    q.start(steps, 0);
    expect(q.next(0, true)).toBeNull();
    expect(q.next(0, false)?.scale).toBe(0.5);
    q.abort();
    expect(q.active).toBe(false);
    expect(q.next(2000, false)).toBeNull();
  });
});
