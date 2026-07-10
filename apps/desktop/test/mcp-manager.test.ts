import { describe, it, expect, vi } from 'vitest';
import { McpManager, type McpClientLike } from '../electron/main/mcp-manager';
import { McpServerSchema, type McpServer } from '@openpet/protocol';

function fakeClient(
  tools: Array<{ name: string; inputSchema?: unknown }>,
  onCall?: (n: string, a: unknown) => { content?: { type: string; text?: string }[]; isError?: boolean },
): McpClientLike {
  return {
    connect: async () => {},
    listTools: async () => ({ tools }),
    callTool: async ({ name, arguments: a }) =>
      onCall?.(name, a) ?? { content: [{ type: 'text', text: `ran ${name}` }] },
    close: async () => {},
  };
}
const srv = (o: Partial<McpServer> & { id: string; name: string }): McpServer =>
  McpServerSchema.parse(o);
const always = (): boolean => true;

describe('McpManager', () => {
  it('connect → discoveredTools / activeToolDefs', async () => {
    const m = new McpManager({
      connectFactory: async () => ({
        client: fakeClient([{ name: 'web', inputSchema: { type: 'object' } }]),
      }),
    });
    await m.connectAll([srv({ id: 's1', name: 'S1' })]);
    expect(m.discoveredTools(always).map((t) => t.name)).toEqual(['web']);
    expect(m.activeToolDefs(always)).toEqual([
      { name: 'web', description: '', parameters: { type: 'object' } },
    ]);
  });

  it('setDisabled 剔除工具出 activeToolDefs', async () => {
    const m = new McpManager({
      connectFactory: async () => ({ client: fakeClient([{ name: 'web' }]) }),
    });
    await m.connectAll([srv({ id: 's1', name: 'S1' })]);
    m.setDisabled(['s1/web']);
    expect(m.activeToolDefs(always)).toEqual([]);
    expect(m.discoveredTools(always)[0]!.active).toBe(false);
  });

  it('server inactive → 工具 active=false', async () => {
    const m = new McpManager({
      connectFactory: async () => ({ client: fakeClient([{ name: 'web' }]) }),
    });
    await m.connectAll([srv({ id: 's1', name: 'S1' })]);
    expect(m.activeToolDefs((id) => id !== 's1')).toEqual([]);
  });

  it('callTool 拼接 text content', async () => {
    const m = new McpManager({
      connectFactory: async () => ({
        client: fakeClient([{ name: 'web' }], () => ({ content: [{ type: 'text', text: 'hi' }] })),
      }),
    });
    await m.connectAll([srv({ id: 's1', name: 'S1' })]);
    expect(await m.callTool('web', { q: 'x' })).toBe('hi');
  });

  it('callTool isError 抛', async () => {
    const m = new McpManager({
      connectFactory: async () => ({
        client: fakeClient([{ name: 'web' }], () => ({
          content: [{ type: 'text', text: 'boom' }],
          isError: true,
        })),
      }),
    });
    await m.connectAll([srv({ id: 's1', name: 'S1' })]);
    await expect(m.callTool('web', {})).rejects.toThrow('boom');
  });

  it('连接失败进 errlogs，不抛', async () => {
    const m = new McpManager({
      connectFactory: async () => {
        throw new Error('spawn failed');
      },
    });
    await m.connectAll([srv({ id: 's1', name: 'S1' })]);
    expect(m.status()['s1']).toMatchObject({ connected: false });
    expect(m.status()['s1']!.errlogs[0]).toContain('spawn failed');
  });

  it('工具名冲突：第二 server 跳过 + errlog', async () => {
    const m = new McpManager({
      connectFactory: async () => ({ client: fakeClient([{ name: 'web' }]) }),
    });
    await m.connectAll([srv({ id: 's1', name: 'S1' }), srv({ id: 's2', name: 'S2' })]);
    expect(m.discoveredTools(always).filter((t) => t.name === 'web')).toHaveLength(1);
    expect(m.status()['s2']!.errlogs.some((l) => l.includes('conflict'))).toBe(true);
  });

  it('disconnectServer 清工具 + 释放 owner', async () => {
    const m = new McpManager({
      connectFactory: async () => ({ client: fakeClient([{ name: 'web' }]) }),
    });
    await m.connectAll([srv({ id: 's1', name: 'S1' })]);
    await m.disconnectServer('s1');
    expect(m.discoveredTools(always)).toEqual([]);
    await expect(m.callTool('web', {})).rejects.toThrow();
  });
});

describe('#6 断线重连监督', () => {
  const SERVER = srv({ id: 's1', name: 'S1' });
  function makeClient(): McpClientLike {
    return {
      connect: async () => {},
      listTools: async () => ({ tools: [{ name: 't1' }] }),
      callTool: async () => ({ content: [] }),
      close: async () => {},
    };
  }

  it('意外断线 → 退避重连并恢复（失败一次后成功）', async () => {
    const events: string[] = [];
    const clients: McpClientLike[] = [];
    let failNext = 0;
    const mgr = new McpManager({
      connectFactory: async () => {
        if (failNext > 0) {
          failNext -= 1;
          throw new Error('conn refused');
        }
        const c = makeClient();
        clients.push(c);
        return { client: c };
      },
      reconnectDelays: [0, 0, 0],
      onEvent: (a) => events.push(a),
    });
    await mgr.connectServer(SERVER);
    expect(mgr.status()[SERVER.id]?.connected).toBe(true);
    failNext = 1;
    clients[0]!.onclose?.(); // 模拟 server 进程崩溃
    await vi.waitFor(() => expect(mgr.status()[SERVER.id]?.connected).toBe(true));
    expect(events).toEqual(['mcp.disconnected', 'mcp.reconnected']);
    expect(clients).toHaveLength(2);
  });

  it('主动 disconnect 不触发重连', async () => {
    let connects = 0;
    const clients: McpClientLike[] = [];
    const mgr = new McpManager({
      connectFactory: async () => {
        connects += 1;
        const c = makeClient();
        clients.push(c);
        return { client: c };
      },
      reconnectDelays: [0],
    });
    await mgr.connectServer(SERVER);
    await mgr.disconnectServer(SERVER.id);
    clients[0]!.onclose?.(); // 真 SDK close() 会触发 onclose
    await new Promise((r) => setTimeout(r, 10));
    expect(connects).toBe(1);
  });

  it('连败到上限 → 放弃 + errlog + gaveUp 事件', async () => {
    const events: string[] = [];
    const clients: McpClientLike[] = [];
    let healthy = true;
    const mgr = new McpManager({
      connectFactory: async () => {
        if (!healthy) throw new Error('down');
        const c = makeClient();
        clients.push(c);
        return { client: c };
      },
      reconnectDelays: [0, 0],
      onEvent: (a) => events.push(a),
    });
    await mgr.connectServer(SERVER);
    healthy = false;
    clients[0]!.onclose?.();
    await vi.waitFor(() => expect(events).toContain('mcp.gaveUp'));
    expect(mgr.status()[SERVER.id]?.connected).toBe(false);
    expect(mgr.status()[SERVER.id]?.errlogs.join()).toContain('放弃');
  });
});
