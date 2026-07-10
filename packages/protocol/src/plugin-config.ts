// 线 B-2 · 插件双运行时协议（Desktop plugin manifest + AstrBot Star 元数据 + 运行状态）。
// spec: internal/superpowers/specs/2026-07-08-plugin-runtimes-design.md §2/§3（收官已删，internal 私仓 git 历史可查）
import { z } from 'zod';

/** 插件 id 即安装目录名——小写字母开头，只允许 [a-z0-9_-]，长度 2–64（目录安全，禁路径分隔）。 */
export const PLUGIN_ID_RE = /^[a-z0-9][a-z0-9_-]{1,63}$/;

export const PluginPermissionSchema = z.enum(['tools', 'cues', 'say', 'fetch']);
export type PluginPermission = z.infer<typeof PluginPermissionSchema>;

export const DesktopPluginManifestSchema = z.object({
  id: z.string().regex(PLUGIN_ID_RE),
  name: z.string().min(1),
  version: z.string().min(1),
  author: z.string().default(''),
  description: z.string().default(''),
  engine: z.literal('desktop'),
  /** 打包后的单文件 ESM JS（作者侧自行构建；SDK 只提供类型）。 */
  entry: z.string().default('main.js'),
  /** 能力面白名单：manifest 未声明即拒（worker 侧能力门 + 安装确认展示）。 */
  permissions: z.array(PluginPermissionSchema).default([]),
  /** 线 A §2 config-metadata 形状（动态表单渲染）；可缺省=无配置页。 */
  configSchema: z.record(z.unknown()).optional(),
});
export type DesktopPluginManifest = z.infer<typeof DesktopPluginManifestSchema>;

/** AstrBot Star 元数据（metadata.yaml 子集，star-host 上报用）。 */
export const StarPluginMetaSchema = z.object({
  dir: z.string(),
  name: z.string().default(''),
  author: z.string().default(''),
  desc: z.string().default(''),
  version: z.string().default(''),
  repo: z.string().default(''),
  commands: z.array(z.string()).default([]),
});
export type StarPluginMeta = z.infer<typeof StarPluginMetaSchema>;

export const PluginRuntimeStatusSchema = z.enum(['running', 'restarting', 'disabled', 'error']);
export type PluginRuntimeStatus = z.infer<typeof PluginRuntimeStatusSchema>;

/** LLM function-calling 安全名：p_<pluginId>_<tool>，非法字符折叠为 _，总长 ≤64。 */
export function pluginToolWireName(pluginId: string, tool: string): string {
  const clean = (s: string): string => s.replace(/[^A-Za-z0-9_-]/g, '_');
  return `p_${clean(pluginId)}_${clean(tool)}`.slice(0, 64);
}
