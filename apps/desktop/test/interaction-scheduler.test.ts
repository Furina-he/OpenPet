import { describe, it, expect } from 'vitest';
import { PrefsSchema, type CueEvent, type Prefs } from '@openpet/protocol';
import { createInteractionScheduler } from '../electron/main/interaction-scheduler.js';

function harness(startNow: number) {
  let now = startNow;
  const prefs: Prefs = PrefsSchema.parse({});
  const fired: CueEvent[] = [];
  const scheduler = createInteractionScheduler({
    trigger: (e) => fired.push(e),
    getPrefs: () => prefs,
    setPref: (k, v) => {
      (prefs as Record<string, unknown>)[k] = v;
    },
    now: () => now,
  });
  return {
    scheduler,
    fired,
    prefs,
    setNow: (t: number) => {
      now = t;
    },
  };
}

const at = (h: number, m: number, day = 1): number => new Date(2026, 6, day, h, m).getTime();

describe('createInteractionScheduler', () => {
  it('整点（分钟==0）tick → clock.hourly；非整点不发', () => {
    const h = harness(at(14, 0));
    h.scheduler.tick();
    expect(h.fired).toContain('clock.hourly');
    const h2 = harness(at(14, 30));
    h2.scheduler.tick();
    expect(h2.fired).not.toContain('clock.hourly');
  });

  it('5:00–11:00 首次 tick → greet.morning + 写 lastGreet；当日重复 tick 只一次', () => {
    const h = harness(at(8, 30));
    h.scheduler.tick();
    expect(h.fired.filter((e) => e === 'greet.morning')).toHaveLength(1);
    expect(h.prefs['pet.lastGreet']).toBe('2026-07-01/morning');
    h.setNow(at(9, 30));
    h.scheduler.tick();
    expect(h.fired.filter((e) => e === 'greet.morning')).toHaveLength(1); // 仍一次
  });

  it('18:00–23:00 → greet.evening（同日 morning 后 evening 也发）；时段外不发', () => {
    const h = harness(at(8, 30));
    h.scheduler.tick(); // morning
    h.setNow(at(19, 15));
    h.scheduler.tick();
    expect(h.fired.filter((e) => e === 'greet.evening')).toHaveLength(1);
    expect(h.prefs['pet.lastGreet']).toBe('2026-07-01/evening');
    // 23:30 已出 evening 时段
    const h2 = harness(at(23, 30));
    h2.scheduler.tick();
    expect(h2.fired.filter((e) => e.startsWith('greet.'))).toHaveLength(0);
  });

  it('跨日重置：次日早晨再 greet.morning', () => {
    const h = harness(at(8, 0));
    h.scheduler.tick();
    h.setNow(at(8, 0, 2)); // 次日
    h.scheduler.tick();
    expect(h.fired.filter((e) => e === 'greet.morning')).toHaveLength(2);
    expect(h.prefs['pet.lastGreet']).toBe('2026-07-02/morning');
  });
});
