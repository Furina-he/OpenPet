/**
 * McpService —— mcp.* RPC（§4 MCP 接入 + 工具安全门）。
 * 配置 CRUD 落 prefs（命令/env 明文，同 key directive）；驱动 McpManager 生命周期。
 * 注入 getPrefs/setPref（镜像 provider-service）+ manager + connectFactory（testServer 用临时 manager 探连）。
 * 安全门 = server 级 active（连/断）+ 工具级 active（disabledTools 增删 toolKey）。
 */
import {
  McpServerSchema,
  toolKey,
  validateMcpServer,
  type McpServer,
  type PrefKey,
  type Prefs,
} from '@openpet/protocol';
import { McpManager, type McpManagerDeps } from './mcp-manager.js';

export interface McpServiceDeps {
  manager: McpManager;
  getPrefs: () => Prefs;
  setPref: <K extends PrefKey>(key: K, value: Prefs[K]) => void;
  connectFactory: McpManagerDeps['connectFactory'];
}

export function createMcpService(deps: McpServiceDeps) {
  const { manager, getPrefs, setPref, connectFactory } = deps;
  const servers = (): McpServer[] => getPrefs()['mcp.servers'];
  const disabled = (): string[] => getPrefs()['mcp.disabledTools'];
  const writeServers = (next: McpServer[]): void => setPref('mcp.servers', next);
  const serverActive = (id: string): boolean => servers().find((s) => s.id === id)?.active ?? false;
  const syncDisabled = (): void => manager.setDisabled(disabled());

  return {
    'mcp.getConfig': async (_p: Record<string, never>) => {
      syncDisabled();
      return {
        servers: servers(),
        tools: manager.discoveredTools(serverActive),
        status: manager.status(),
      };
    },

    'mcp.upsertServer': async (p: { server: McpServer }) => {
      const server = McpServerSchema.parse(p.server);
      validateMcpServer(server);
      const list = servers();
      const idx = list.findIndex((s) => s.id === server.id);
      writeServers(
        idx >= 0 ? list.map((s) => (s.id === server.id ? server : s)) : [...list, server],
      );
      await manager.disconnectServer(server.id);
      if (server.active) await manager.connectServer(server);
      return { ok: true as const, id: server.id };
    },

    'mcp.deleteServer': async (p: { id: string }) => {
      writeServers(servers().filter((s) => s.id !== p.id));
      await manager.disconnectServer(p.id);
      return { ok: true as const };
    },

    'mcp.testServer': async (p: { server: McpServer }) => {
      const server = McpServerSchema.parse(p.server);
      try {
        validateMcpServer(server);
      } catch (e) {
        return { ok: false, tools: [], error: e instanceof Error ? e.message : String(e) };
      }
      // 临时 manager 探连，不污染主表。
      const probe = new McpManager({ connectFactory });
      await probe.connectServer({ ...server, id: '__probe__' });
      const st = probe.status()['__probe__'];
      const tools = probe.discoveredTools(() => true);
      await probe.disconnectServer('__probe__');
      if (st && !st.connected) {
        return { ok: false, tools: [], error: st.errlogs.join('; ') };
      }
      return { ok: true, tools };
    },

    'mcp.setServerActive': async (p: { id: string; active: boolean }) => {
      writeServers(servers().map((s) => (s.id === p.id ? { ...s, active: p.active } : s)));
      const s = servers().find((x) => x.id === p.id);
      if (s) {
        if (p.active) await manager.connectServer(s);
        else await manager.disconnectServer(p.id);
      }
      return { ok: true as const };
    },

    'mcp.setToolActive': async (p: { serverId: string; toolName: string; active: boolean }) => {
      const key = toolKey(p.serverId, p.toolName);
      const cur = new Set(disabled());
      if (p.active) cur.delete(key);
      else cur.add(key);
      setPref('mcp.disabledTools', [...cur]);
      manager.setDisabled([...cur]);
      return { ok: true as const };
    },

    /** 启动：连接已存的 active server。 */
    async init(): Promise<void> {
      syncDisabled();
      await manager.connectAll(servers());
    },
  };
}
