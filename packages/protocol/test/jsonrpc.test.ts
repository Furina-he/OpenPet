import { describe, it, expect } from 'vitest';
import { parseRequest } from '../src/jsonrpc';

describe('JSON-RPC parser', () => {
  it('parses valid request', () => {
    const r = parseRequest('{"jsonrpc":"2.0","id":1,"method":"chat.send","params":{}}');
    expect(r.method).toBe('chat.send');
    expect(r.id).toBe(1);
  });

  it('rejects invalid jsonrpc version', () => {
    expect(() => parseRequest('{"jsonrpc":"1.0","id":1,"method":"x"}')).toThrow();
  });

  it('rejects malformed json', () => {
    expect(() => parseRequest('not json')).toThrow();
  });
});
