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

describe('prefix classification — plain text passes through instantly (M3)', () => {
  it('math-like "<" never buffers: a < b stays whole-ish text with zero warns', () => {
    const { warns, onWarn } = collectWarns();
    const p = new BehaviorParser({ onWarn });
    const events = [...p.feed('a < b and c > d'), ...p.flush()];
    expect(events.map((e) => (e.type === 'text' ? e.text : e)).join('')).toBe('a < b and c > d');
    expect(p.hasPendingInput()).toBe(false);
    expect(warns).toEqual([]);
  });

  it('i<3 you releases immediately', () => {
    const p = new BehaviorParser();
    const events = [...p.feed('i<3 you')];
    expect(events.every((e) => e.type === 'text')).toBe(true);
    expect(events.map((e) => (e as { text: string }).text).join('')).toBe('i<3 you');
    expect(p.hasPendingInput()).toBe(false);
  });

  it('markdown link [text](url) releases immediately without waiting for ]', () => {
    const p = new BehaviorParser();
    // 关键：feed 到 "[link" 为止就该放行 "["（不等永远不来的 "]"）
    const e1 = [...p.feed('see [link')];
    expect(e1.map((e) => (e as { text: string }).text).join('')).toBe('see [link');
    const e2 = [...p.feed('](url)')];
    expect(e2.map((e) => (e as { text: string }).text).join('')).toBe('](url)');
  });

  it('array index arr[0] passes through', () => {
    const p = new BehaviorParser();
    const events = [...p.feed('arr[0] = 1'), ...p.flush()];
    expect(events.map((e) => (e as { text: string }).text).join('')).toBe('arr[0] = 1');
  });

  it('double angle <<emo:shy/> releases first < then parses the tag', () => {
    const p = new BehaviorParser();
    expect([...p.feed('<<emo:shy/>')]).toEqual([
      { type: 'text', text: '<' },
      { type: 'emotion', name: 'shy', weight: 1.0 },
    ]);
  });

  it('closing-slash </div> is reject (slash is not a letter), no warn', () => {
    const { warns, onWarn } = collectWarns();
    const p = new BehaviorParser({ onWarn });
    const events = [...p.feed('x</div>y'), ...p.flush()];
    expect(events.map((e) => (e as { text: string }).text).join('')).toBe('x</div>y');
    expect(warns).toEqual([]);
  });

  it('CJK brackets are not markers at all', () => {
    const p = new BehaviorParser();
    expect([...p.feed('《书》〈角〉【框】不是标签')]).toEqual([
      { type: 'text', text: '《书》〈角〉【框】不是标签' },
    ]);
  });
});

describe('unregistered tag-like input (M3)', () => {
  it('emits <bogus:xyz/> as one literal text and warns unregistered-tag', () => {
    const { warns, onWarn } = collectWarns();
    const p = new BehaviorParser({ onWarn });
    expect([...p.feed('a<bogus:xyz/>b')]).toEqual([
      { type: 'text', text: 'a' },
      { type: 'text', text: '<bogus:xyz/>' },
      { type: 'text', text: 'b' },
    ]);
    expect(warns).toEqual([{ reason: 'unregistered-tag', raw: '<bogus:xyz/>' }]);
  });

  it('html-ish <div> warns unregistered-tag and passes through', () => {
    const { warns, onWarn } = collectWarns();
    const p = new BehaviorParser({ onWarn });
    const events = [...p.feed('<div>hello')];
    expect(events[0]).toEqual({ type: 'text', text: '<div>' });
    expect(warns.map((w) => w.reason)).toEqual(['unregistered-tag']);
  });

  it('unregistered tag split across chunks still assembles', () => {
    const { warns, onWarn } = collectWarns();
    const p = new BehaviorParser({ onWarn });
    const e1 = [...p.feed('<bog')];
    expect(e1).toEqual([]); // taglike，等闭合
    const e2 = [...p.feed('us:x/>done')];
    expect(e2).toEqual([
      { type: 'text', text: '<bogus:x/>' },
      { type: 'text', text: 'done' },
    ]);
    expect(warns.map((w) => w.reason)).toEqual(['unregistered-tag']);
  });
});

