import { z } from 'zod';
import type { JsonRpcRequest, JsonRpcResponse } from './jsonrpc.js';

/**
 * Worker MessagePort 帧协议 — Main ⇄ Provider Worker 的单一真源。
 *
 * 与 methods.ts（Renderer ⇄ Main 的 JSON-RPC method 表）相区分：这里是流式
 * provider 的内部帧（一次 chat.start 对应 N 个 chat.event），不是 request/response。
 *
 * `done.finishReason` 三态：worker 只产生 'stop' | 'cancel'；'error' 由 Main 侧
 * ProviderHost 在 worker 死亡 / 被强杀连带时合成，worker 自身永不发送。
 */
export const ERROR_KINDS = ['auth', 'rate_limit', 'timeout', 'network', 'server', 'unknown'] as const;
export const ErrorKindSchema = z.enum(ERROR_KINDS);
export type ErrorKind = z.infer<typeof ErrorKindSchema>;

export const ChatEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('delta'), text: z.string() }),
  z.object({ type: z.literal('tool_call'), id: z.string(), name: z.string(), args: z.unknown() }),
  z.object({
    type: z.literal('usage'),
    prompt: z.number().int().nonnegative(),
    completion: z.number().int().nonnegative(),
    cost: z.number().optional(),
  }),
  z.object({
    type: z.literal('done'),
    finishReason: z.enum(['stop', 'cancel', 'error']),
    // error/errorKind 仅在 finishReason==='error' 时有意义（J3 分级）；provider 与
    // ProviderHost 合成 error done 时填充，stop/cancel 不带。
    error: z.string().optional(),
    errorKind: ErrorKindSchema.optional(),
  }),
]);
export type ChatEvent = z.infer<typeof ChatEventSchema>;

export const ChatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.string(),
});
export const ChatToolSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  parameters: z.unknown().optional(),
});
export const ChatRequestSchema = z.object({
  messages: z.array(ChatMessageSchema),
  model: z.string().optional(),
  params: z
    .object({
      temperature: z.number().optional(),
      maxTokens: z.number().int().positive().optional(),
    })
    .optional(),
  tools: z.array(ChatToolSchema).optional(),
});
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

/** Main → Worker：开始一次流式补全。providerId/request 缺省则走 mock（intervalMs）。 */
export const ChatStartFrame = z.object({
  kind: z.literal('chat.start'),
  requestId: z.string(),
  sessionId: z.string(),
  providerId: z.string().optional(),
  request: ChatRequestSchema.optional(),
  /** provider base URL override（D3 自定义中转站）；Main 从 prefs 注入，Worker 不持久化。 */
  baseUrl: z.string().optional(),
  /** mock provider 的出块间隔（测试用 0/小值）。 */
  intervalMs: z.number().int().nonnegative().optional(),
});
export type ChatStartFrame = z.infer<typeof ChatStartFrame>;

/** Main → Worker：协作取消（不保证 worker 响应；watchdog 兜底在 Main 侧）。 */
export const ChatCancelFrame = z.object({
  kind: z.literal('chat.cancel'),
  requestId: z.string(),
});
export type ChatCancelFrame = z.infer<typeof ChatCancelFrame>;

/** Worker → Main：流事件信封。 */
export const ChatEventFrame = z.object({
  kind: z.literal('chat.event'),
  requestId: z.string(),
  sessionId: z.string(),
  event: ChatEventSchema,
});
export type ChatEventFrame = z.infer<typeof ChatEventFrame>;

/**
 * Worker → Main：插件请求（JSON-RPC 信封）。id 必须是数字才能与响应关联——
 * 这条通道上没有 notification 语义，全部是 request/response。
 */
export const PluginRequestFrame = z.object({
  kind: z.literal('plugin.request'),
  rpc: z.object({
    jsonrpc: z.literal('2.0'),
    id: z.number(),
    method: z.string(),
    params: z.unknown().optional(),
  }),
});
export type PluginRequestFrame = z.infer<typeof PluginRequestFrame>;

/** Main → Worker：插件响应（result 与 error 互斥，沿用 JSON-RPC 形状）。 */
export const PluginResponseFrame = z.object({
  kind: z.literal('plugin.response'),
  rpc: z.object({
    jsonrpc: z.literal('2.0'),
    id: z.number(),
    result: z.unknown().optional(),
    error: z.object({ code: z.number(), message: z.string() }).optional(),
  }),
});
export type PluginResponseFrame = z.infer<typeof PluginResponseFrame>;

/** Worker → Main：代理 fetch 请求（body 仅支持 string；二进制 V1+）。 */
export const PluginFetchRequestFrame = z.object({
  kind: z.literal('plugin.fetchRequest'),
  id: z.string(),
  url: z.string(),
  init: z.object({
    method: z.string(),
    headers: z.record(z.string()).optional(),
    body: z.string().optional(),
  }),
});
export type PluginFetchRequestFrame = z.infer<typeof PluginFetchRequestFrame>;

/** Main → Worker：流式响应分块。head 先到（状态/头），data 多次，end/error 收尾。 */
export const PluginFetchChunkFrame = z.object({
  kind: z.literal('plugin.fetchChunk'),
  id: z.string(),
  phase: z.enum(['head', 'data', 'end', 'error']),
  status: z.number().optional(),
  headers: z.record(z.string()).optional(),
  chunk: z.string().optional(),
  error: z.string().optional(),
});
export type PluginFetchChunkFrame = z.infer<typeof PluginFetchChunkFrame>;

export const ProviderInboundFrame = z.discriminatedUnion('kind', [
  ChatStartFrame,
  ChatCancelFrame,
  PluginResponseFrame,
  PluginFetchChunkFrame,
]);
export type ProviderInboundFrame = z.infer<typeof ProviderInboundFrame>;

export const ProviderOutboundFrame = z.discriminatedUnion('kind', [
  ChatEventFrame,
  PluginRequestFrame,
  PluginFetchRequestFrame,
]);
export type ProviderOutboundFrame = z.infer<typeof ProviderOutboundFrame>;
