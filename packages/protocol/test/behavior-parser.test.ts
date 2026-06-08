import { describe, it, expect } from 'vitest';
import { BehaviorParser } from '../src/behavior-parser';

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
