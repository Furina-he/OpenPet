import { describe, it, expect } from 'vitest';
import { handleRequest } from '../src/server';

describe('sidecar server', () => {
  it('responds to sys.ping', async () => {
    const out = await handleRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'sys.ping',
      params: { nonce: 'abc' },
    });
    expect(out).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: { pong: 'ok', echoNonce: 'abc' },
    });
  });

  it('returns -32601 for unknown method', async () => {
    const out = await handleRequest({ jsonrpc: '2.0', id: 2, method: 'nope' });
    expect((out as { error: { code: number } }).error.code).toBe(-32601);
  });
});
