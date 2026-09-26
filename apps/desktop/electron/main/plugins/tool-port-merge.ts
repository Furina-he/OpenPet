// Desktop 插件工具并入 ChatService.mcp 口（线 B-2 T3）：
// 插件工具（wire 名 p_<id>_<tool>）命中走插件 host，其余透传 MCP；defs 双方拼接。
// ㉔ 泛化为「MCP + 若干自有工具源」（插件、记忆工具各一个源，ownsTool 命中即路由）；工具口上下文
// 原样透传。自有工具同名优先：MCP 工具名是服务器原样给的（理论上可能就叫 remember），与自有工具源
// 同名时丢弃 MCP 那条定义，请求里不出现重名函数。
import type { ChatTool } from '@openpet/protocol';
import type { McpToolPort, ToolContext } from '../chat-service.js';

export interface OwnedToolSource {
  activeToolDefs(ctx?: ToolContext): ChatTool[];
  ownsTool(name: string): boolean;
  callTool(name: string, args: unknown, ctx?: ToolContext): Promise<string>;
}

export function mergeToolPorts(
  mcp: McpToolPort | undefined,
  ...sources: OwnedToolSource[]
): McpToolPort {
  const owner = (name: string): OwnedToolSource | undefined =>
    sources.find((s) => s.ownsTool(name));
  return {
    activeToolDefs: (serverActive, ctx) => [
      ...(mcp?.activeToolDefs(serverActive, ctx) ?? []).filter((t) => !owner(t.name)),
      ...sources.flatMap((s) => s.activeToolDefs(ctx)),
    ],
    callTool: (name, args, ctx) => {
      const src = owner(name);
      if (src) return src.callTool(name, args, ctx);
      return mcp
        ? mcp.callTool(name, args, ctx)
        : Promise.reject(new Error(`unknown tool ${name}`));
    },
  };
}
