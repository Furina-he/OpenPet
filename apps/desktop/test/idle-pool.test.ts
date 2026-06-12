import { describe, it, expect } from 'vitest';
import {
  IDLE_POOL,
  selectIdleVariants,
  planNextIdle,
  IDLE_GAP_MIN_MS,
  IDLE_GAP_MAX_MS,
} from '../src/renderer/character/idle-pool';

describe('IDLE_POOL', () => {
  it('every variant is low-amplitude and references a real action', () => {
    const actions = ['wave', 'nod', 'shake', 'fidget', 'stretch', 'sigh', 'jump', 'tilt'];
    for (const v of IDLE_POOL) {
      expect(actions).toContain(v.action);
      expect(v.scale).toBeGreaterThan(0);
      expect(v.scale).toBeLessThanOrEqual(0.7); // idle 变体必须低幅，不与显式动作混淆
      expect(v.durationMs).toBeGreaterThan(0);
    }
  });

  it('has unconstrained variants (任何 intent 下池子非空的保底)', () => {
    expect(IDLE_POOL.some((v) => !v.moods && !v.energies)).toBe(true);
  });
});

describe('selectIdleVariants', () => {
  it('neutral intent gets only unconstrained variants', () => {
    const subset = selectIdleVariants({ mood: 'neutral', energy: 'mid' });
    expect(subset.length).toBeGreaterThan(0);
    for (const v of subset) {
      if (v.moods) expect(v.moods).toContain('neutral');
      if (v.energies) expect(v.energies).toContain('mid');
    }
  });

  it('mood=shy adds the shy-fidget variant', () => {
    const ids = selectIdleVariants({ mood: 'shy', energy: 'low' }).map((v) => v.id);
    expect(ids).toContain('shy-fidget');
  });

  it('energy=high adds bounce, energy=low adds droop', () => {
    expect(selectIdleVariants({ mood: 'neutral', energy: 'high' }).map((v) => v.id)).toContain(
      'bounce',
    );
    expect(selectIdleVariants({ mood: 'neutral', energy: 'low' }).map((v) => v.id)).toContain(
      'droop',
    );
  });

  it('falls back to unconstrained set for unknown intent vocabulary', () => {
    const subset = selectIdleVariants({ mood: 'bogus', energy: 'bogus' });
    expect(subset.length).toBeGreaterThan(0);
    expect(subset.every((v) => !v.moods && !v.energies)).toBe(true);
  });
});

describe('planNextIdle', () => {
  it('schedules within [4s, 10s] and picks from the subset', () => {
    const subset = selectIdleVariants({ mood: 'neutral', energy: 'mid' });
    const lo = planNextIdle(1000, subset, () => 0);
    const hi = planNextIdle(1000, subset, () => 0.999999);
    expect(lo.at).toBe(1000 + IDLE_GAP_MIN_MS);
    expect(hi.at).toBeLessThanOrEqual(1000 + IDLE_GAP_MAX_MS);
    expect(subset.map((v) => v.id)).toContain(lo.variant.id);
    expect(subset.map((v) => v.id)).toContain(hi.variant.id);
  });
});
