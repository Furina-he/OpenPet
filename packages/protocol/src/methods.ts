import { z } from 'zod';
import { CharacterManifestSchema } from './character-manifest.js';
import { ErrorKindSchema } from './schemas.js';
import { PrefsSchema } from './prefs.js';
import {
  ProviderSourceSchema,
  ModelEntrySchema,
  ModelCapsSchema,
  AdapterTemplateSchema,
  CapabilitySchema,
} from './provider-config.js';
import { ProviderTemplateSchema } from './provider-templates.js';
import { McpServerSchema, McpToolSchema, McpServerStatusSchema } from './mcp-config.js';
import { ImPlatformSchema, ImStatusSchema } from './im-config.js';
import {
  DesktopPluginManifestSchema,
  StarPluginMetaSchema,
  PluginRuntimeStatusSchema,
} from './plugin-config.js';
import { KbSchema, KbDocSchema, KbHitSchema } from './kb-config.js';
import { MemoryFactSchema } from './memory-config.js';
import { PersonaSchema } from './persona-config.js';
import { TraceRecordSchema } from './trace-config.js';
import { VoiceProfileSchema } from './voice-config.js';
import { UpdateStatusSchema } from './update-config.js';

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
    params: z.object({
      sessionId: z.string(),
      text: z.string(),
      providerId: z.string().optional(),
    }),
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
  // --- 会话管理（spec 2026-07-09-session-management）---
  'chat.sessions': {
    // 当前角色会话列表（B3）；pinned 优先再 lastTs 降序；origin 由 id 前缀 'im:' 判定。
    params: z.object({}),
    result: z.object({
      sessions: z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          pinned: z.boolean(),
          lastText: z.string(),
          lastTs: z.number(),
          count: z.number().int().nonnegative(),
          origin: z.enum(['desktop', 'im']),
        }),
      ),
    }),
  },
  'chat.sessionRename': {
    params: z.object({ id: z.string().min(1), title: z.string().min(1).max(60) }),
    result: z.object({ ok: z.literal(true) }),
  },
  'chat.sessionPin': {
    params: z.object({ id: z.string().min(1), pinned: z.boolean() }),
    result: z.object({ ok: z.literal(true) }),
  },
  'chat.sessionDelete': {
    // 删当前指针会话时 Main 回退指针（最近桌面会话，无则 'default'）并广播 prefs.changed。
    params: z.object({ id: z.string().min(1) }),
    result: z.object({ ok: z.literal(true) }),
  },
  'chat.sessionExport': {
    params: z.object({ id: z.string().min(1) }),
    result: z.union([
      z.object({ cancelled: z.literal(true) }),
      z.object({ cancelled: z.literal(false), path: z.string() }),
    ]),
  },
  'chat.setActiveSession': {
    // 会话切换/新建统一入口（app.prefs.set 通用面不收对象值）；characterId = 当前角色，
    // Main 写 chat.activeSessions 并经 prefs.changed 广播（Hub/浮层同步）。
    params: z.object({ sessionId: z.string().min(1) }),
    result: z.object({ ok: z.literal(true) }),
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
  'app.window.hideSelf': {
    // 窗口自收起（Main 以 sender 定位）。overlay 页面内 × 必须走它：sandbox renderer 的
    // window.close() 会绕过 Main 的 close 事件拦截直接销毁窗口（2026-07 实测），销毁后
    // showChat 永远唤不回。
    params: z.object({}),
    result: z.object({ ok: z.literal(true) }),
  },
  'app.window.minimizeSelf': {
    // 窗口自最小化（Hub frame:false 无系统标题栏，顶栏 − 按钮走它）。
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
  'app.generateDiag': {
    // J5：生成本地脱敏 .dsdiag（D8 入口 / 崩溃钩子）。真实上报端点留 M9。
    params: z.object({}),
    result: z.object({ ok: z.literal(true), path: z.string() }),
  },

  // --- request/response: Renderer → Main（D7 数据页，批次⑥）---
  'app.importData': {
    // 选 .dsbak → 校验 → 落 <sqlitePath>.import，重启时换库（恢复语义，spec §4）。
    params: z.object({}),
    result: z.union([
      z.object({ cancelled: z.literal(true) }),
      z.object({ cancelled: z.literal(false), ok: z.literal(true), requiresRestart: z.literal(true) }),
    ]),
  },
  'app.exportDataPick': {
    // D7 导出：Main 弹保存框 → 复用 exportData。
    params: z.object({}),
    result: z.union([
      z.object({ cancelled: z.literal(true) }),
      z.object({ cancelled: z.literal(false), ok: z.literal(true), bytes: z.number().int(), path: z.string() }),
    ]),
  },
  'app.relaunch': { params: z.object({}), result: z.object({ ok: z.literal(true) }) },
  'app.openDataDir': { params: z.object({}), result: z.object({ ok: z.literal(true) }) },
  'app.clearMessages': { params: z.object({}), result: z.object({ ok: z.literal(true) }) },
  'app.usageSummary': {
    // 本月 token 用量聚合（F-AI-08；月界在 Main 按本地时区自然月）。
    params: z.object({}),
    result: z.object({
      sinceTs: z.number(),
      tokensIn: z.number().int().nonnegative(),
      tokensOut: z.number().int().nonnegative(),
      messages: z.number().int().nonnegative(),
    }),
  },
  'app.stats.overview': {
    // 总览页聚合（spec 2026-07-09）。range：1=今日0点起小时桶；3/7=最近 N 自然日天桶。
    params: z.object({ rangeDays: z.union([z.literal(1), z.literal(3), z.literal(7)]) }),
    result: z.object({
      kpi: z.object({
        monthMessages: z.number().int().nonnegative(),
        monthTokens: z.number().int().nonnegative(),
        memoryMb: z.number().nonnegative(),
        uptimeSec: z.number().nonnegative(),
      }),
      companionDays: z.number().int().min(1),
      todayMessages: z.number().int().nonnegative(),
      messageSeries: z.array(z.tuple([z.number(), z.number()])),
      tokenSeries: z.array(
        z.object({ model: z.string(), points: z.array(z.tuple([z.number(), z.number()])) }),
      ),
      tokensByModel: z.array(z.object({ model: z.string(), tokens: z.number() })),
      channels: z.array(
        z.object({
          id: z.string(),
          type: z.string(),
          name: z.string(),
          enabled: z.boolean(),
          connected: z.boolean(),
          error: z.string().nullable(),
        }),
      ),
      mcpToolCount: z.number().int().nonnegative(),
      pluginEnabled: z.number().int().nonnegative(),
      pluginTotal: z.number().int().nonnegative(),
      appVersion: z.string(),
    }),
  },
  'app.version': {
    params: z.object({}),
    result: z.object({ version: z.string() }),
  },

  // --- request/response: Renderer → Main（⑪ 自动更新：自动查手动装）---
  'app.update.status': {
    params: z.object({}),
    result: UpdateStatusSchema, // 当前状态只读（关于页 mounted 取态，不触发检查）
  },
  'app.update.check': {
    params: z.object({}),
    result: UpdateStatusSchema, // 触发后即时状态（checking / disabled{reason}）
  },
  'app.update.download': {
    params: z.object({}),
    result: z.object({ ok: z.literal(true) }),
  },
  'app.update.install': {
    params: z.object({}),
    result: z.object({ ok: z.literal(true) }),
  },
  // --- notification: Main → 所有 renderer（更新状态机变化，关于页驱动）---
  'update.status': {
    params: UpdateStatusSchema,
    result: z.null(),
  },

  // --- request/response: Renderer → Main（应用偏好，M7a；UI 在 D 系列）---
  'app.prefs.getAll': {
    params: z.object({}),
    result: PrefsSchema,
  },
  'app.prefs.set': {
    // value 必填：标量或 string[]（线 B-1 起 im.wakePrefixes 等数组键开放直写）；
    // 注：不能用 z.unknown()——它在对象里自动可选，会让缺 value 也通过校验。
    // 按 key 对应字段的深校验在 prefs-service 做（命中非法 → -32602）。
    params: z.object({
      key: z.string().min(1),
      value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]),
    }),
    result: z.object({ ok: z.literal(true) }),
  },
  // --- notification: Main → 所有 renderer（某 pref 变更，驱动即时生效）---
  'app.prefs.changed': {
    params: z.object({
      key: z.string().min(1),
      // record：会话管理指针 chat.activeSessions 经 chat.setActiveSession 广播（set 面仍不收对象）。
      value: z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.array(z.string()),
        z.record(z.string()),
      ]),
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
  'character.gesture': {
    // F-IT-01 触摸语义分级统一上报入口（tap/长按/抚摸/拖拽/文件 drop）。
    params: z.object({
      zone: z.enum(['head', 'body']),
      kind: z.enum(['tap', 'long', 'stroke', 'dragStart', 'dragEnd', 'fileDrop']),
    }),
    result: z.object({ ok: z.literal(true) }),
  },
  // --- notification: Main → Character 窗（主动台词 → 桌面气泡，不入会话，F-IT） ---
  'pet.say': { params: z.object({ text: z.string() }), result: z.null() },
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
  // --- request/response: Renderer → Main（批次④ 角色包体系：列表/切换/导入/卸载）---
  'character.list': {
    params: z.object({}),
    result: z.object({
      characters: z.array(
        z.object({
          characterId: z.string(),
          manifest: CharacterManifestSchema,
          builtin: z.boolean(),
          active: z.boolean(),
          // ⑩.7 E2 信息区：包目录大小 / 安装时间（目录 birthtime；Main 计算）。
          sizeBytes: z.number().optional(),
          installedAt: z.number().optional(),
        }),
      ),
    }),
  },
  'character.switch': {
    // F-CH-07 热切换：写 activeId + 广播 character.changed（渲染窗 reload 自取新角色）。
    params: z.object({ id: z.string().min(1) }),
    result: z.object({ ok: z.literal(true) }),
  },
  'character.importPick': {
    // E3 两段式①：Main 弹系统选择框 + 解析 manifest 摘要（不安装）。
    params: z.object({ kind: z.enum(['pack', 'folder']) }),
    result: z.union([
      z.object({ cancelled: z.literal(true) }),
      z.object({
        cancelled: z.literal(false),
        path: z.string(),
        summary: z.object({
          id: z.string(),
          name: z.string(),
          version: z.string(),
          engine: z.string(),
        }),
      }),
    ]),
  },
  'character.importApply': {
    // E3 两段式②：确认后安装到 userData/characters/<id>。
    params: z.object({ path: z.string().min(1) }),
    result: z.object({ ok: z.literal(true), id: z.string() }),
  },
  'character.remove': {
    // 仅导入包可卸；卸当前角色 → 先切回 default。
    params: z.object({ id: z.string().min(1) }),
    result: z.object({ ok: z.literal(true) }),
  },
  // --- request/response: Renderer → Main（⑩.7 E4 角色编辑器写侧）---
  'character.updateManifest': {
    // 整包替换写回 manifest.json：仅 userData 根；id/engine/model 不可变；原子写；
    // 命中当前角色补发 character.changed 热重载。
    params: z.object({ id: z.string().min(1), manifest: CharacterManifestSchema }),
    result: z.object({ ok: z.literal(true), manifest: CharacterManifestSchema }),
  },
  'character.duplicate': {
    // 目录复制到 userData 根 <id>-copy（冲突自增）+ manifest id/name 重写；内置→userData 即「复制后编辑」。
    params: z.object({ id: z.string().min(1) }),
    result: z.object({ newId: z.string() }),
  },
  'character.export': {
    // dialog.showSaveDialog(.dspack) + 目录 zip 打包（结构与 importPick 期待一致）。
    params: z.object({ id: z.string().min(1) }),
    result: z.union([
      z.object({ canceled: z.literal(true) }),
      z.object({ canceled: z.literal(false), path: z.string() }),
    ]),
  },
  'character.revealInFolder': {
    // shell.showItemInFolder 打开角色目录。
    params: z.object({ id: z.string().min(1) }),
    result: z.object({ ok: z.literal(true) }),
  },
  'character.testGreeting': {
    // E4 试讲：生效 persona → provider 单发（30 字内问候）→ 行为标签解析 → cue 通道播放。
    // 不建会话、不进记忆、不计统计；异步播放，错误走 toast。
    params: z.object({ id: z.string().min(1) }),
    result: z.object({ ok: z.literal(true) }),
  },
  'character.listFiles': {
    // E4 外观 Tab preview 下拉数据源：包内文件相对路径列表（不含 manifest.json）。
    params: z.object({ id: z.string().min(1) }),
    result: z.object({ files: z.array(z.string()) }),
  },
  // --- notification: Main → character/overlay（角色已切换；两窗 location.reload()）---
  'character.changed': { params: z.object({ characterId: z.string() }), result: z.null() },

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
  // --- notification: Main → UI Overlay/Hub（C′ §3：推理/工具调用流，Hub 消费 + 桌宠线索）---
  // chat.reasoning 是即发即弃的推理流（直发 broadcast，不进双轨背压队列、无快照重放/去重），
  // 故 params 不带 seq——与 ConversationCore 的 Notification、renderer on() 类型三处对齐。
  'chat.reasoning': {
    params: z.object({ sessionId: z.string(), text: z.string() }),
    result: z.null(),
  },
  'chat.toolCall': {
    params: z.object({
      sessionId: z.string(),
      call: z.object({
        id: z.string(),
        name: z.string(),
        args: z.unknown().optional(),
        phase: z.enum(['pending', 'result', 'error']),
        result: z.string().optional(),
      }),
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

  // --- request/response: Renderer → Main（Provider 工作台，AstrBot 对齐两层 Source+Model）---
  'provider.getConfig': {
    params: z.object({}),
    result: z.object({
      sources: z.array(ProviderSourceSchema),
      models: z.array(ModelEntrySchema),
      templates: z.array(AdapterTemplateSchema),
      providerTemplates: z.array(ProviderTemplateSchema),
    }),
  },
  'provider.upsertSource': {
    params: z.object({ source: ProviderSourceSchema }),
    result: z.object({ ok: z.literal(true), id: z.string() }),
  },
  'provider.deleteSource': {
    params: z.object({ id: z.string().min(1) }),
    result: z.object({ ok: z.literal(true) }),
  },
  'provider.fetchModels': {
    params: z.object({ sourceId: z.string().min(1) }),
    result: z.object({ models: z.array(z.string()) }),
  },
  'provider.addModel': {
    params: z.object({ entry: ModelEntrySchema }),
    result: z.object({ ok: z.literal(true) }),
  },
  'provider.deleteModel': {
    params: z.object({ id: z.string().min(1) }),
    result: z.object({ ok: z.literal(true) }),
  },
  'provider.setModelEnabled': {
    params: z.object({ id: z.string().min(1), enabled: z.boolean() }),
    result: z.object({ ok: z.literal(true) }),
  },
  'provider.updateModelCaps': {
    params: z.object({ id: z.string().min(1), caps: ModelCapsSchema }),
    result: z.object({ ok: z.literal(true) }),
  },
  'provider.testModel': {
    params: z.object({ id: z.string().min(1) }),
    result: z.object({
      ok: z.boolean(),
      latencyMs: z.number().int().nonnegative().optional(),
      errorKind: ErrorKindSchema.optional(),
    }),
  },
  'provider.testSource': {
    // 源级「测试连接 / 检测」（照 AstrBot test provider）：探活 base+key 可达可鉴权。
    params: z.object({ id: z.string().min(1) }),
    result: z.object({
      ok: z.boolean(),
      latencyMs: z.number().int().nonnegative().optional(),
      errorKind: ErrorKindSchema.optional(),
      error: z.string().optional(),
    }),
  },
  'provider.detectEmbeddingDim': {
    // 嵌入维度「自动检测」/ 源级检测（照 AstrBot）：embed 一段探针读向量维度 + 延迟。
    params: z.object({ sourceId: z.string().min(1), model: z.string().min(1) }),
    result: z.object({
      ok: z.boolean(),
      dimensions: z.number().int().nonnegative().optional(),
      latencyMs: z.number().int().nonnegative().optional(),
      error: z.string().optional(),
    }),
  },
  'provider.setDefault': {
    params: z.object({ capability: CapabilitySchema, modelId: z.string() }),
    result: z.object({ ok: z.literal(true) }),
  },
  'provider.ollamaDetect': {
    params: z.object({}),
    result: z.object({ available: z.boolean(), models: z.array(z.string()) }),
  },

  // --- request/response: Renderer → Main（§4 MCP 接入 + 工具安全门）---
  'mcp.getConfig': {
    params: z.object({}),
    result: z.object({
      servers: z.array(McpServerSchema),
      tools: z.array(McpToolSchema),
      status: z.record(McpServerStatusSchema),
    }),
  },
  'mcp.upsertServer': {
    params: z.object({ server: McpServerSchema }),
    result: z.object({ ok: z.literal(true), id: z.string() }),
  },
  'mcp.deleteServer': {
    params: z.object({ id: z.string().min(1) }),
    result: z.object({ ok: z.literal(true) }),
  },
  'mcp.testServer': {
    params: z.object({ server: McpServerSchema }),
    result: z.object({
      ok: z.boolean(),
      tools: z.array(McpToolSchema),
      error: z.string().optional(),
    }),
  },
  'mcp.setServerActive': {
    params: z.object({ id: z.string().min(1), active: z.boolean() }),
    result: z.object({ ok: z.literal(true) }),
  },
  'mcp.setToolActive': {
    params: z.object({
      serverId: z.string().min(1),
      toolName: z.string().min(1),
      active: z.boolean(),
    }),
    result: z.object({ ok: z.literal(true) }),
  },

  // --- request/response: Renderer → Main（线 B-1 多 IM 通道，照 mcp.* 形状）---
  'im.getConfig': {
    params: z.object({}),
    result: z.object({
      platforms: z.array(ImPlatformSchema),
      statuses: z.array(ImStatusSchema),
    }),
  },
  'im.savePlatform': {
    params: z.object({ platform: ImPlatformSchema }),
    result: z.object({ ok: z.literal(true) }),
  },
  'im.deletePlatform': {
    params: z.object({ id: z.string().min(1) }),
    result: z.object({ ok: z.literal(true) }),
  },
  // notification: Main → renderers（适配器状态变化 → 连接页状态 chip 实时刷新）
  'im.status': { params: ImStatusSchema, result: z.null() },
  // notification: Main → character 窗（唤醒消息到桌轻提示，im.notifyDesktop 可关）
  'im.activity': {
    params: z.object({ platformId: z.string(), senderName: z.string(), text: z.string() }),
    result: z.null(),
  },

  // --- request/response: Renderer → Main（线 B-2 插件双运行时管理面）---
  'plugins.list': {
    params: z.object({}),
    result: z.object({
      desktop: z.array(
        z.object({
          manifest: DesktopPluginManifestSchema,
          enabled: z.boolean(),
          status: PluginRuntimeStatusSchema,
          lastError: z.string().optional(),
        }),
      ),
      star: z.array(z.object({ meta: StarPluginMetaSchema, enabled: z.boolean() })),
      python: z.object({ found: z.boolean(), version: z.string().optional() }),
    }),
  },
  'plugins.installDesktop': {
    // 两段式①（照 character.importPick）：弹框选 .dsplug/文件夹 + 解析 manifest（不安装）。
    // 返回的 manifest.permissions 是安装权限确认对话框的数据源（spec §4 硬要求）。
    params: z.object({ kind: z.enum(['dsplug', 'folder']) }),
    result: z.union([
      z.object({ cancelled: z.literal(true) }),
      z.object({
        cancelled: z.literal(false),
        path: z.string(),
        manifest: DesktopPluginManifestSchema,
      }),
    ]),
  },
  'plugins.installDesktopApply': {
    // 两段式②：权限确认后落盘安装到 userData/plugins/<id> 并启动。
    params: z.object({ path: z.string().min(1) }),
    result: z.object({ ok: z.literal(true), id: z.string() }),
  },
  'plugins.uninstallDesktop': {
    params: z.object({ id: z.string().min(1) }),
    result: z.object({ ok: z.literal(true) }),
  },
  'plugins.reload': {
    // F-PL-06 热重载：stop worker → 重读目录 → 起新 worker。
    params: z.object({ id: z.string().min(1) }),
    result: z.object({ ok: z.literal(true) }),
  },
  'plugins.setEnabled': {
    params: z.object({
      runtime: z.enum(['desktop', 'star']),
      id: z.string().min(1),
      enabled: z.boolean(),
    }),
    result: z.object({ ok: z.literal(true) }),
  },
  'plugins.getConfig': {
    params: z.object({ id: z.string().min(1) }),
    result: z.object({
      schema: z.record(z.unknown()).optional(),
      values: z.record(z.unknown()),
    }),
  },
  'plugins.setConfig': {
    // 值存 userData/plugins/<id>/config.json，变更推 worker onConfigChanged。
    params: z.object({ id: z.string().min(1), values: z.record(z.unknown()) }),
    result: z.object({ ok: z.literal(true) }),
  },
  'plugins.installStar': {
    // Star zip/文件夹导入（UI 侧先弹「本机运行」警示再调用）。
    params: z.object({ kind: z.enum(['zip', 'folder']) }),
    result: z.union([
      z.object({ cancelled: z.literal(true) }),
      z.object({ cancelled: z.literal(false), ok: z.literal(true), dir: z.string() }),
    ]),
  },
  'plugins.uninstallStar': {
    params: z.object({ dir: z.string().min(1) }),
    result: z.object({ ok: z.literal(true) }),
  },
  'plugins.marketFetch': {
    // Main 侧拉市场源 JSON 索引（renderer 无跨域能力）。
    params: z.object({ url: z.string().url() }),
    result: z.object({ items: z.array(z.unknown()) }),
  },
  'plugins.installFromUrl': {
    // 市场「从 URL 安装」：Main 下载 .dsplug 到临时文件 + 解析 manifest（不安装）——
    // 返回后 UI 弹权限确认，再走 plugins.installDesktopApply(path) 同流。
    params: z.object({ url: z.string().url() }),
    result: z.object({ path: z.string(), manifest: DesktopPluginManifestSchema }),
  },
  // notification: Main → renderers（插件运行状态变化 → 插件页状态 chip 实时刷新）
  'plugin.status': {
    params: z.object({
      runtime: z.enum(['desktop', 'star']),
      id: z.string(),
      status: PluginRuntimeStatusSchema,
      lastError: z.string().optional(),
    }),
    result: z.null(),
  },

  // --- request/response: Renderer → Main（§5 知识库 / 自动 RAG）---
  'kb.list': { params: z.object({}), result: z.object({ kbs: z.array(KbSchema) }) },
  'kb.create': {
    params: z.object({
      name: z.string().min(1),
      emoji: z.string().optional(),
      embeddingModelId: z.string().optional(),
    }),
    result: z.object({ ok: z.literal(true), id: z.string() }),
  },
  'kb.delete': {
    params: z.object({ id: z.string().min(1) }),
    result: z.object({ ok: z.literal(true) }),
  },
  'kb.update': { params: z.object({ kb: KbSchema }), result: z.object({ ok: z.literal(true) }) },
  'kb.addDocument': {
    params: z.object({ kbId: z.string().min(1), filename: z.string(), text: z.string() }),
    result: z.object({
      ok: z.literal(true),
      docId: z.string(),
      chunks: z.number().int().nonnegative(),
    }),
  },
  'kb.listDocuments': {
    params: z.object({ kbId: z.string().min(1) }),
    result: z.object({ docs: z.array(KbDocSchema) }),
  },
  'kb.deleteDocument': {
    params: z.object({ kbId: z.string().min(1), docId: z.string().min(1) }),
    result: z.object({ ok: z.literal(true) }),
  },
  'kb.search': {
    params: z.object({
      kbId: z.string().min(1),
      query: z.string(),
      topK: z.number().int().positive().optional(),
    }),
    result: z.object({ hits: z.array(KbHitSchema) }),
  },
  'kb.importFile': {
    // 批次⑥：Main 弹框选 .txt/.md/.pdf → 解析 → 摄入（PDF 用 unpdf）。
    params: z.object({ kbId: z.string().min(1) }),
    result: z.union([
      z.object({ cancelled: z.literal(true) }),
      z.object({
        cancelled: z.literal(false),
        ok: z.literal(true),
        docId: z.string(),
        chunks: z.number().int().nonnegative(),
        filename: z.string(),
      }),
    ]),
  },

  // --- request/response: Renderer → Main（批次⑥ F-AI-06 长期记忆 / F3 记忆页）---
  'memory.list': {
    params: z.object({}),
    result: z.object({ facts: z.array(MemoryFactSchema) }), // 当前角色
  },
  'memory.add': {
    params: z.object({ text: z.string().min(1) }),
    result: z.object({ ok: z.literal(true), id: z.number().int() }),
  },
  'memory.delete': {
    params: z.object({ id: z.number().int() }),
    result: z.object({ ok: z.literal(true) }),
  },
  'memory.setPinned': {
    params: z.object({ id: z.number().int(), pinned: z.boolean() }),
    result: z.object({ ok: z.literal(true) }),
  },
  'memory.clear': { params: z.object({}), result: z.object({ ok: z.literal(true) }) },

  // --- request/response: Renderer → Main（§6 Persona 管理）---
  'persona.getAll': {
    params: z.object({}),
    result: z.object({
      personas: z.array(PersonaSchema),
      defaultId: z.string(),
      bindings: z.record(z.string()),
    }),
  },
  'persona.upsert': {
    params: z.object({ persona: PersonaSchema }),
    result: z.object({ ok: z.literal(true), id: z.string() }),
  },
  'persona.delete': {
    params: z.object({ id: z.string().min(1) }),
    result: z.object({ ok: z.literal(true) }),
  },
  'persona.setDefault': {
    // '' = 恢复内置人设
    params: z.object({ id: z.string() }),
    result: z.object({ ok: z.literal(true) }),
  },
  'persona.bind': {
    // personaId '' = 解绑该角色
    params: z.object({ characterId: z.string().min(1), personaId: z.string() }),
    result: z.object({ ok: z.literal(true) }),
  },

  // --- request/response: Renderer → Main（§7 Trace 诊断）---
  'trace.history': {
    params: z.object({}),
    result: z.object({ records: z.array(TraceRecordSchema) }),
  },
  'trace.clear': { params: z.object({}), result: z.object({ ok: z.literal(true) }) },
  // notification: Main → Hub（诊断页实时时间线；直发不进背压队列）
  'trace.record': { params: TraceRecordSchema, result: z.null() },

  // --- F-VC 语音（TTS/ASR；Main 直调 openai 兼容端点，spec 2026-07-01）---
  'voice.speak': {
    params: z.object({ text: z.string().min(1) }),
    result: z.object({ ok: z.literal(true) }),
  },
  'voice.transcribe': {
    params: z.object({ dataBase64: z.string().min(1), mime: z.string().min(1) }),
    result: z.object({ text: z.string() }),
  },
  // notification: Main → Character 窗（TTS 音频 base64，播放 + RMS 嘴型）
  'voice.audio': {
    params: z.object({
      sessionId: z.string().optional(),
      dataBase64: z.string(),
      mime: z.string(),
      /** 播放端兜底变速（引擎已在服务端应用语速的传 1）。 */
      rate: z.number().optional(),
    }),
    result: z.null(),
  },

  // --- ⑩.6 音色工坊（D5，spec 2026-07-10）---
  'voice.previewProfile': {
    // 试听未保存草稿：不落库直接合成播
    params: z.object({ profile: VoiceProfileSchema, text: z.string().min(1) }),
    result: z.object({ ok: z.literal(true) }),
  },
  'voice.testEngine': {
    // gptsovits 探活（任何 HTTP 响应算通）；fishaudio 轻量鉴权探测
    params: z.object({ engine: z.enum(['gptsovits', 'fishaudio']) }),
    result: z.object({ ok: z.boolean(), error: z.string().optional() }),
  },
  'voice.saveRefAudio': {
    // ≤10MB wav/mp3；暂存 voices/_staging/，保存音色时 commitRefAudio 归位
    params: z.object({ dataBase64: z.string().min(1), mime: z.string().min(1) }),
    result: z.object({ file: z.string() }),
  },
  'voice.commitRefAudio': {
    params: z.object({ voiceId: z.string().min(1), file: z.string().min(1) }),
    result: z.object({ ok: z.literal(true) }),
  },
  'voice.removeVoiceDir': {
    // 删除音色即清 userData/voices/<id>/ 目录
    params: z.object({ id: z.string().min(1) }),
    result: z.object({ ok: z.literal(true) }),
  },
  'voice.stopPlayback': {
    // bargeIn：录音开始时调用，广播 voice.stop 停播
    params: z.object({}),
    result: z.object({ ok: z.literal(true) }),
  },
  // notification: Main → Character 窗（停止当前 TTS 播放）
  'voice.stop': { params: z.object({}), result: z.null() },
} as const;

export type MethodName = keyof typeof Methods;
