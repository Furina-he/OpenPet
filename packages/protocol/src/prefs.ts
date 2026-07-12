import { z } from 'zod';
import { ProviderSourceSchema, ModelEntrySchema } from './provider-config.js';
import { McpServerSchema } from './mcp-config.js';
import { KbSchema } from './kb-config.js';
import { PersonaSchema } from './persona-config.js';
import { ImPlatformSchema } from './im-config.js';
import { VoiceProfileSchema } from './voice-config.js';

/** 界面主题（walking skeleton 用）；'system' 未指明时降级浅色（ui-design §2.2）。 */
export const ThemeSchema = z.enum(['system', 'light', 'dark']);
export type ThemePref = z.infer<typeof ThemeSchema>;

/**
 * 全量 prefs 单一真源（ui-design §14.1）。扁平 dotted key 便于 set(key,value) 单点校验：
 *   PrefsSchema.shape['display.theme'].safeParse(value)
 * M7a 定义全量 key + 默认，但只接通 display.theme 的端到端；其余副作用/UI 留 M7b。
 */
export const PrefsSchema = z.object({
  'general.launchAtLogin': z.boolean().default(true),
  'general.developerMode': z.boolean().default(false),
  'general.agentThinkingDisplay': z.enum(['full', 'tools', 'hidden']).default('full'),
  'display.theme': ThemeSchema.default('system'),
  'display.alwaysOnTop': z.boolean().default(true),
  'display.clickThrough': z.boolean().default(false),
  'display.lookAt': z.boolean().default(true),
  'display.footGlow': z.boolean().default(false),
  'display.characterScale': z.number().min(0.5).max(2).default(1),
  'display.bubbleDuration': z.enum(['3', '5', '8', 'always']).default('5'),
  'display.dndManual': z.boolean().default(false),
  'display.focusMode': z.boolean().default(false),
  'privacy.longTermMemory': z.boolean().default(true),
  'privacy.anonymousStats': z.boolean().default(false),
  'privacy.crashReport': z.boolean().default(true),
  // general（D2 通用）
  'general.startupShow': z.enum(['character+tray', 'tray', 'none']).default('character+tray'),
  'general.language': z.string().default('zh-CN'),
  'general.timezone': z.string().default('Asia/Shanghai'),
  'general.hour24': z.boolean().default(true),
  'general.autoUpdate': z.boolean().default(true),
  'general.updateChannel': z.enum(['stable', 'preview']).default('stable'),
  'general.desktopNotifications': z.boolean().default(true),
  'general.proactiveSpeech': z.boolean().default(false),
  'general.proactiveFreq': z.number().min(0).max(100).default(30),
  'general.dndStart': z.string().default('23:00'),
  'general.dndEnd': z.string().default('08:00'),
  // display（D4 显示与窗口）
  'display.lookAtStrength': z.number().min(0).max(100).default(50),
  'display.physics': z.boolean().default(true),
  'display.clickThroughBar': z.boolean().default(false),
  'display.wallpaperMode': z.boolean().default(false),
  'display.followDisplay': z.string().default('primary'),
  'display.crossScreenDrag': z.enum(['snap', 'free']).default('snap'),
  'display.fullscreenHide': z.boolean().default(true),
  'display.gameDetect': z.boolean().default(true),
  'display.meetingDowngrade': z.boolean().default(true),
  // privacy（D6 隐私）
  'privacy.masterPassword': z.boolean().default(false),
  'privacy.contentUpload': z.boolean().default(true),
  'privacy.masking': z.boolean().default(true),
  'privacy.contextWindow': z.number().int().min(1).max(200).default(20),
  'privacy.clipboard': z.boolean().default(false),
  'privacy.screenshot': z.boolean().default(false),
  'privacy.camera': z.boolean().default(false),
  'privacy.microphone': z.boolean().default(true),
  'privacy.systemNotify': z.boolean().default(true),
  'privacy.affectionProfile': z.boolean().default(true),
  'privacy.logRetentionDays': z.number().int().min(1).max(90).default(7),
  // model（D3 模型 API）——旧单 provider 键（activeProvider/activeModel/*BaseUrl 8 键）已于
  // 批次⑥ 删除（arch-evolution #4 收口）；老文件升级由 startup-provider-migrate 读原始 JSON 一次性收编。
  // model · Provider 工作台（AstrBot 对齐）—— 两层 Source+Model
  'model.providerSources': z.array(ProviderSourceSchema).default([]),
  'model.models': z.array(ModelEntrySchema).default([]),
  'model.defaultChatModelId': z.string().default(''),
  'model.defaultEmbeddingModelId': z.string().default(''),
  'model.defaultSttModelId': z.string().default(''),
  'model.defaultTtsModelId': z.string().default(''),
  'model.defaultRerankModelId': z.string().default(''),
  'model.defaultAgentModelId': z.string().default(''),

  // mcp（§4 MCP 接入 + 工具安全门）
  'mcp.servers': z.array(McpServerSchema).default([]),
  'mcp.disabledTools': z.array(z.string()).default([]),
  // im（线 B-1 多 IM 通道：平台列表 + 唤醒/白名单/记忆/到桌提醒全局项）
  'im.platforms': z.array(ImPlatformSchema).default([]),
  'im.wakePrefixes': z.array(z.string()).default([]),
  'im.friendNeedsWake': z.boolean().default(false),
  'im.whitelistEnabled': z.boolean().default(false),
  'im.whitelist': z.array(z.string()).default([]),
  'im.admins': z.array(z.string()).default([]),
  'im.groupIntoMemory': z.boolean().default(false),
  'im.notifyDesktop': z.boolean().default(true),
  // kb（§5 知识库 / 自动 RAG）
  'kb.list': z.array(KbSchema).default([]),
  'privacy.knowledgeBase': z.boolean().default(true),
  // character（批次④ 角色包体系）
  'character.activeId': z.string().default('default'),
  // plugins（线 B-2 Desktop 插件运行时）
  'plugins.disabled': z.array(z.string()).default([]),
  'plugins.marketSources': z.array(z.string()).default([]),
  // star（线 B-2 AstrBot Star 兼容宿主）
  'star.disabled': z.array(z.string()).default([]),
  'star.pipIndexUrl': z.string().default('https://pypi.tuna.tsinghua.edu.cn/simple'),
  // pet（F-IT 桌宠交互）
  'pet.mood': z
    .object({ value: z.number().min(-1).max(1), updatedAt: z.number() })
    .default({ value: 0, updatedAt: 0 }),
  'pet.lastGreet': z.string().default(''), // 'YYYY-MM-DD/morning' 防跨重启重复问候
  // persona（§6 人设管理）
  'persona.list': z.array(PersonaSchema).default([]),
  'persona.defaultId': z.string().default(''), // '' = 内置人设（现状行为）
  'persona.bindings': z.record(z.string()).default({}), // characterId → personaId
  // 会话管理：当前会话指针（characterId → sessionId；缺省视为 'default'）。Hub/浮层共享。
  'chat.activeSessions': z.record(z.string()).default({}),
  // ⑫ {{user}} 宏数据源（D2「怎么称呼你」）；空 = 组装侧回退「用户」。
  'chat.userName': z.string().max(40).default(''),
  // trace（§7 诊断）
  'trace.enabled': z.boolean().default(true),
  // voice（F-VC 语音运行时 + ⑩.6 音色工坊）
  'voice.autoSpeak': z.boolean().default(false),
  'voice.voices': z.array(VoiceProfileSchema).default([]),
  'voice.defaultVoiceId': z.string().default(''), // '' = 未设默认音色
  // 引擎连接（gptsovits/fishaudio 不进 provider 工作台，spec §1 裁定；key 明文随源 F-ST-04 口径）
  'voice.engines.gptsovits.apiBase': z.string().default('http://127.0.0.1:9880'),
  'voice.engines.fishaudio.apiBase': z.string().default('https://api.fish-audio.cn'),
  'voice.engines.fishaudio.key': z.string().default(''),
  // MiMo voicedesign 模型（照上游 mimo-v2.5-tts-voicedesign）
  'voice.engines.mimo.designModel': z.string().default('mimo-v2.5-tts-voicedesign'),
  'voice.rate': z.number().min(0.5).max(2).default(1),
  'voice.mouthSync': z.boolean().default(true),
  'voice.mouthStrength': z.number().min(0).max(2).default(1),
  'voice.bargeIn': z.boolean().default(false),
  'voice.micDeviceId': z.string().default(''), // '' = 系统默认麦克风
  // budget（D3 预算告警；本期仅持久化）
  'budget.enabled': z.boolean().default(false),
  'budget.monthlyCap': z.number().min(0).default(0),
  'budget.warnAt': z.number().min(0).max(100).default(80),
  'budget.onExceed': z.enum(['warn', 'pause']).default('warn'),
  // offline（D3 离线兜底；本期仅持久化）
  'offline.fallbackMode': z.enum(['ollama', 'demo', 'error']).default('ollama'),
  'offline.ollamaModel': z.string().default(''),
  // onboarding（M7b-2 首启引导）
  'onboarding.completed': z.boolean().default(false),
  // hotkeys（M8c J2；Electron accelerator 串）
  'hotkeys.chat': z.string().default('CommandOrControl+Shift+D'),
  'hotkeys.toggleHide': z.string().default('CommandOrControl+Shift+H'),
  'hotkeys.clickThrough': z.string().default('CommandOrControl+Shift+P'),
  'hotkeys.dnd': z.string().default('CommandOrControl+Shift+M'),
  'hotkeys.openHub': z.string().default('CommandOrControl+Shift+,'),
});

export type Prefs = z.infer<typeof PrefsSchema>;
export type PrefKey = keyof Prefs;
export const DEFAULT_PREFS: Prefs = PrefsSchema.parse({});
