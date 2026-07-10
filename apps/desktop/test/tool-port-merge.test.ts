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
