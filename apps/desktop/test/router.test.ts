import { describe, it, expect } from 'vitest';
import { createRouter, RpcError } from '../electron/main/router';

interface Ctx {
  tag: string;
}

const router = createRouter<Ctx>({
  'sys.ping': (p, ctx) => ({ pong: ctx.tag, echoNonce: p.nonce }),
  'chat.send': (p) => ({ ok: true as const, got: p.sessionId }),
});

describe('createRouter', () => {
  it('dispatches with validated params and ctx', async () => {
    const r = await router.dispatch('sys.ping', { nonce: 'n1' }, { tag: 'ok' });
    expect(r).toEqual({ pong: 'ok', echoNonce: 'n1' });
  });

  it('throws -32601 for an unknown method', async () => {
    await expect(router.dispatch('nope.nope', {}, { tag: 'x' })).rejects.toMatchObject({
      code: -32601,
    });
  });

  it('throws -32601 for a known method with no registered handler', async () => {
    await expect(
      router.dispatch('chat.cancel', { sessionId: 's' }, { tag: 'x' }),
    ).rejects.toMatchObject({ code: -32601 });
  });

  it('throws -32602 when params violate the zod schema', async () => {
    await expect(router.dispatch('sys.ping', { nonce: 42 }, { tag: 'x' })).rejects.toMatchObject({
      code: -32602,
    });
    await expect(
      router.dispatch('chat.send', { sessionId: 's' }, { tag: 'x' }),
    ).rejects.toMatchObject({ code: -32602 });
  });

  it('exposes RpcError with code + message', () => {
    const e = new RpcError(-32601, 'Method not found: x');
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe(-32601);
  });
});
