import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NotificationQueue } from '../electron/main/notification-queue';

type Sent = { channel: string; params: unknown };

function stream(sessionId: string, text: string, seq: number) {
  return { channel: 'chat.stream', sessionId, params: { sessionId, text, seq } };
}
function emotion(sessionId: string, name: string) {
  return { channel: 'behavior.applyEmotion', sessionId, params: { name, weight: 1 } };
}

describe('NotificationQueue', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('delivers a pushed notification on the next flush tick', () => {
    const sent: Sent[] = [];
    const q = new NotificationQueue((channel, params) => sent.push({ channel, params }), {
      flushIntervalMs: 16,
    });
    q.push(stream('s1', 'hi', 1));
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(16);
    expect(sent).toEqual([{ channel: 'chat.stream', params: { sessionId: 's1', text: 'hi', seq: 1 } }]);
    q.dispose();
  });

  it('merges adjacent same-session deltas on overflow, keeping text lossless', () => {
    const sent: Sent[] = [];
    const q = new NotificationQueue((channel, params) => sent.push({ channel, params }), {
      flushIntervalMs: 16,
      maxPerSession: 8,
    });
    for (let i = 1; i <= 1000; i++) q.push(stream('s1', `t${i};`, i));
    expect(q.pendingCount('s1')).toBeLessThanOrEqual(8);
    vi.advanceTimersByTime(16);
    const text = sent.map((s) => (s.params as { text: string }).text).join('');
    expect(text).toBe(Array.from({ length: 1000 }, (_, i) => `t${i + 1};`).join(''));
    const lastSeq = (sent[sent.length - 1]!.params as { seq: number }).seq;
    expect(lastSeq).toBe(1000);
    q.dispose();
  });

  it('never merges across a behavior event (message boundary preserved)', () => {
    const sent: Sent[] = [];
    const q = new NotificationQueue((channel, params) => sent.push({ channel, params }), {
      flushIntervalMs: 16,
      maxPerSession: 2,
    });
    q.push(stream('s1', 'a', 1));
    q.push(stream('s1', 'b', 2));
    q.push(emotion('s1', 'shy'));
    q.push(stream('s1', 'c', 3));
    q.push(stream('s1', 'd', 4));
    vi.advanceTimersByTime(16);
    expect(sent.map((s) => s.channel)).toEqual([
      'chat.stream',
      'behavior.applyEmotion',
      'chat.stream',
    ]);
    expect((sent[0]!.params as { text: string }).text).toBe('ab');
    expect((sent[2]!.params as { text: string }).text).toBe('cd');
    q.dispose();
  });

  it('keeps cross-session relative order and never merges across sessions', () => {
    const sent: Sent[] = [];
    const q = new NotificationQueue((channel, params) => sent.push({ channel, params }), {
      flushIntervalMs: 16,
      maxPerSession: 1,
    });
    q.push(stream('s1', 'a', 1));
    q.push(stream('s2', 'x', 1));
    q.push(stream('s1', 'b', 2));
    vi.advanceTimersByTime(16);
    expect(sent.map((s) => (s.params as { sessionId: string; text: string }).text)).toEqual([
      'a',
      'x',
      'b',
    ]);
    q.dispose();
  });

  it('urgent push flushes the whole queue immediately, in order', () => {
    const sent: Sent[] = [];
    const q = new NotificationQueue((channel, params) => sent.push({ channel, params }));
    q.push(stream('s1', 'hi', 1));
    q.push(
      { channel: 'chat.done', sessionId: 's1', params: { sessionId: 's1', finishReason: 'stop' } },
      { urgent: true },
    );
    expect(sent.map((s) => s.channel)).toEqual(['chat.stream', 'chat.done']);
    q.dispose();
  });

  it('dropSession clears pending entries for that session only', () => {
    const sent: Sent[] = [];
    const q = new NotificationQueue((channel, params) => sent.push({ channel, params }), {
      flushIntervalMs: 16,
    });
    q.push(stream('s1', 'a', 1));
    q.push(emotion('s1', 'shy'));
    q.push(stream('s2', 'x', 1));
    q.dropSession('s1');
    expect(q.pendingCount('s1')).toBe(0);
    vi.advanceTimersByTime(16);
    expect(sent).toEqual([{ channel: 'chat.stream', params: { sessionId: 's2', text: 'x', seq: 1 } }]);
    q.dispose();
  });

  it('dispose cancels the pending flush and drops entries', () => {
    const sent: Sent[] = [];
    const q = new NotificationQueue((channel, params) => sent.push({ channel, params }));
    q.push(stream('s1', 'a', 1));
    q.dispose();
    vi.advanceTimersByTime(1000);
    expect(sent).toEqual([]);
    expect(q.pendingCount()).toBe(0);
  });
});
