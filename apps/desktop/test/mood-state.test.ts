import { describe, it, expect } from 'vitest';
import { MoodState, MOOD_HALF_LIFE_MS, MOOD_DELTAS } from '../electron/main/mood-state.js';

function harness(initial = { value: 0, updatedAt: 0 }, startNow = 0) {
  let pref = { ...initial };
  let now = startNow;
  const mood = new MoodState({
    getPref: () => pref,
    setPref: (v) => {
      pref = v;
    },
    now: () => now,
  });
  return {
    mood,
    setNow: (t: number) => {
      now = t;
    },
    pref: () => pref,
  };
}

describe('MoodState', () => {
  it('半衰：2h 后 0.8 → 0.4±ε', () => {
    const h = harness({ value: 0.8, updatedAt: 0 });
    h.setNow(MOOD_HALF_LIFE_MS);
    expect(h.mood.current()).toBeCloseTo(0.4, 5);
  });

  it('bump 后写回 {value, updatedAt: now}，且 clamp 到 [-1,1]', () => {
    const h = harness({ value: 0.95, updatedAt: 0 });
    h.setNow(1000);
    h.mood.bump(0.5);
    expect(h.pref().value).toBe(1);
    expect(h.pref().updatedAt).toBe(1000);
    h.mood.bump(-3);
    expect(h.pref().value).toBe(-1);
  });

  it('MOOD_DELTAS 契约（tapHead/combo/stroke/chatDone/chatError）', () => {
    expect(MOOD_DELTAS.tapHead).toBeGreaterThan(0);
    expect(MOOD_DELTAS.combo).toBeGreaterThan(MOOD_DELTAS.tapHead);
    expect(MOOD_DELTAS.chatError).toBeLessThan(0);
  });
});
