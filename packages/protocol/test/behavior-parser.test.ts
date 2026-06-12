import { describe, it, expect } from 'vitest';
import {
  BehaviorParser,
  BEHAVIOR_LIMITS,
  type BehaviorEvent,
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

// ---------- 切分不变性（性质测试） ----------

function mergeText(events: BehaviorEvent[]): BehaviorEvent[] {
  const out: BehaviorEvent[] = [];
  for (const e of events) {
    const last = out[out.length - 1];
    if (e.type === 'text' && last?.type === 'text') {
      out[out.length - 1] = { type: 'text', text: last.text + e.text };
    } else if (e.type !== 'text' || e.text !== '') {
      out.push(e);
    }
  }
  return out;
}

function runChunks(chunks: readonly string[]): { events: BehaviorEvent[]; warns: string[] } {
  const warns: string[] = [];
  const p = new BehaviorParser({ onWarn: (reason) => warns.push(reason) });
  const events: BehaviorEvent[] = [];
  for (const c of chunks) events.push(...p.feed(c));
  events.push(...p.flush());
  return { events: mergeText(events), warns };
}

const SPLIT_SAMPLES: readonly string[] = [
  // 1 tech-design §4.1 原例
  '[intent mood=shy energy=low]\n嗯……<emo:shy/>我在想，<act:fidget dur=1800/>要不要请你喝杯热可可？<emo:happy/>',
  // 2 纯文本
  'hello world, nothing special here',
  // 3 单标签
  '<emo:happy/>',
  // 4 全标签家族混排
  'a<emo:sad w=0.6/>b<act:wave/>c<wait ms=500/>d<say:greet/>e[尾巴]',
  // 5 marker 噪声（数学/比较符）
  'i<3 you & a<b but x>y still fine',
  // 6 方括号噪声（markdown / 数组）
  '[链接](https://example.com) 和 arr[0] 以及 [random brackets]',
  // 7 未注册 taglike
  'pre<bogus:x/>mid<div>post',
  // 8 malformed 注册标签
  '<emo:bad name/>oops<wait foo/>and[intent mood=x]tail',
  // 9 中途 intent（误用）
  '[intent mood=a energy=b]开头正常[intent mood=c energy=d]中途要降级',
  // 10 前导空白 + intent
  '  \n\t[intent mood=calm energy=high]前导空白后仍算段首',
  // 11 数值越界 clamp
  '<emo:happy w=1.5/>强烈<wait ms=99999/>久等<act:spin dur=99999999/>',
  // 12 双开角
  'x<<emo:shy/>y',
  // 13 连发标签
  '<emo:shy/><act:sigh/><wait ms=100/><say:hum/>',
  // 14 半截收尾（flush 路径）
  '正文说到一半<emo:',
  // 15 长文本 + 标签
  'x'.repeat(140) + '<emo:happy/>' + 'y'.repeat(40),
  // 16 溢出路径（未闭合超长）
  '<' + 'a'.repeat(140),
  // 17 中文标点不是 marker
  '《书名》〈角标〉【方头】，全都只是文本。',
  // 18 emoji（UTF-16 代理对在切分点被劈开也要无损）
  '😊开心<emo:happy/>🎉庆祝<act:jump/>完',
  // 19 邻接 intent + 立即标签
  '[intent mood=happy energy=high]<emo:happy/>!',
  // 20 嵌套标签（误用）：内层先闭合 → 外层成 malformed 原样放行，内层后的尾巴是纯文本
  '前<emo:ha<act:wave/>ppy/>后',
];

describe('流式切分不变性（性质测试：任意切分 ≡ 整串）', () => {
  it.each(SPLIT_SAMPLES.map((s, i) => [i + 1, s] as const))(
    'sample #%i: every binary split, char-by-char, and thirds agree with whole-string',
    (_i, sample) => {
      const whole = runChunks([sample]);
      for (let cut = 1; cut < sample.length; cut++) {
        const split = runChunks([sample.slice(0, cut), sample.slice(cut)]);
        expect(split.events).toEqual(whole.events);
        expect(split.warns).toEqual(whole.warns);
      }
      const chars = runChunks(sample.split(''));
      expect(chars.events).toEqual(whole.events);
      expect(chars.warns).toEqual(whole.warns);
      const t = Math.max(1, Math.floor(sample.length / 3));
      const thirds = runChunks([sample.slice(0, t), sample.slice(t, 2 * t), sample.slice(2 * t)]);
      expect(thirds.events).toEqual(whole.events);
      expect(thirds.warns).toEqual(whole.warns);
    },
  );

  it('tag syntax never leaks into text events for clean samples', () => {
    // 对不含误用的样例（#1/3/4/13/19），text 事件里不允许残留任何注册标签语法
    for (const sample of [
      SPLIT_SAMPLES[0]!,
      SPLIT_SAMPLES[2]!,
      SPLIT_SAMPLES[3]!,
      SPLIT_SAMPLES[12]!,
      SPLIT_SAMPLES[18]!,
    ]) {
      const { events, warns } = runChunks([sample]);
      expect(warns).toEqual([]);
      for (const e of events) {
        if (e.type === 'text') {
          expect(e.text).not.toMatch(
            /<emo:[\w-]+\s*\/>|<act:[\w-]+|<wait ms=\d+\s*\/>|<say:[\w-]+\s*\/>|^\[intent /,
          );
        }
      }
    }
  });
});

// ---------- flush 行为与钩子安全 ----------

describe('flush & hook edge cases (M3)', () => {
  it('flush mid-stream then continue: subsequent tags still parse', () => {
    const p = new BehaviorParser();
    void [...p.feed('a<act:')]; // 半截
    expect([...p.flush()]).toEqual([{ type: 'text', text: '<act:' }]);
    expect([...p.feed('<act:wave/>')]).toEqual([{ type: 'action', name: 'wave', durationMs: null }]);
  });

  it('flush with a viable [ prefix releases it as text', () => {
    const p = new BehaviorParser();
    void [...p.feed('x[inte')];
    expect([...p.flush()]).toEqual([{ type: 'text', text: '[inte' }]);
  });

  it('flushing twice is idempotent', () => {
    const p = new BehaviorParser();
    void [...p.feed('y<emo:')];
    void [...p.flush()];
    expect([...p.flush()]).toEqual([]);
  });

  it('empty feed is a no-op', () => {
    const p = new BehaviorParser();
    expect([...p.feed('')]).toEqual([]);
    expect(p.hasPendingInput()).toBe(false);
  });

  it('whitespace-only stream stays head (intent after it is still valid)', () => {
    const p = new BehaviorParser();
    void [...p.feed('   ')];
    expect([...p.feed('[intent mood=a energy=b]')]).toEqual([
      { type: 'intent', mood: 'a', energy: 'b' },
    ]);
  });

  it('warn hook is optional everywhere (all warn paths run without onWarn)', () => {
    const p = new BehaviorParser();
    const all = [
      ...p.feed('<emo:x w=9/>'), // value-clamped
      ...p.feed('<bogus:y/>'), // unregistered
      ...p.feed('<wait zzz/>'), // malformed
      ...p.feed('t[intent mood=a energy=b]'), // misplaced
      ...p.feed('<' + 'q'.repeat(140)), // overflow
      ...p.flush(),
    ];
    expect(all.length).toBeGreaterThan(0); // 不炸即过，事件细节由上面各组覆盖
  });
});
