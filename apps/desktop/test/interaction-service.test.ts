import { describe, it, expect, vi, afterEach } from 'vitest';
import { DEFAULT_CUES, PrefsSchema, type Prefs } from '@openpet/protocol';
import { InteractionService } from '../electron/main/interaction-service.js';
import { MoodState } from '../electron/main/mood-state.js';

/** 小 harness：fake prefs/now/rand + broadcast 收集。 */
function harness(opts: { prefs?: Partial<Prefs>; now?: number; rand?: number; mood?: number } = {}) {
  const prefs: Prefs = { ...PrefsSchema.parse({}), ...(opts.prefs ?? {}) };
  let now = opts.now ?? new Date(2026, 6, 1, 12, 0).getTime(); // 默认白天，避开 DND
  let rand = opts.rand ?? 0;
  const sent: Array<{ channel: string; params: unknown }> = [];
  let moodPref = { value: opts.mood ?? 0, updatedAt: now };
  const mood = new MoodState({
    getPref: () => moodPref,
    setPref: (v) => {
      moodPref = v;
    },
    now: () => now,
  });
  const svc = new InteractionService({
    cues: () => DEFAULT_CUES,
    broadcast: (channel, params) => sent.push({ channel, params }),
    getPrefs: () => prefs,
    mood,
    now: () => now,
    rand: () => rand,
  });
  return {
    svc,
    sent,
    mood,
    advance: (ms: number) => {
      now += ms;
    },
    setNow: (t: number) => {
      now = t;
    },
    setRand: (r: number) => {
      rand = r;
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('InteractionService.trigger', () => {
  it('tap.head → happy applyEmotion + nuzzle playAction 两广播', () => {
    const h = harness();
    h.svc.trigger('tap.head');
    expect(h.sent).toEqual([
      { channel: 'behavior.applyEmotion', params: { name: 'happy', weight: 1 } },
      { channel: 'behavior.playAction', params: { name: 'nuzzle', durationMs: null } },
    ]);
  });

  it('cooldown：800ms 内二次 tap.head 只第一次发；过冷却再发', () => {
    const h = harness();
    h.svc.trigger('tap.head');
    h.advance(500);
    h.svc.trigger('tap.head');
    expect(h.sent).toHaveLength(2);
    h.advance(900);
    h.svc.trigger('tap.head');
    expect(h.sent).toHaveLength(4);
  });

  it('DND 时段（23:30，dnd 23:00-08:00）：proactive 事件吞、非 proactive 照发', () => {
    const h = harness({ now: new Date(2026, 6, 1, 23, 30).getTime(), prefs: { 'general.proactiveFreq': 100 } });
    h.svc.trigger('greet.evening'); // proactive → 吞
    expect(h.sent).toHaveLength(0);
    h.svc.trigger('tap.head'); // 非 proactive → 照发
    expect(h.sent).toHaveLength(2);
  });

  it('proactiveFreq=0 → idle.timeout 吞', () => {
    const h = harness({ prefs: { 'general.proactiveFreq': 0 } });
    h.svc.trigger('idle.timeout');
    expect(h.sent).toHaveLength(0);
  });

  it('proactiveSpeech=false 吞 say；true 发 pet.say（池随机一条）', () => {
    const off = harness({ prefs: { 'general.proactiveFreq': 100 } });
    off.svc.trigger('greet.morning');
    expect(off.sent.filter((s) => s.channel === 'pet.say')).toHaveLength(0);
    // emotion/action 照发
    expect(off.sent.map((s) => s.channel)).toEqual([
      'behavior.applyEmotion',
      'behavior.playAction',
    ]);

    const on = harness({
      prefs: { 'general.proactiveFreq': 100, 'general.proactiveSpeech': true },
    });
    on.svc.trigger('greet.morning');
    const says = on.sent.filter((s) => s.channel === 'pet.say');
    expect(says).toHaveLength(1);
    expect((says[0]!.params as { text: string }).text).toBe('早安！今天也要加油哦'); // rand=0 → 池首条
  });

  it('idle mood 偏置：mood=-0.5 → action ∈ sigh/droop/tilt', () => {
    const h = harness({ mood: -0.5, prefs: { 'general.proactiveFreq': 100 } });
    h.svc.trigger('idle.timeout');
    const actions = h.sent.filter((s) => s.channel === 'behavior.playAction');
    expect(actions).toHaveLength(1);
    expect(['sigh', 'droop', 'tilt']).toContain((actions[0]!.params as { name: string }).name);
  });

  it('idle mood 偏置：mood=0.6 → action ∈ jump/wave/stretch', () => {
    const h = harness({ mood: 0.6, prefs: { 'general.proactiveFreq': 100 } });
    h.svc.trigger('idle.timeout');
    const actions = h.sent.filter((s) => s.channel === 'behavior.playAction');
    expect(['jump', 'wave', 'stretch']).toContain((actions[0]!.params as { name: string }).name);
  });

  it('查表无该 on（chat.done 无 cue）→ 不广播，但 mood 仍 bump +0.03', () => {
    const h = harness();
    h.svc.trigger('chat.done');
    expect(h.sent).toHaveLength(0);
    expect(h.mood.current()).toBeCloseTo(0.03, 5);
  });

  it('mood 联动：tap.head bump +0.08、chat.error bump -0.05', () => {
    const h = harness();
    h.svc.trigger('tap.head');
    expect(h.mood.current()).toBeCloseTo(0.08, 5);
    h.svc.trigger('chat.error');
    expect(h.mood.current()).toBeCloseTo(0.03, 5);
  });
});

describe('InteractionService.onTap（combo 计数）', () => {
  it('2.5s 窗口内 3 次 onTap(head)：前两次 tap.head、第三次 combo.head 并清零', () => {
    const h = harness();
    h.svc.onTap('head');
    h.advance(900); // 过 tap.head 冷却
    h.svc.onTap('head');
    h.advance(900);
    h.svc.onTap('head');
    const emotions = h.sent
      .filter((s) => s.channel === 'behavior.applyEmotion')
      .map((s) => (s.params as { name: string }).name);
    expect(emotions).toEqual(['happy', 'happy', 'shy']); // 第三次 = combo.head → shy
    // 清零：第 4 次 tap 回到 tap.head
    h.advance(900);
    h.svc.onTap('head');
    expect(
      (h.sent.filter((s) => s.channel === 'behavior.applyEmotion').at(-1)!.params as { name: string })
        .name,
    ).toBe('happy');
  });

  it('超出 2.5s 窗口不算连击', () => {
    const h = harness();
    h.svc.onTap('head');
    h.advance(3000);
    h.svc.onTap('head');
    h.advance(3000);
    h.svc.onTap('head');
    const emotions = h.sent
      .filter((s) => s.channel === 'behavior.applyEmotion')
      .map((s) => (s.params as { name: string }).name);
    expect(emotions).toEqual(['happy', 'happy', 'happy']);
  });
});

describe('InteractionService toolLong（⑨）', () => {
  it('markToolStart 起 20s 定时 → 到点 trigger(chat.toolLong)＝sleepy；markToolEnd 取消', () => {
    vi.useFakeTimers();
    const h = harness();
    h.svc.markToolStart('s1');
    vi.advanceTimersByTime(20_000);
    expect(
      h.sent.some(
        (s) =>
          s.channel === 'behavior.applyEmotion' && (s.params as { name: string }).name === 'sleepy',
      ),
    ).toBe(true);

    const h2 = harness();
    h2.svc.markToolStart('s2');
    vi.advanceTimersByTime(10_000);
    h2.svc.markToolEnd('s2');
    vi.advanceTimersByTime(30_000);
    expect(h2.sent).toHaveLength(0);
  });
});
