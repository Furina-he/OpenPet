import { describe, it, expect } from 'vitest';
import {
  BehaviorParser,
  BEHAVIOR_LIMITS,
  type BehaviorWarnReason,
} from '../src/behavior-parser';

function collectWarns(): {
  warns: Array<{ reason: BehaviorWarnReason; raw: string }>;
  onWarn: (reason: BehaviorWarnReason, raw: string) => void;
} {
  const warns: Array<{ reason: BehaviorWarnReason; raw: string }> = [];
  return { warns, onWarn: (reason, raw) => warns.push({ reason, raw }) };
}

describe('BehaviorParser', () => {
  it('emits text delta only when no tag', () => {
    const p = new BehaviorParser();
    const events = [...p.feed('hello world')];
    expect(events).toEqual([{ type: 'text', text: 'hello world' }]);
  });

  it('strips and emits emotion tag', () => {
    const p = new BehaviorParser();
    const events = [...p.feed('hi <emo:shy/> there')];
    expect(events).toEqual([
      { type: 'text', text: 'hi ' },
      { type: 'emotion', name: 'shy', weight: 1.0 },
      { type: 'text', text: ' there' },
    ]);
  });

  it('buffers incomplete tag across feed() calls', () => {
    const p = new BehaviorParser();
    const e1 = [...p.feed('hi <emo:')];
    const e2 = [...p.feed('happy/> bye')];
    expect(e1).toEqual([{ type: 'text', text: 'hi ' }]);
    expect(e2).toEqual([
      { type: 'emotion', name: 'happy', weight: 1.0 },
      { type: 'text', text: ' bye' },
    ]);
  });

  it('parses emotion weight', () => {
    const p = new BehaviorParser();
    const events = [...p.feed('<emo:sad w=0.6/>')];
    expect(events).toEqual([{ type: 'emotion', name: 'sad', weight: 0.6 }]);
  });

  it('parses act tag with duration', () => {
    const p = new BehaviorParser();
    const events = [...p.feed('a<act:fidget dur=1800/>b')];
    expect(events).toEqual([
      { type: 'text', text: 'a' },
      { type: 'action', name: 'fidget', durationMs: 1800 },
      { type: 'text', text: 'b' },
    ]);
  });

  it('parses act tag without duration', () => {
    const p = new BehaviorParser();
    const events = [...p.feed('<act:wave/>')];
    expect(events).toEqual([{ type: 'action', name: 'wave', durationMs: null }]);
  });

  it('parses wait tag', () => {
    const p = new BehaviorParser();
    const events = [...p.feed('one<wait ms=500/>two')];
    expect(events).toEqual([
      { type: 'text', text: 'one' },
      { type: 'wait', ms: 500 },
      { type: 'text', text: 'two' },
    ]);
  });

  it('parses intent header at start of reply', () => {
    const p = new BehaviorParser();
    const events = [...p.feed('[intent mood=shy energy=low]hello')];
    expect(events).toEqual([
      { type: 'intent', mood: 'shy', energy: 'low' },
      { type: 'text', text: 'hello' },
    ]);
  });

  it('emits unknown tag as literal text', () => {
    const p = new BehaviorParser();
    const events = [...p.feed('a<bogus:xyz/>b')];
    expect(events).toEqual([
      { type: 'text', text: 'a' },
      { type: 'text', text: '<bogus:xyz/>' },
      { type: 'text', text: 'b' },
    ]);
  });

  it('flush emits buffered incomplete tag as text', () => {
    const p = new BehaviorParser();
    const e1 = [...p.feed('hi <emo:')];
    expect(e1).toEqual([{ type: 'text', text: 'hi ' }]);
    const e2 = [...p.flush()];
    expect(e2).toEqual([{ type: 'text', text: '<emo:' }]);
  });

  it('flush on empty buffer emits nothing', () => {
    const p = new BehaviorParser();
    expect([...p.flush()]).toEqual([]);
  });

  it('parses the full tech-design example end to end', () => {
    const p = new BehaviorParser();
    const events = [
      ...p.feed('[intent mood=shy energy=low]'),
      ...p.feed('嗯……<emo:shy/>我在想，'),
      ...p.feed('<act:fidget dur=1800/>要不要请你喝杯热可可？'),
      ...p.feed('<emo:happy/>'),
      ...p.flush(),
    ];
    expect(events).toEqual([
      { type: 'intent', mood: 'shy', energy: 'low' },
      { type: 'text', text: '嗯……' },
      { type: 'emotion', name: 'shy', weight: 1.0 },
      { type: 'text', text: '我在想，' },
      { type: 'action', name: 'fidget', durationMs: 1800 },
      { type: 'text', text: '要不要请你喝杯热可可？' },
      { type: 'emotion', name: 'happy', weight: 1.0 },
    ]);
  });

  it('handles two tags adjacent in one chunk', () => {
    const p = new BehaviorParser();
    const events = [...p.feed('<emo:sad/><act:sigh/>')];
    expect(events).toEqual([
      { type: 'emotion', name: 'sad', weight: 1.0 },
      { type: 'action', name: 'sigh', durationMs: null },
    ]);
  });
});