describe('malformed registered tags (M3)', () => {
  it('warns malformed-tag for bad emo body', () => {
    const { warns, onWarn } = collectWarns();
    const p = new BehaviorParser({ onWarn });
    expect([...p.feed('<emo:bad name/>')]).toEqual([{ type: 'text', text: '<emo:bad name/>' }]);
    expect(warns).toEqual([{ reason: 'malformed-tag', raw: '<emo:bad name/>' }]);
  });

  it('warns malformed-tag for <wait foo/>', () => {
    const { warns, onWarn } = collectWarns();
    const p = new BehaviorParser({ onWarn });
    expect([...p.feed('<wait foo/>')]).toEqual([{ type: 'text', text: '<wait foo/>' }]);
    expect(warns.map((w) => w.reason)).toEqual(['malformed-tag']);
  });

  it('warns malformed-tag for incomplete intent ([intent mood=x])', () => {
    const { warns, onWarn } = collectWarns();
    const p = new BehaviorParser({ onWarn });
    expect([...p.feed('[intent mood=x]hi')]).toEqual([
      { type: 'text', text: '[intent mood=x]' },
      { type: 'text', text: 'hi' },
    ]);
    expect(warns.map((w) => w.reason)).toEqual(['malformed-tag']);
  });

  it('double-dot weight now warns malformed-tag (Task 1 left it silent)', () => {
    const { warns, onWarn } = collectWarns();
    const p = new BehaviorParser({ onWarn });
    expect([...p.feed('<emo:sad w=1.2.3/>')]).toEqual([
      { type: 'text', text: '<emo:sad w=1.2.3/>' },
    ]);
    expect(warns.map((w) => w.reason)).toEqual(['malformed-tag']);
  });

  it('say with extra params warns malformed-tag', () => {
    const { warns, onWarn } = collectWarns();
    const p = new BehaviorParser({ onWarn });
    expect([...p.feed('<say:hi w=1/>')]).toEqual([{ type: 'text', text: '<say:hi w=1/>' }]);
    expect(warns.map((w) => w.reason)).toEqual(['malformed-tag']);
  });

  it('nested tags are misuse: outer half becomes malformed literal, no event leakage', () => {
    const { warns, onWarn } = collectWarns();
    const p = new BehaviorParser({ onWarn });
    // 第一个 ">" 在内层 <act:wave/> 处闭合 → raw "<emo:ha<act:wave/>" 不合语法
    expect([...p.feed('<emo:ha<act:wave/>ppy/>')]).toEqual([
      { type: 'text', text: '<emo:ha<act:wave/>' },
      { type: 'text', text: 'ppy/>' },
    ]);
    expect(warns.map((w) => w.reason)).toEqual(['malformed-tag']);
  });
});

describe('tag overflow guard (M3)', () => {
  it('releases an unclosed over-long registered prefix as text with tag-overflow', () => {
    const { warns, onWarn } = collectWarns();
    const p = new BehaviorParser({ onWarn });
    const long = '<emo:' + 'a'.repeat(140); // 145 chars，无 ">"
    const events = [...p.feed(long)];
    expect(events).toEqual([{ type: 'text', text: long }]);
    expect(warns.map((w) => w.reason)).toEqual(['tag-overflow']);
    expect(p.hasPendingInput()).toBe(false);
  });

  it('overflow fires across incremental feeds too', () => {
    const { warns, onWarn } = collectWarns();
    const p = new BehaviorParser({ onWarn });
    let released = '';
    let all = '';
    for (let i = 0; i < 150; i++) {
      const c = i === 0 ? '<' : 'x';
      all += c;
      for (const e of p.feed(c)) released += (e as { text: string }).text;
    }
    expect(warns.map((w) => w.reason)).toEqual(['tag-overflow']);
    for (const e of p.flush()) released += (e as { text: string }).text;
    expect(released).toBe(all); // 文本无损
  });

  it('a fully closed long tag is NOT overflow (limit is the waiting window)', () => {
    const { warns, onWarn } = collectWarns();
    const p = new BehaviorParser({ onWarn });
    const name = 'a'.repeat(150);
    expect([...p.feed(`<emo:${name}/>`)]).toEqual([{ type: 'emotion', name, weight: 1.0 }]);
    expect(warns).toEqual([]);
  });
});

