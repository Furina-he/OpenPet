import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  ConversationCore,
  STALE_FLUSH_MS,
  type Notification,
} from '../electron/main/conversation-core';
import type { ChatEvent } from '@desksoul/protocol';

/** Drive a sequence of provider events through a core and collect notifications. */
function run(events: ChatEvent[], sessionId = 's1'): Notification[] {
  const out: Notification[] = [];
  const core = new ConversationCore((n) => out.push(n));
  for (const e of events) core.handleEvent(sessionId, e);
  return out;
}

describe('ConversationCore dual-channel split', () => {
  it('splits one delta into interleaved chat.stream and behavior.applyEmotion', () => {
    const out = run([
      { type: 'delta', text: 'hi <emo:shy/> there' },
      { type: 'done', finishReason: 'stop' },
    ]);
    expect(out).toEqual([
      { channel: 'chat.stream', sessionId: 's1', params: { sessionId: 's1', text: 'hi ' } },
      { channel: 'behavior.applyEmotion', sessionId: 's1', params: { name: 'shy', weight: 1.0 } },
      { channel: 'chat.stream', sessionId: 's1', params: { sessionId: 's1', text: ' there' } },
      { channel: 'chat.done', sessionId: 's1', params: { sessionId: 's1', finishReason: 'stop' } },
    ]);
  });

  it('reassembles a tag split across two deltas', () => {
    const out = run([
      { type: 'delta', text: '我在想<act:fidget ' },
      { type: 'delta', text: 'dur=1500/>好' },
      { type: 'done', finishReason: 'stop' },
    ]);
    expect(out).toEqual([
      { channel: 'chat.stream', sessionId: 's1', params: { sessionId: 's1', text: '我在想' } },
      {
        channel: 'behavior.playAction',
        sessionId: 's1',
        params: { name: 'fidget', durationMs: 1500 },
      },
      { channel: 'chat.stream', sessionId: 's1', params: { sessionId: 's1', text: '好' } },
      { channel: 'chat.done', sessionId: 's1', params: { sessionId: 's1', finishReason: 'stop' } },
    ]);
  });

  it('emits intent header on the behavior track', () => {
    const out = run([
      { type: 'delta', text: '[intent mood=shy energy=low]hello' },
      { type: 'done', finishReason: 'stop' },
    ]);
    expect(out).toEqual([
      { channel: 'behavior.setIntent', sessionId: 's1', params: { mood: 'shy', energy: 'low' } },
      { channel: 'chat.stream', sessionId: 's1', params: { sessionId: 's1', text: 'hello' } },
      { channel: 'chat.done', sessionId: 's1', params: { sessionId: 's1', finishReason: 'stop' } },
    ]);
  });

  it('flushes a buffered half-tag as text on done', () => {
    const out = run([
      { type: 'delta', text: 'bye <emo:' },
      { type: 'done', finishReason: 'cancel' },
    ]);
    expect(out).toEqual([
      { channel: 'chat.stream', sessionId: 's1', params: { sessionId: 's1', text: 'bye ' } },
      { channel: 'chat.stream', sessionId: 's1', params: { sessionId: 's1', text: '<emo:' } },
      { channel: 'chat.done', sessionId: 's1', params: { sessionId: 's1', finishReason: 'cancel' } },
    ]);
  });

  it('keeps per-session parser buffers independent', () => {
    const out: Notification[] = [];
    const core = new ConversationCore((n) => out.push(n));
    core.handleEvent('s1', { type: 'delta', text: 'a<emo:' });
    core.handleEvent('s2', { type: 'delta', text: 'b<emo:sad/>c' });
    core.handleEvent('s1', { type: 'delta', text: 'happy/>d' });
    expect(out).toEqual([
      { channel: 'chat.stream', sessionId: 's1', params: { sessionId: 's1', text: 'a' } },
      { channel: 'chat.stream', sessionId: 's2', params: { sessionId: 's2', text: 'b' } },
      { channel: 'behavior.applyEmotion', sessionId: 's2', params: { name: 'sad', weight: 1.0 } },
      { channel: 'chat.stream', sessionId: 's2', params: { sessionId: 's2', text: 'c' } },
      { channel: 'behavior.applyEmotion', sessionId: 's1', params: { name: 'happy', weight: 1.0 } },
      { channel: 'chat.stream', sessionId: 's1', params: { sessionId: 's1', text: 'd' } },
    ]);
  });

  it('propagates an error finishReason from a synthesized host done', () => {
    const out = run([
      { type: 'delta', text: 'partial' },
      { type: 'done', finishReason: 'error' },
    ]);
    expect(out).toEqual([
      { channel: 'chat.stream', sessionId: 's1', params: { sessionId: 's1', text: 'partial' } },
      { channel: 'chat.done', sessionId: 's1', params: { sessionId: 's1', finishReason: 'error' } },
    ]);
  });
});

