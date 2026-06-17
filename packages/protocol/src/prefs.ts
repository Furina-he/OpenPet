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
});

export type Prefs = z.infer<typeof PrefsSchema>;
export type PrefKey = keyof Prefs;
export const DEFAULT_PREFS: Prefs = PrefsSchema.parse({});
