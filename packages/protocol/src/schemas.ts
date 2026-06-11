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
export const ChatEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('delta'), text: z.string() }),
  z.object({ type: z.literal('done'), finishReason: z.enum(['stop', 'cancel', 'error']) }),
]);
export type ChatEvent = z.infer<typeof ChatEventSchema>;

/** Main → Worker：开始一次流式补全。 */
export const ChatStartFrame = z.object({
  kind: z.literal('chat.start'),
  requestId: z.string(),
  sessionId: z.string(),
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

export const ProviderInboundFrame = z.discriminatedUnion('kind', [
  ChatStartFrame,
  ChatCancelFrame,
  PluginResponseFrame,
]);
export type ProviderInboundFrame = z.infer<typeof ProviderInboundFrame>;

export const ProviderOutboundFrame = z.discriminatedUnion('kind', [
  ChatEventFrame,
  PluginRequestFrame,
]);
export type ProviderOutboundFrame = z.infer<typeof ProviderOutboundFrame>;