describe('ConversationCore cancel semantics (M2)', () => {
  it('drops deltas arriving after cancel(), but still emits the done', () => {
    const out: Notification[] = [];
    const core = new ConversationCore((n) => out.push(n));
    core.handleEvent('s1', { type: 'delta', text: 'before ' });
    core.cancel('s1');
    core.handleEvent('s1', { type: 'delta', text: 'late <emo:shy/>' });
    core.handleEvent('s1', { type: 'done', finishReason: 'cancel' });
    expect(out).toEqual([
      { channel: 'chat.stream', sessionId: 's1', params: { sessionId: 's1', text: 'before ' } },
      { channel: 'chat.done', sessionId: 's1', params: { sessionId: 's1', finishReason: 'cancel' } },
    ]);
  });

  it('discards the buffered half-tag on cancel instead of flushing it as text', () => {
    const out: Notification[] = [];
    const core = new ConversationCore((n) => out.push(n));
    core.handleEvent('s1', { type: 'delta', text: 'hi <emo:' });
    core.cancel('s1');
    core.handleEvent('s1', { type: 'done', finishReason: 'cancel' });
    expect(out).toEqual([
      { channel: 'chat.stream', sessionId: 's1', params: { sessionId: 's1', text: 'hi ' } },
      { channel: 'chat.done', sessionId: 's1', params: { sessionId: 's1', finishReason: 'cancel' } },
    ]);
  });

  it('clears the cancelling mark on done so the next stream flows again', () => {
    const out: Notification[] = [];
    const core = new ConversationCore((n) => out.push(n));
    core.cancel('s1');
    core.handleEvent('s1', { type: 'done', finishReason: 'cancel' });
    core.handleEvent('s1', { type: 'delta', text: 'fresh' });
    expect(out).toEqual([
      { channel: 'chat.done', sessionId: 's1', params: { sessionId: 's1', finishReason: 'cancel' } },
      { channel: 'chat.stream', sessionId: 's1', params: { sessionId: 's1', text: 'fresh' } },
    ]);
  });

  it('cancel only silences its own session', () => {
    const out: Notification[] = [];
    const core = new ConversationCore((n) => out.push(n));
    core.cancel('s1');
    core.handleEvent('s2', { type: 'delta', text: 'other' });
    expect(out).toEqual([
      { channel: 'chat.stream', sessionId: 's2', params: { sessionId: 's2', text: 'other' } },
    ]);
  });
});

