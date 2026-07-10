import { describe, it, expect } from 'vitest';
import { createMcpService } from '../electron/main/mcp-service';
import { McpManager, type McpClientLike } from '../electron/main/mcp-manager';
import { DEFAULT_PREFS, type Prefs, type McpServer } from '@openpet/protocol';

function memPrefs(): {
  getPrefs: () => Prefs;
  setPref: (k: keyof Prefs, v: never) => void;
} {
  const state: Prefs = structuredClone(DEFAULT_PREFS);
  return {
    getPrefs: () => state,
    setPref: (k, v) => {
      (state as Record<string, unknown>)[k as string] = v;
    },
  };
}
const factory = async (): Promise<{ client: McpClientLike }> => ({
  client: {
    connect: async () => {},
    listTools: async () => ({ tools: [{ name: 'web', inputSchema: { type: 'object' } }] }),
    callTool: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
    close: async () => {},
  },
});
const baseServer: McpServer = {
  id: 's1',
  name: 'S1',
  transport: 'stdio',
  command: 'npx',
  args: [],
  env: {},
  url: '',
  headers: {},
  active: true,
  note: '',
};

function makeSvc() {
  const prefs = memPrefs();
  const manager = new McpManager({ connectFactory: factory });
  const svc = createMcpService({
    manager,
    getPrefs: prefs.getPrefs,
    setPref: prefs.setPref as never,
    connectFactory: factory,
  });
  return { prefs, manager, svc };
}

describe('mcp-service', () => {
  it('upsert → getConfig 见 server + 发现工具 + connected', async () => {
    const { svc } = makeSvc();
    await svc['mcp.upsertServer']({ server: baseServer });
    const cfg = await svc['mcp.getConfig']({});
    expect(cfg.servers.map((s) => s.id)).toEqual(['s1']);
    expect(cfg.tools.map((t) => t.name)).toEqual(['web']);
    expect(cfg.status['s1']).toMatchObject({ connected: true });
  });

  it('upsert 校验：stdio 缺 command 抛', async () => {
    const { svc } = makeSvc();
    await expect(
      svc['mcp.upsertServer']({ server: { ...baseServer, command: '' } }),
    ).rejects.toThrow();
  });

  it('setToolActive(false) → 工具 active=false + 写 disabledTools', async () => {
    const { svc, prefs } = makeSvc();
    await svc['mcp.upsertServer']({ server: baseServer });
    await svc['mcp.setToolActive']({ serverId: 's1', toolName: 'web', active: false });
    expect(prefs.getPrefs()['mcp.disabledTools']).toContain('s1/web');
    const cfg = await svc['mcp.getConfig']({});
    expect(cfg.tools.find((t) => t.name === 'web')!.active).toBe(false);
  });

  it('setServerActive(false) → 断开，工具消失', async () => {
    const { svc } = makeSvc();
    await svc['mcp.upsertServer']({ server: baseServer });
    await svc['mcp.setServerActive']({ id: 's1', active: false });
    const cfg = await svc['mcp.getConfig']({});
    expect(cfg.tools).toEqual([]);
    expect(cfg.status['s1']?.connected ?? false).toBe(false);
  });

  it('deleteServer 移除', async () => {
    const { svc } = makeSvc();
    await svc['mcp.upsertServer']({ server: baseServer });
    await svc['mcp.deleteServer']({ id: 's1' });
    expect((await svc['mcp.getConfig']({})).servers).toEqual([]);
  });

  it('testServer 返回工具不污染主表', async () => {
    const { svc } = makeSvc();
    const r = await svc['mcp.testServer']({ server: baseServer });
    expect(r.ok).toBe(true);
    expect(r.tools.map((t) => t.name)).toEqual(['web']);
    expect((await svc['mcp.getConfig']({})).servers).toEqual([]); // 未写入
  });

  it('init 连接已存 active server', async () => {
    const prefs = memPrefs();
    (prefs.getPrefs() as Record<string, unknown>)['mcp.servers'] = [baseServer];
    const manager = new McpManager({ connectFactory: factory });
    const svc = createMcpService({
      manager,
      getPrefs: prefs.getPrefs,
      setPref: prefs.setPref as never,
      connectFactory: factory,
    });
    await svc.init();
    expect((await svc['mcp.getConfig']({})).tools.map((t) => t.name)).toEqual(['web']);
  });
});
