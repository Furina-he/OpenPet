import { z } from 'zod';

/**
 * Method registry — single source of truth for IPC contracts.
 *
 * Request/response methods (Renderer → Main) carry a meaningful `result`.
 * Notification methods (Main → Renderer, fire-and-forget over
 * `webContents.send`) never expect a reply, so their `result` is `z.null()`
 * and only `params` matters. Keeping a uniform `{ params, result }` shape lets
 * every method be looked up the same way regardless of direction.
 */
export const Methods = {
  // --- request/response: Renderer → Main ---
  'sys.ping': {
    params: z.object({ nonce: z.string() }),
    result: z.object({ pong: z.string(), echoNonce: z.string() }),
  },
  'chat.send': {
    params: z.object({ sessionId: z.string(), text: z.string() }),
    result: z.object({ ok: z.literal(true) }),
  },
  'chat.cancel': {
    params: z.object({ sessionId: z.string() }),
    result: z.object({ ok: z.literal(true) }),
  },
  'chat.snapshot': {
    // 崩溃恢复：UI 启动/重载时拉最近 N 条重建视图（tech-design §3 / impl-plan M2）。
    // seq = 该 session 已发出的最后一个 chat.stream 序号；渲染端以 seq 去重缓冲事件。
    params: z.object({
      sessionId: z.string(),
      limit: z.number().int().positive().max(200).optional(),
    }),
    result: z.object({
      sessionId: z.string(),
      messages: z.array(
        z.object({
          role: z.enum(['user', 'assistant']),
          text: z.string(),
          finishReason: z.enum(['stop', 'cancel', 'error']).nullable(),
        }),
      ),
      streaming: z.boolean(),
      seq: z.number().int().nonnegative(),
    }),
  },

  // --- request/response: Renderer → Main（窗口自操作；Main 端以 sender 定位窗口）---
  'app.window.setClickThrough': {
    params: z.object({ ignore: z.boolean() }),
    result: z.object({ ok: z.literal(true) }),
  },
  'app.window.moveBy': {
    params: z.object({ dx: z.number(), dy: z.number() }),
    result: z.object({ ok: z.literal(true) }),
  },

  // --- notification: Main → UI Overlay Renderer ---
  'chat.stream': {
    params: z.object({
      sessionId: z.string(),
      text: z.string(),
      // 每 session 单调递增；快照重建时渲染端丢弃 seq <= snapshot.seq 的事件。
      // 背压队列合并相邻 deltas 时取后者的 seq（文本已拼接，语义等价）。
      seq: z.number().int().nonnegative(),
    }),
    result: z.null(),
  },
  'chat.done': {
    params: z.object({
      sessionId: z.string(),
      finishReason: z.enum(['stop', 'cancel', 'error']),
    }),
    result: z.null(),
  },

  // --- notification: Main → Character Renderer ---
  'behavior.applyEmotion': {
    params: z.object({ name: z.string(), weight: z.number() }),
    result: z.null(),
  },
  'behavior.playAction': {
    params: z.object({ name: z.string(), durationMs: z.number().nullable() }),
    result: z.null(),
  },
  'behavior.setIntent': {
    params: z.object({ mood: z.string(), energy: z.string() }),
    result: z.null(),
  },

  // --- request/response: Worker → Main（经 MessagePort 的 plugin.request 帧；
  //     身份来自通道（哪个 worker 的 port），不自报 pluginId —— M5 多 worker 时
  //     由 PluginHost 按 port 挂身份）---
  'plugin.registerSkill': {
    params: z.object({ skillId: z.string().min(1), title: z.string() }),
    result: z.object({ ok: z.literal(true) }),
  },
  'plugin.permissionRequest': {
    // M2 策略：默认全拒（granted:false）；M7 设置 UI 接确认弹窗。
    params: z.object({ permission: z.string().min(1), reason: z.string().optional() }),
    result: z.object({ granted: z.boolean() }),
  },
  'plugin.invokeTool': {
    params: z.object({ toolId: z.string().min(1), args: z.unknown().optional() }),
    result: z.object({ value: z.unknown() }),
  },
} as const;

export type MethodName = keyof typeof Methods;
