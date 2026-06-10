import { describe, it, expect } from 'vitest';
import { Methods } from '../src/methods';

describe('method registry', () => {
  it('defines sys.ping params and result schemas', () => {
    const spec = Methods['sys.ping'];
    expect(spec.params.parse({ nonce: 'abc' })).toEqual({ nonce: 'abc' });
    expect(spec.result.parse({ pong: 'ok', echoNonce: 'abc' })).toEqual({
      pong: 'ok',
      echoNonce: 'abc',
    });
  });

  it('rejects sys.ping params missing nonce', () => {
    expect(() => Methods['sys.ping'].params.parse({})).toThrow();
  });

  it('defines chat.send params and result schemas', () => {
    const spec = Methods['chat.send'];
    expect(spec.params.parse({ sessionId: 's1', text: 'hi' })).toEqual({
      sessionId: 's1',
      text: 'hi',
    });
    expect(spec.result.parse({ ok: true })).toEqual({ ok: true });
  });

  it('rejects chat.send result with ok=false', () => {
    expect(() => Methods['chat.send'].result.parse({ ok: false })).toThrow();
  });

  it('defines chat.stream notification params', () => {
    expect(Methods['chat.stream'].params.parse({ sessionId: 's1', text: '嗯…' })).toEqual({
      sessionId: 's1',
      text: '嗯…',
    });
  });

  it('constrains chat.done finishReason to the allowed set', () => {
    expect(Methods['chat.done'].params.parse({ sessionId: 's1', finishReason: 'cancel' })).toEqual({
      sessionId: 's1',
      finishReason: 'cancel',
    });
    expect(() =>
      Methods['chat.done'].params.parse({ sessionId: 's1', finishReason: 'boom' }),
    ).toThrow();
  });

  it('defines behavior.applyEmotion params', () => {
    expect(Methods['behavior.applyEmotion'].params.parse({ name: 'shy', weight: 1 })).toEqual({
      name: 'shy',
      weight: 1,
    });
  });

  it('allows null durationMs on behavior.playAction', () => {
    expect(Methods['behavior.playAction'].params.parse({ name: 'wave', durationMs: null })).toEqual(
      { name: 'wave', durationMs: null },
    );
    expect(
      Methods['behavior.playAction'].params.parse({ name: 'fidget', durationMs: 1800 }),
    ).toEqual({ name: 'fidget', durationMs: 1800 });
  });
});
