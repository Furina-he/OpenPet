import { describe, it, expect } from 'vitest';
import type { ChatTool } from '@openpet/protocol';
import { mergeToolPorts } from '../electron/main/plugins/tool-port-merge';

const mcpPort = {
  activeToolDefs: (_sa: (id: string) => boolean): ChatTool[] => [
    { name: 'mcp/weather', description: 'w' },
  ],
  callTool: (name: string, _args: unknown) => Promise.resolve(`mcp:${name}`),
};

const pluginSource = {
  activeToolDefs: (): ChatTool[] => [{ name: 'p_demo_echo', description: 'e' }],
  ownsTool: (name: string) => name.startsWith('p_demo_'),
  callTool: (name: string, _args: unknown) => Promise.resolve(`plugin:${name}`),
};

describe('mergeToolPorts', () => {
  it('defs 双方拼接（mcp 在前）', () => {
    const port = mergeToolPorts(mcpPort, pluginSource);
    expect(port.activeToolDefs(() => true).map((t) => t.name)).toEqual([
      'mcp/weather',
      'p_demo_echo',
    ]);
  });

  it('插件名命中走插件、其余走 mcp', async () => {
    const port = mergeToolPorts(mcpPort, pluginSource);
    await expect(port.callTool('p_demo_echo', {})).resolves.toBe('plugin:p_demo_echo');
    await expect(port.callTool('mcp/weather', {})).resolves.toBe('mcp:mcp/weather');
  });

  it('无 mcp 时插件仍可用，未知名 reject', async () => {
    const port = mergeToolPorts(undefined, pluginSource);
    expect(port.activeToolDefs(() => true).map((t) => t.name)).toEqual(['p_demo_echo']);
    await expect(port.callTool('p_demo_echo', {})).resolves.toBe('plugin:p_demo_echo');
    await expect(port.callTool('ghost', {})).rejects.toThrow('unknown tool ghost');
  });
});

describe('㉔ mergeToolPorts 多源 + 上下文', () => {
  it('多个自有源按 ownsTool 路由；上下文原样透传到定义与执行', async () => {
    const seen: unknown[] = [];
    const mem = {
      activeToolDefs: (ctx?: { sessionId: string; userText?: string }): ChatTool[] => {
        seen.push(['defs', ctx]);
        return [{ name: 'remember', description: 'r' }];
      },
      ownsTool: (name: string) => name === 'remember',
      callTool: (name: string, _args: unknown, ctx?: { sessionId: string }) => {
        seen.push(['call', ctx]);
        return Promise.resolve(`mem:${name}`);
      },
    };
    const port = mergeToolPorts(mcpPort, pluginSource, mem);
    const ctx = { sessionId: 's1', userText: '记住' };
    expect(port.activeToolDefs(() => true, ctx).map((t) => t.name)).toEqual([
      'mcp/weather',
      'p_demo_echo',
      'remember',
    ]);
    await expect(port.callTool('remember', {}, { sessionId: 's1' })).resolves.toBe('mem:remember');
    await expect(port.callTool('p_demo_echo', {})).resolves.toBe('plugin:p_demo_echo');
    await expect(port.callTool('mcp/weather', {})).resolves.toBe('mcp:mcp/weather');
    expect(seen).toEqual([
      ['defs', ctx],
      ['call', { sessionId: 's1' }],
    ]);
  });

  it('MCP 工具与自有工具同名：丢弃 MCP 定义（请求里不出现重名函数），调用走自有源', async () => {
    const clash = {
      activeToolDefs: (): ChatTool[] => [
        { name: 'remember', description: 'mcp 同名' },
        { name: 'mcp/weather', description: 'w' },
      ],
      callTool: (name: string) => Promise.resolve(`mcp:${name}`),
    };
    const mem = {
      activeToolDefs: (): ChatTool[] => [], // 本轮没挂（无记忆意图）也照样占名
      ownsTool: (name: string) => name === 'remember',
      callTool: (name: string) => Promise.resolve(`mem:${name}`),
    };
    const port = mergeToolPorts(clash, mem);
    expect(port.activeToolDefs(() => true).map((t) => t.name)).toEqual(['mcp/weather']);
    await expect(port.callTool('remember', {})).resolves.toBe('mem:remember');
  });
});
