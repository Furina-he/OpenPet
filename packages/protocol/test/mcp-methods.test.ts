import { describe, it, expect } from 'vitest';
import { Methods } from '../src/methods.js';
import { PrefsSchema } from '../src/prefs.js';

describe('prefs mcp 键', () => {
  it('默认空 servers/disabledTools', () => {
    const p = PrefsSchema.parse({});
    expect(p['mcp.servers']).toEqual([]);
    expect(p['mcp.disabledTools']).toEqual([]);
  });
});

describe('mcp.* 方法注册', () => {
  it('6 方法齐备', () => {
    for (const m of [
      'mcp.getConfig',
      'mcp.upsertServer',
      'mcp.deleteServer',
      'mcp.testServer',
      'mcp.setServerActive',
      'mcp.setToolActive',
    ]) {
      expect(m in Methods).toBe(true);
    }
  });
  it('setToolActive params 校验', () => {
    expect(
      Methods['mcp.setToolActive'].params.safeParse({
        serverId: 's',
        toolName: 't',
        active: false,
      }).success,
    ).toBe(true);
  });
  it('getConfig result 含 servers/tools/status', () => {
    const r = Methods['mcp.getConfig'].result.safeParse({
      servers: [],
      tools: [],
      status: {},
    });
    expect(r.success).toBe(true);
  });
});
