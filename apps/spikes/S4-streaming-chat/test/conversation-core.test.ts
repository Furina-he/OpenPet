import { describe, it, expect } from 'vitest';
import { ConversationCore, type Notification } from '../electron/main/conversation-core';
import type { ChatEvent } from '../electron/main/provider-host';

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
      { channel: 'chat.stream', params: { sessionId: 's1', text: 'hi ' } },
      { channel: 'behavior.applyEmotion', params: { name: 'shy', weight: 1.0 } },
      { channel: 'chat.stream', params: { sessionId: 's1', text: ' there' } },
      { channel: 'chat.done', params: { sessionId: 's1', finishReason: 'stop' } },
    ]);
  });

  it('reassembles a tag split across two deltas', () => {
    const out = run([
      { type: 'delta', text: '我在想<act:fidget ' },
      { type: 'delta', text: 'dur=1500/>好' },
      { type: 'done', finishReason: 'stop' },
    ]);
    expect(out).toEqual([
      { channel: 'chat.stream', params: { sessionId: 's1', text: '我在想' } },
      { channel: 'behavior.playAction', params: { name: 'fidget', durationMs: 1500 } },
      { channel: 'chat.stream', params: { sessionId: 's1', text: '好' } },
      { channel: 'chat.done', params: { sessionId: 's1', finishReason: 'stop' } },
    ]);
  });

  it('emits intent header on the behavior track', () => {
    const out = run([
      { type: 'delta', text: '[intent mood=shy energy=low]hello' },
      { type: 'done', finishReason: 'stop' },
    ]);
    expect(out).toEqual([
      { channel: 'behavior.setIntent', params: { mood: 'shy', energy: 'low' } },
      { channel: 'chat.stream', params: { sessionId: 's1', text: 'hello' } },
      { channel: 'chat.done', params: { sessionId: 's1', finishReason: 'stop' } },
    ]);
  });

  it('flushes a buffered half-tag as text on done', () => {
    const out = run([
      { type: 'delta', text: 'bye <emo:' },
      { type: 'done', finishReason: 'cancel' },
    ]);
    expect(out).toEqual([
      { channel: 'chat.stream', params: { sessionId: 's1', text: 'bye ' } },
      { channel: 'chat.stream', params: { sessionId: 's1', text: '<emo:' } },
      { channel: 'chat.done', params: { sessionId: 's1', finishReason: 'cancel' } },
    ]);
  });

  it('keeps per-session parser buffers independent', () => {
    const out: Notification[] = [];
    const core = new ConversationCore((n) => out.push(n));
    // interleave a half-tag in s1 with a complete tag in s2
    core.handleEvent('s1', { type: 'delta', text: 'a<emo:' });
    core.handleEvent('s2', { type: 'delta', text: 'b<emo:sad/>c' });
    core.handleEvent('s1', { type: 'delta', text: 'happy/>d' });
    expect(out).toEqual([
      { channel: 'chat.stream', params: { sessionId: 's1', text: 'a' } },
      { channel: 'chat.stream', params: { sessionId: 's2', text: 'b' } },
      { channel: 'behavior.applyEmotion', params: { name: 'sad', weight: 1.0 } },
      { channel: 'chat.stream', params: { sessionId: 's2', text: 'c' } },
      { channel: 'behavior.applyEmotion', params: { name: 'happy', weight: 1.0 } },
      { channel: 'chat.stream', params: { sessionId: 's1', text: 'd' } },
    ]);
  });
});