describe('intent is head-only (M3)', () => {
  it('accepts intent after leading whitespace/newlines', () => {
    const p = new BehaviorParser();
    expect([...p.feed('  \n[intent mood=calm energy=high]go')]).toEqual([
      { type: 'text', text: '  \n' },
      { type: 'intent', mood: 'calm', energy: 'high' },
      { type: 'text', text: 'go' },
    ]);
  });

  it('demotes mid-reply intent to literal text with misplaced-intent', () => {
    const { warns, onWarn } = collectWarns();
    const p = new BehaviorParser({ onWarn });
    expect([...p.feed('text first [intent mood=shy energy=low] after')]).toEqual([
      { type: 'text', text: 'text first ' },
      { type: 'text', text: '[intent mood=shy energy=low]' },
      { type: 'text', text: ' after' },
    ]);
    expect(warns).toEqual([{ reason: 'misplaced-intent', raw: '[intent mood=shy energy=low]' }]);
  });

  it('a second intent is misplaced even right after the first', () => {
    const { warns, onWarn } = collectWarns();
    const p = new BehaviorParser({ onWarn });
    const events = [...p.feed('[intent mood=a energy=b][intent mood=c energy=d]')];
    expect(events).toEqual([
      { type: 'intent', mood: 'a', energy: 'b' },
      { type: 'text', text: '[intent mood=c energy=d]' },
    ]);
    expect(warns.map((w) => w.reason)).toEqual(['misplaced-intent']);
  });

  it('intent after a behavior event is misplaced', () => {
    const { warns, onWarn } = collectWarns();
    const p = new BehaviorParser({ onWarn });
    const events = [...p.feed('<emo:happy/>[intent mood=a energy=b]')];
    expect(events).toEqual([
      { type: 'emotion', name: 'happy', weight: 1.0 },
      { type: 'text', text: '[intent mood=a energy=b]' },
    ]);
    expect(warns.map((w) => w.reason)).toEqual(['misplaced-intent']);
  });

  it('head state survives chunk boundaries (whitespace chunks first)', () => {
    const p = new BehaviorParser();
    const events = [...p.feed(' '), ...p.feed('\n'), ...p.feed('[intent mood=a energy=b]x')];
    expect(events).toEqual([
      { type: 'text', text: ' ' },
      { type: 'text', text: '\n' },
      { type: 'intent', mood: 'a', energy: 'b' },
      { type: 'text', text: 'x' },
    ]);
  });
});

describe('hasPendingInput (M3, ConversationCore stale-flush 的武装依据)', () => {
  it('true while a half tag is buffered, false after flush', () => {
    const p = new BehaviorParser();
    void [...p.feed('hi <emo:')];
    expect(p.hasPendingInput()).toBe(true);
    void [...p.flush()];
    expect(p.hasPendingInput()).toBe(false);
  });

  it('false after plain text fully drains', () => {
    const p = new BehaviorParser();
    void [...p.feed('plain')];
    expect(p.hasPendingInput()).toBe(false);
  });

  it('parser remains usable after flush (stale-flush continuation)', () => {
    const p = new BehaviorParser();
    expect([...p.feed('a<emo:')]).toEqual([{ type: 'text', text: 'a' }]);
    expect([...p.flush()]).toEqual([{ type: 'text', text: '<emo:' }]);
    expect([...p.feed('<emo:happy/>')]).toEqual([{ type: 'emotion', name: 'happy', weight: 1.0 }]);
  });
});