describe('say tag (M3, V1+ 语音的解析层 stub)', () => {
  it('parses <say:clip/> into a say event', () => {
    const p = new BehaviorParser();
    expect([...p.feed('a<say:greet/>b')]).toEqual([
      { type: 'text', text: 'a' },
      { type: 'say', clip: 'greet' },
      { type: 'text', text: 'b' },
    ]);
  });

  it('say interleaves with other tags', () => {
    const p = new BehaviorParser();
    expect([...p.feed('<emo:happy/><say:hi/><act:wave/>')]).toEqual([
      { type: 'emotion', name: 'happy', weight: 1.0 },
      { type: 'say', clip: 'hi' },
      { type: 'action', name: 'wave', durationMs: null },
    ]);
  });

  it('say with extra params is not a say tag (falls back to literal text)', () => {
    const p = new BehaviorParser();
    expect([...p.feed('<say:hi w=1/>')]).toEqual([{ type: 'text', text: '<say:hi w=1/>' }]);
  });
});

describe('numeric clamps (M3)', () => {
  it('exports BEHAVIOR_LIMITS', () => {
    expect(BEHAVIOR_LIMITS).toMatchObject({
      emotionWeightMax: 1,
      actionDurationMaxMs: 60_000,
      waitMaxMs: 10_000,
      maxTagLength: 128,
    });
  });

  it('keeps in-range weight, accepts leading-dot decimals', () => {
    const p = new BehaviorParser();
    expect([...p.feed('<emo:sad w=0.6/><emo:soft w=.5/><emo:zero w=0/>')]).toEqual([
      { type: 'emotion', name: 'sad', weight: 0.6 },
      { type: 'emotion', name: 'soft', weight: 0.5 },
      { type: 'emotion', name: 'zero', weight: 0 },
    ]);
  });

  it('clamps w>1 to 1 and warns value-clamped', () => {
    const { warns, onWarn } = collectWarns();
    const p = new BehaviorParser({ onWarn });
    expect([...p.feed('<emo:happy w=1.5/>')]).toEqual([
      { type: 'emotion', name: 'happy', weight: 1 },
    ]);
    expect(warns).toEqual([{ reason: 'value-clamped', raw: '<emo:happy w=1.5/>' }]);
  });

  it('clamps wait ms to 10s and warns', () => {
    const { warns, onWarn } = collectWarns();
    const p = new BehaviorParser({ onWarn });
    expect([...p.feed('<wait ms=999999/>')]).toEqual([{ type: 'wait', ms: 10_000 }]);
    expect(warns.map((w) => w.reason)).toEqual(['value-clamped']);
  });

  it('clamps act dur to 60s and warns', () => {
    const { warns, onWarn } = collectWarns();
    const p = new BehaviorParser({ onWarn });
    expect([...p.feed('<act:dance dur=99999999/>')]).toEqual([
      { type: 'action', name: 'dance', durationMs: 60_000 },
    ]);
    expect(warns.map((w) => w.reason)).toEqual(['value-clamped']);
  });

  it('in-range boundary values pass without warn', () => {
    const { warns, onWarn } = collectWarns();
    const p = new BehaviorParser({ onWarn });
    expect([
      ...p.feed('<wait ms=10000/><act:hold dur=60000/><act:tap dur=0/><wait ms=0/>'),
    ]).toEqual([
      { type: 'wait', ms: 10_000 },
      { type: 'action', name: 'hold', durationMs: 60_000 },
      { type: 'action', name: 'tap', durationMs: 0 },
      { type: 'wait', ms: 0 },
    ]);
    expect(warns).toEqual([]);
  });

  it('rejects double-dot weight as a non-tag (literal text)', () => {
    const p = new BehaviorParser();
    expect([...p.feed('<emo:sad w=1.2.3/>')]).toEqual([
      { type: 'text', text: '<emo:sad w=1.2.3/>' },
    ]);
  });

  it('constructor without options never throws on clamp paths', () => {
    const p = new BehaviorParser();
    expect([...p.feed('<emo:x w=5/>')]).toEqual([{ type: 'emotion', name: 'x', weight: 1 }]);
  });
});
