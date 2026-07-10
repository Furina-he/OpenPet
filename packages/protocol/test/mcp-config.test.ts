import { describe, it, expect } from 'vitest';
import {
  McpServerSchema,
  toolKey,
  validateMcpServer,
  type McpServer,
} from '../src/mcp-config.js';

const srv = (o: Partial<McpServer> & { id: string; name: string }): McpServer =>
  McpServerSchema.parse(o);

describe('McpServerSchema', () => {
  it('默认 transport=stdio、active=true、空 command/args/env', () => {
    const s = McpServerSchema.parse({ id: 'a', name: 'A' });
    expect(s).toMatchObject({ transport: 'stdio', active: true, command: '', args: [], env: {} });
  });
});

describe('toolKey', () => {
  it('serverId/toolName', () => {
    expect(toolKey('s1', 'web_search')).toBe('s1/web_search');
  });
});

describe('validateMcpServer', () => {
  it('stdio 缺 command 抛', () => {
    expect(() => validateMcpServer(srv({ id: 'a', name: 'A', transport: 'stdio' }))).toThrow();
  });
  it('stdio 有 command 通过', () => {
    expect(() =>
      validateMcpServer(srv({ id: 'a', name: 'A', transport: 'stdio', command: 'npx' })),
    ).not.toThrow();
  });
  it('sse/http 缺 url 抛、有 url 通过', () => {
    expect(() => validateMcpServer(srv({ id: 'a', name: 'A', transport: 'sse' }))).toThrow();
    expect(() =>
      validateMcpServer(srv({ id: 'a', name: 'A', transport: 'http', url: 'http://x/mcp' })),
    ).not.toThrow();
  });
});
