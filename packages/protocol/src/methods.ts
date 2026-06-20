import { z } from 'zod';
import { CharacterManifestSchema } from './character-manifest.js';
import { ErrorKindSchema } from './schemas.js';
import { PrefsSchema } from './prefs.js';

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
    params: z.object({ sessionId: z.string(), text: z.string(), providerId: z.string().optional() }),
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
  'app.window.openHub': {
    // 打开/聚焦 Hub（settings 窗口）。最小入口；完整入口集（托盘/热键录制器）在 M8。
    params: z.object({}),
    result: z.object({ ok: z.literal(true) }),
  },
  'app.window.showChat': {
    // 显示+聚焦聊天浮层（A1 双击 / 托盘"聊天" / 热键）。
    params: z.object({}),
    result: z.object({ ok: z.literal(true) }),
  },
  'app.window.popCharacterMenu': {
    // 角色右键 → Main 弹原生桌面菜单（动作类，§14.2）。
    params: z.object({}),
    result: z.object({ ok: z.literal(true) }),
  },
  'app.window.toggleClickThrough': {
    // A3 穿透切换：翻转 display.clickThrough pref 真源并施加，返回新态（菜单/热键/托盘复用）。
    params: z.object({}),
    result: z.object({ ok: z.literal(true), ignore: z.boolean() }),
  },
  'app.window.finishOnboarding': {
    // 首启引导完成/跳过完成：置 onboarding.completed + 收起引导窗 + 唤起 overlay。
    params: z.object({}),
    result: z.object({ ok: z.literal(true) }),
  },

  // --- request/response: Renderer → Main（数据管理，M6；D7 UI 在 M7 接）---
  'app.storageUsage': {
    params: z.object({}),
    result: z.object({
      dbBytes: z.number().int().nonnegative(),
      messageCount: z.number().int().nonnegative(),
      characterCount: z.number().int().nonnegative(),
    }),
  },
  'app.exportData': {
    // outPath 由 Renderer 经系统保存对话框拿到（M7 接 dialog）；M6 直接收路径。
    params: z.object({ outPath: z.string().min(1) }),
    result: z.object({ ok: z.literal(true), bytes: z.number().int().nonnegative() }),
  },
  'app.openExternal': {
    params: z.object({ url: z.string().url() }),
    result: z.object({ ok: z.literal(true) }),
  },

  // --- request/response: Renderer → Main（应用偏好，M7a；UI 在 D 系列）---
  'app.prefs.getAll': {
    params: z.object({}),
    result: PrefsSchema,
  },
  'app.prefs.set': {
    // value 必填且为标量（string|number|boolean，覆盖所有 pref 值类型）；
    // 注：不能用 z.unknown()——它在对象里自动可选，会让缺 value 也通过校验。
    // 按 key 对应字段的深校验在 prefs-service 做（命中非法 → -32602）。
    params: z.object({
      key: z.string().min(1),
      value: z.union([z.string(), z.number(), z.boolean()]),
    }),
    result: z.object({ ok: z.literal(true) }),
  },
  // --- notification: Main → 所有 renderer（某 pref 变更，驱动即时生效）---
  'app.prefs.changed': {
    params: z.object({
      key: z.string().min(1),
      value: z.union([z.string(), z.number(), z.boolean()]),
    }),
    result: z.null(),
  },
  // --- notification: Main → character（A4 全屏检测态，best-effort）---
  'app.desktopState': {
    params: z.object({ fullscreen: z.boolean() }),
    result: z.null(),
  },

  // --- request/response: Renderer → Main（角色包 / 窗口缩放 / 主动行为，M4）---
  'character.current': {
    // 当前角色包（Main 校验过的 manifest）；渲染端用 asset://<characterId>/<model> 取模型。
    params: z.object({}),
    result: z.object({ characterId: z.string(), manifest: CharacterManifestSchema }),
  },
  'character.tap': {
    // A1 角色轻点：head→撒娇 / body→普通互动。Main 收到后广播 behavior（保持哑播放器）。
    params: z.object({ zone: z.enum(['head', 'body']) }),
    result: z.object({ ok: z.literal(true) }),
  },
  'character.setScale': {
    // D4 角色缩放 50%–200%；Main 按底边中点锚定改 character 窗口 bounds。
    params: z.object({ scale: z.number().min(0.5).max(2) }),
    result: z.object({ ok: z.literal(true) }),
  },
  'character.idleTimeout': {
    // 渲染端 90s 空闲上报（tech-design §7「主动行为」）；Main 决策（M4 为动作 stub）。
    params: z.object({ idleMs: z.number().int().positive() }),
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
      error: z.string().optional(),
      errorKind: ErrorKindSchema.optional(),
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
  'behavior.lookAt': {
    // Main 30Hz 光标轮询直发 character 窗口（不过 chat 背压队列）；屏幕坐标（DIP）。
    params: z.object({ x: z.number(), y: z.number() }),
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

  // --- request/response: Renderer → Main（provider 配置，M5；UI 在 M7 接 D3）---
  'provider.saveKey': {
    params: z.object({ providerId: z.string().min(1), key: z.string().min(1) }),
    result: z.object({ ok: z.literal(true) }),
  },
  'provider.deleteKey': {
    params: z.object({ providerId: z.string().min(1) }),
    result: z.object({ ok: z.literal(true) }),
  },
  'provider.listProviders': {
    params: z.object({}),
    result: z.object({
      providers: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          kind: z.enum(['chat', 'embedding']),
          hasKey: z.boolean(),
          enabled: z.boolean(),
          models: z.array(z.string()),
        }),
      ),
    }),
  },
  'provider.testConnection': {
    params: z.object({ providerId: z.string().min(1) }),
    result: z.object({
      ok: z.boolean(),
      errorKind: ErrorKindSchema.optional(),
      detail: z.string().optional(),
    }),
  },
  'provider.listModels': {
    params: z.object({ providerId: z.string().min(1) }),
    result: z.object({ models: z.array(z.string()) }),
  },
  'provider.ollamaDetect': {
    params: z.object({}),
    result: z.object({ available: z.boolean(), models: z.array(z.string()) }),
  },
} as const;

export type MethodName = keyof typeof Methods;
