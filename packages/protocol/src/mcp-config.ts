import { z } from 'zod';

export const McpTransportSchema = z.enum(['stdio', 'sse', 'http']);
export type McpTransport = z.infer<typeof McpTransportSchema>;

export const McpServerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  transport: McpTransportSchema.default('stdio'),
  command: z.string().default(''),
  args: z.array(z.string()).default([]),
  env: z.record(z.string()).default({}),
  url: z.string().default(''),
  headers: z.record(z.string()).default({}),
  active: z.boolean().default(true),
  note: z.string().default(''),
});
export type McpServer = z.infer<typeof McpServerSchema>;

/** 运行时发现的工具（不入 prefs，getConfig 合并返回）。 */
export const McpToolSchema = z.object({
  serverId: z.string(),
  name: z.string(),
  description: z.string().default(''),
  parameters: z.unknown(),
  active: z.boolean(),
});
export type McpTool = z.infer<typeof McpToolSchema>;

export const McpServerStatusSchema = z.object({
  connected: z.boolean(),
  errlogs: z.array(z.string()),
  /** #6 断线重连中（第 N 次尝试）；无此字段 = 非重连态。 */
  reconnectAttempts: z.number().int().positive().optional(),
});
export type McpServerStatus = z.infer<typeof McpServerStatusSchema>;

export function toolKey(serverId: string, toolName: string): string {
  return `${serverId}/${toolName}`;
}

export function validateMcpServer(s: McpServer): void {
  if (s.transport === 'stdio') {
    if (!s.command.trim()) throw new Error('stdio transport requires a command');
  } else {
    if (!s.url.trim()) throw new Error(`${s.transport} transport requires a url`);
  }
}
