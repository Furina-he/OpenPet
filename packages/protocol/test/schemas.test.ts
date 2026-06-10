import { describe, it, expect } from 'vitest';
import {
  ChatEventSchema,
  ChatStartFrame,
  ChatCancelFrame,
  ChatEventFrame,
  ProviderInboundFrame,
} from '../src/schemas';

describe('worker frame schemas', () => {
  it('parses a delta chat event', () => {
    const e = ChatEventSchema.parse({ type: 'delta', text: '嗯…' });
    expect(e).toEqual({ type: 'delta', text: '嗯…' });
  });

  it('parses done with all three finish reasons', () => {
    for (const finishReason of ['stop', 'cancel', 'error'] as const) {
      expect(ChatEventSchema.parse({ type: 'done', finishReason })).toEqual({
        type: 'done',
        finishReason,
      });
    }
  });

  it('rejects an unknown finishReason', () => {
    expect(() => ChatEventSchema.parse({ type: 'done', finishReason: 'oops' })).toThrow();
  });

  it('parses chat.start with optional intervalMs', () => {
    expect(ChatStartFrame.parse({ kind: 'chat.start', requestId: 'r1', sessionId: 's1' })).toEqual({
      kind: 'chat.start',
      requestId: 'r1',
      sessionId: 's1',
    });
    expect(
      ChatStartFrame.parse({ kind: 'chat.start', requestId: 'r1', sessionId: 's1', intervalMs: 0 }),
    ).toMatchObject({ intervalMs: 0 });
  });

  it('parses chat.cancel', () => {
    expect(ChatCancelFrame.parse({ kind: 'chat.cancel', requestId: 'r1' })).toEqual({
      kind: 'chat.cancel',
      requestId: 'r1',
    });
  });

  it('parses chat.event envelope', () => {
    const frame = ChatEventFrame.parse({
      kind: 'chat.event',
      requestId: 'r1',
      sessionId: 's1',
      event: { type: 'delta', text: 'x' },
    });
    expect(frame.event).toEqual({ type: 'delta', text: 'x' });
  });

  it('discriminates inbound frames by kind', () => {
    expect(ProviderInboundFrame.parse({ kind: 'chat.cancel', requestId: 'r9' })).toMatchObject({
      kind: 'chat.cancel',
    });
    expect(() => ProviderInboundFrame.parse({ kind: 'nope' })).toThrow();
  });
});
