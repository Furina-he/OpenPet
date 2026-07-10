/**
 * MCP transport 工厂（§4）——唯一 import @modelcontextprotocol/sdk 的文件。
 * 注入给 McpManager 的 connectFactory；stdio spawn 子进程（command/args/env），
 * sse/http 连远端。SDK 子路径走 v1.x（dist/esm/* 经 exports `./*` 通配解析）。
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { McpServer } from '@openpet/protocol';
import type { McpClientLike } from './mcp-manager.js';

export async function connectMcpServer(server: McpServer): Promise<{ client: McpClientLike }> {
  const client = new Client({ name: 'openpet', version: '0.1.0' });
  let transport: Transport;
  if (server.transport === 'stdio') {
    transport = new StdioClientTransport({
      command: server.command,
      args: server.args,
      env: { ...(process.env as Record<string, string>), ...server.env },
      stderr: 'pipe',
    });
  } else if (server.transport === 'http') {
    transport = new StreamableHTTPClientTransport(new URL(server.url), {
      requestInit: { headers: server.headers },
    });
  } else {
    transport = new SSEClientTransport(new URL(server.url), {
      requestInit: { headers: server.headers },
    });
  }
  await client.connect(transport);
  return { client: client as unknown as McpClientLike };
}
