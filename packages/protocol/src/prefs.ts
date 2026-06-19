import { z } from 'zod';

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
  // model（D3 模型 API）
  'model.activeProvider': z.string().default(''),
  'model.activeModel': z.string().default(''),
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
});

export type Prefs = z.infer<typeof PrefsSchema>;
export type PrefKey = keyof Prefs;
export const DEFAULT_PREFS: Prefs = PrefsSchema.parse({});
