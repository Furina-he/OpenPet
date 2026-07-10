// Desktop 插件工具并入 ChatService.mcp 口（线 B-2 T3）：
// 插件工具（wire 名 p_<id>_<tool>）命中走插件 host，其余透传 MCP；defs 双方拼接。
import type { ChatTool } from '@openpet/protocol';

interface ToolPort {
  activeToolDefs: (serverActive: (id: string) => boolean) => ChatTool[];
  callTool: (name: string, args: unknown) => Promise<string>;
}

interface PluginToolSource {
  activeToolDefs(): ChatTool[];
  ownsTool(name: string): boolean;
  callTool(name: string, args: unknown): Promise<string>;
}

export function mergeToolPorts(mcp: ToolPort | undefined, plugins: PluginToolSource): ToolPort {
  return {
    activeToolDefs: (serverActive) => [
      ...(mcp?.activeToolDefs(serverActive) ?? []),
      ...plugins.activeToolDefs(),
    ],
    callTool: (name, args) =>
      plugins.ownsTool(name)
        ? plugins.callTool(name, args)
        : mcp
          ? mcp.callTool(name, args)
          : Promise.reject(new Error(`unknown tool ${name}`)),
  };
}
