import { describe, it, expect } from 'vitest';
import { createPluginGateway } from '../electron/main/plugin-gateway';
import type { PluginRequestFrame } from '@desksoul/protocol';

function frame(id: number, method: string, params?: unknown): PluginRequestFrame {
  return {
    kind: 'plugin.request',
    rpc: { jsonrpc: '2.0', id, method, ...(params !== undefined ? { params } : {}) },
  };
}

describe('PluginGateway', () => {
  it('registers a skill and acks; the registry is observable', async () => {
    const g = createPluginGateway();
    const res = await g.handle(frame(1, 'plugin.registerSkill', { skillId: 'demo', title: 'Demo' }));
    expect(res).toEqual({
      kind: 'plugin.response',
      rpc: { jsonrpc: '2.0', id: 1, result: { ok: true } },
    });
    expect(g.skills.get('demo')).toEqual({ title: 'Demo' });
  });

  it('denies permission requests by default (M2 policy)', async () => {
    const g = createPluginGateway();
    const res = await g.handle(frame(2, 'plugin.permissionRequest', { permission: 'net.fetch' }));
    expect(res.rpc.result).toEqual({ granted: false });
  });

  it('honors a custom permissionPolicy', async () => {
    const g = createPluginGateway({ permissionPolicy: (req) => req.permission === 'fs.read' });
    const yes = await g.handle(frame(3, 'plugin.permissionRequest', { permission: 'fs.read' }));
    const no = await g.handle(frame(4, 'plugin.permissionRequest', { permission: 'net.fetch' }));
    expect(yes.rpc.result).toEqual({ granted: true });
    expect(no.rpc.result).toEqual({ granted: false });
  });

  it('invokes a registered tool and wraps its return as {value}', async () => {
    const g = createPluginGateway({ tools: new Map([['echo', (args: unknown) => args]]) });
    const res = await g.handle(frame(5, 'plugin.invokeTool', { toolId: 'echo', args: { hi: 1 } }));
    expect(res.rpc.result).toEqual({ value: { hi: 1 } });
  });

  it('answers -32601 for a missing tool', async () => {
    const g = createPluginGateway();
    const res = await g.handle(frame(6, 'plugin.invokeTool', { toolId: 'nope' }));
    expect(res.rpc.error?.code).toBe(-32601);
  });

  it('answers -32602 on schema violation', async () => {
    const g = createPluginGateway();
    const res = await g.handle(frame(7, 'plugin.registerSkill', { skillId: 42 }));
    expect(res.rpc.error?.code).toBe(-32602);
  });

  it('answers -32601 for non-plugin namespaces (chat.* must not be reachable from workers)', async () => {
    const g = createPluginGateway();
    const res = await g.handle(frame(8, 'chat.send', { sessionId: 's1', text: 'x' }));
    expect(res.rpc.error?.code).toBe(-32601);
  });

  it('mirrors the request id and never rejects (errors travel inside the frame)', async () => {
    const g = createPluginGateway({
      tools: new Map([
        [
          'boom',
          () => {
            throw new Error('tool exploded');
          },
        ],
      ]),
    });
    const res = await g.handle(frame(99, 'plugin.invokeTool', { toolId: 'boom' }));
    expect(res.rpc.id).toBe(99);
    expect(res.rpc.error).toEqual({ code: -32000, message: 'tool exploded' });
  });
});
