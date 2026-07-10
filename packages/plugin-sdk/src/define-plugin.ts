// Desktop 插件作者面 API（线 B-2）：纯类型 + 恒等函数，运行时零依赖。
// 宿主侧（apps/sidecar plugin-entry.ts）按 manifest.permissions 做能力门。

export interface PluginFetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface PluginCtx {
  /** 桌宠台词气泡（须声明 'say' 权限；未声明时静默丢弃）。 */
  say(text: string): void;
  /** 白名单代理 fetch（须声明 'fetch' 权限；由宿主转发，未声明即 reject）。 */
  fetch(url: string, init?: PluginFetchInit): Promise<{ status: number; body: string }>;
  /** 当前配置值（manifest.configSchema 声明后 Hub 可编辑）。 */
  config(): Record<string, unknown>;
  log(msg: string): void;
}

export interface PluginToolDef {
  name: string;
  description: string;
  /** JSON Schema（LLM function calling parameters）。 */
  parameters: unknown;
  execute(args: unknown, ctx: PluginCtx): unknown | Promise<unknown>;
}

export interface DesktopPluginDef {
  tools?: PluginToolDef[];
  /** 声明式 cue 表项（@openpet/protocol CueEntry 形状，宿主侧 Zod 校验）。 */
  cues?: unknown[];
  activate?(ctx: PluginCtx): void | Promise<void>;
  onConfigChanged?(config: Record<string, unknown>): void;
}

export function definePlugin(def: DesktopPluginDef): DesktopPluginDef {
  return def;
}