describe('ConversationCore M3: say stub / warn wiring / stale flush', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('say events are consumed silently (stub until V1+ voice)', () => {
    const out = run([
      { type: 'delta', text: 'a<say:greet/>b' },
      { type: 'done', finishReason: 'stop' },
    ]);
    expect(out).toEqual([
      { channel: 'chat.stream', sessionId: 's1', params: { sessionId: 's1', text: 'a' } },
      { channel: 'chat.stream', sessionId: 's1', params: { sessionId: 's1', text: 'b' } },
      { channel: 'chat.done', sessionId: 's1', params: { sessionId: 's1', finishReason: 'stop' } },
    ]);
  });

  it('forwards parser warns with sessionId through opts.warn', () => {
    const warns: Array<[string, string, string]> = [];
    const core = new ConversationCore(() => {}, {
      warn: (sid, reason, raw) => warns.push([sid, reason, raw]),
    });
    core.handleEvent('s9', { type: 'delta', text: '<emo:x w=5/>' });
    expect(warns).toEqual([['s9', 'value-clamped', '<emo:x w=5/>']]);
  });

  it('stale flush: a half tag is released as text after STALE_FLUSH_MS of silence', () => {
    vi.useFakeTimers();
    const out: Notification[] = [];
    const warns: string[] = [];
    const core = new ConversationCore((n) => out.push(n), {
      warn: (_sid, reason) => warns.push(reason),
    });
    core.handleEvent('s1', { type: 'delta', text: '想了想<emo:' });
    expect(out).toEqual([
      { channel: 'chat.stream', sessionId: 's1', params: { sessionId: 's1', text: '想了想' } },
    ]);
    vi.advanceTimersByTime(STALE_FLUSH_MS - 1);
    expect(out).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(out[1]).toEqual({
      channel: 'chat.stream',
      sessionId: 's1',
      params: { sessionId: 's1', text: '<emo:' },
    });
    expect(warns).toContain('stale-flush');
  });

  it('a fresh delta within the window re-arms the timer and the tag still parses', () => {
    vi.useFakeTimers();
    const out: Notification[] = [];
    const core = new ConversationCore((n) => out.push(n));
    core.handleEvent('s1', { type: 'delta', text: 'hi <emo:' });
    vi.advanceTimersByTime(STALE_FLUSH_MS - 1);
    core.handleEvent('s1', { type: 'delta', text: 'happy/>!' });
    vi.advanceTimersByTime(STALE_FLUSH_MS * 2);
    expect(out).toEqual([
      { channel: 'chat.stream', sessionId: 's1', params: { sessionId: 's1', text: 'hi ' } },
      { channel: 'behavior.applyEmotion', sessionId: 's1', params: { name: 'happy', weight: 1.0 } },
      { channel: 'chat.stream', sessionId: 's1', params: { sessionId: 's1', text: '!' } },
    ]);
  });

  it('stream continues normally after a stale flush', () => {
    vi.useFakeTimers();
    const out: Notification[] = [];
    const core = new ConversationCore((n) => out.push(n));
    core.handleEvent('s1', { type: 'delta', text: '<emo:' });
    vi.advanceTimersByTime(STALE_FLUSH_MS);
    core.handleEvent('s1', { type: 'delta', text: '<emo:happy/>ok' });
    core.handleEvent('s1', { type: 'done', finishReason: 'stop' });
    expect(out).toEqual([
      { channel: 'chat.stream', sessionId: 's1', params: { sessionId: 's1', text: '<emo:' } },
      { channel: 'behavior.applyEmotion', sessionId: 's1', params: { name: 'happy', weight: 1.0 } },
      { channel: 'chat.stream', sessionId: 's1', params: { sessionId: 's1', text: 'ok' } },
      { channel: 'chat.done', sessionId: 's1', params: { sessionId: 's1', finishReason: 'stop' } },
    ]);
  });

  it('no stale timer fires when the buffer is empty (plain text deltas)', () => {
    vi.useFakeTimers();
    const out: Notification[] = [];
    const core = new ConversationCore((n) => out.push(n));
    core.handleEvent('s1', { type: 'delta', text: 'plain' });
    vi.advanceTimersByTime(STALE_FLUSH_MS * 3);
    expect(out).toHaveLength(1);
  });

  it('done clears the stale timer (no late text after done)', () => {
    vi.useFakeTimers();
    const out: Notification[] = [];
    const core = new ConversationCore((n) => out.push(n));
    core.handleEvent('s1', { type: 'delta', text: 'a<emo:' });
    core.handleEvent('s1', { type: 'done', finishReason: 'stop' });
    const len = out.length;
    vi.advanceTimersByTime(STALE_FLUSH_MS * 2);
    expect(out).toHaveLength(len);
  });

  it('cancel clears the stale timer (no text leaks after cancel)', () => {
    vi.useFakeTimers();
    const out: Notification[] = [];
    const core = new ConversationCore((n) => out.push(n));
    core.handleEvent('s1', { type: 'delta', text: 'a<emo:' });
    core.cancel('s1');
    vi.advanceTimersByTime(STALE_FLUSH_MS * 2);
    expect(out).toEqual([
      { channel: 'chat.stream', sessionId: 's1', params: { sessionId: 's1', text: 'a' } },
    ]);
  });

  it('dispose clears all timers across sessions', () => {
    vi.useFakeTimers();
    const out: Notification[] = [];
    const core = new ConversationCore((n) => out.push(n));
    core.handleEvent('s1', { type: 'delta', text: '<emo:' });
    core.handleEvent('s2', { type: 'delta', text: '<act:' });
    core.dispose();
    vi.advanceTimersByTime(STALE_FLUSH_MS * 2);
    expect(out).toEqual([]);
  });
});
