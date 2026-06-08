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
});
