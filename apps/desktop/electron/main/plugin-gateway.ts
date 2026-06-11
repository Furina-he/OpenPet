/**
 * PluginGateway — Worker → Main 的 plugin.* 网关（tech-design §3 第四命名空间）。
 *
 * 入站 plugin.request 帧 → 复用 createRouter 做 Zod 校验 + 分发 → 出站
 * plugin.response 帧。**永不 reject**：所有错误（未知 method -32601 / schema
 * 违约 -32602 / 处理器异常 -32000）都封进响应帧的 error 字段，调用方
 * （ProviderHost）只管把帧发回 worker。
 *
 * M2 形态：单 worker，身份即通道；Skill 注册表与 Tool 表都在 Main 内存。
 * M5 扩展：多 worker 时由 PluginHost 按 port 标注插件身份，权限策略接 UI 确认。
 */
import type { z } from 'zod';
import type { Methods, PluginRequestFrame, PluginResponseFrame } from '@desksoul/protocol';
import { createRouter, RpcError } from './router.js';

type PermissionParams = z.infer<(typeof Methods)['plugin.permissionRequest']['params']>;

export interface PluginGatewayDeps {
  /** Main 内置 Tool 表（M2 仅测试注册；生产为空直到 M5）。 */
  tools?: Map<string, (args: unknown) => unknown | Promise<unknown>>;
  /** 权限策略；缺省全拒（M7 设置 UI 接确认弹窗后放开）。 */
  permissionPolicy?: (req: PermissionParams) => boolean | Promise<boolean>;
}

export interface PluginGateway {
  handle(frame: PluginRequestFrame): Promise<PluginResponseFrame>;
  readonly skills: ReadonlyMap<string, { title: string }>;
}

export function createPluginGateway(deps: PluginGatewayDeps = {}): PluginGateway {
  const skills = new Map<string, { title: string }>();
  const tools = deps.tools ?? new Map<string, (args: unknown) => unknown | Promise<unknown>>();
  const policy = deps.permissionPolicy ?? (() => false);

  const router = createRouter<null>({
    'plugin.registerSkill': (p) => {
      skills.set(p.skillId, { title: p.title });
      return { ok: true as const };
    },
    'plugin.permissionRequest': async (p) => ({ granted: await policy(p) }),
    'plugin.invokeTool': async (p) => {
      const tool = tools.get(p.toolId);
      if (!tool) throw new RpcError(-32601, `Tool not found: ${p.toolId}`);
      return { value: await tool(p.args) };
    },
  });

  return {
    skills,
    async handle(frame) {
      const { id, method, params } = frame.rpc;
      try {
        const result = await router.dispatch(method, params, null);
        return { kind: 'plugin.response', rpc: { jsonrpc: '2.0', id, result } };
      } catch (e) {
        const code = e instanceof RpcError ? e.code : -32000;
        const message = e instanceof Error ? e.message : String(e);
        return { kind: 'plugin.response', rpc: { jsonrpc: '2.0', id, error: { code, message } } };
      }
    },
  };
}
