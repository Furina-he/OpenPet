import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DesktopPluginManifestSchema } from '@openpet/protocol';
import { DesktopPluginHost } from '../electron/main/plugins/desktop-plugin-host';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PLUGIN_WORKER_ENTRY = require.resolve('@openpet/sidecar/dist/plugin-entry.js');
const DEMO = path.join(__dirname, 'fixtures/host-demo-plugin.mjs');
const CRASH = path.join(__dirname, 'fixtures/host-crash-plugin.mjs');

const demoManifest = DesktopPluginManifestSchema.parse({
  id: 'demo',
  name: 'Demo',
  version: '1.0.0',
  engine: 'desktop',
  permissions: ['tools', 'cues', 'say', 'fetch'],
});

type Status = { runtime: string; id: string; status: string; lastError?: string };

function until<T>(probe: () => T | undefined, timeoutMs = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = (): void => {
      const v = probe();
      if (v !== undefined) return resolve(v);
      if (Date.now() - started > timeoutMs) return reject(new Error('until timeout'));
      setTimeout(tick, 20);
    };
    tick();
  });
}

interface Harness {
  host: DesktopPluginHost;
  statuses: Status[];
  says: string[];
  fetches: Array<{ url: string }>;
}

let active: DesktopPluginHost | null = null;

function makeHost(over: Partial<ConstructorParameters<typeof DesktopPluginHost>[0]> = {}): Harness {
  const statuses: Status[] = [];
  const says: string[] = [];
  const fetches: Array<{ url: string }> = [];
  const host = new DesktopPluginHost({
    entryPath: PLUGIN_WORKER_ENTRY,
    broadcast: (channel, params) => {
      if (channel === 'plugin.status') statuses.push(params as Status);
    },
    say: (text) => says.push(text),
    proxyFetch: (url) => {
      fetches.push({ url });
      return Promise.resolve({ status: 200, body: 'pong' });
    },
    getConfig: () => ({}),
    delay: () => Promise.resolve(),
    ...over,
  });
  active = host;
  return { host, statuses, says, fetches };
}

afterEach(async () => {
  await active?.stopAll();
  active = null;
});

describe('DesktopPluginHost', () => {
  it('ready 后 activeToolDefs 带 wire 名 + cues 过 Zod + say 落点', async () => {
    const h = makeHost();
    h.host.start(demoManifest, '/x/demo', DEMO);
    await until(() => (h.host.activeToolDefs().length > 0 ? true : undefined));
    const names = h.host.activeToolDefs().map((t) => t.name);
    expect(names).toContain('p_demo_echo');
    expect(names).toContain('p_demo_fetchit');
    expect(h.host.activeCues()).toEqual([{ on: 'chat.done', say: ['plugin cue hi'] }]);
    await until(() => (h.says.includes('hi from plugin') ? true : undefined));
    expect(h.statuses.at(-1)).toMatchObject({ runtime: 'desktop', id: 'demo', status: 'running' });
  });

  it('callTool wire 名 → worker local 名执行 → JSON 回包；未知工具 reject', async () => {
    const h = makeHost();
    h.host.start(demoManifest, '/x/demo', DEMO);
    await until(() => (h.host.ownsTool('p_demo_echo') ? true : undefined));
    const out = await h.host.callTool('p_demo_echo', { a: 1 });
    expect(JSON.parse(out)).toEqual({ echoed: { a: 1 } });
    await expect(h.host.callTool('p_demo_nope', {})).rejects.toThrow('no plugin owns tool');
    expect(h.host.ownsTool('p_demo_echo')).toBe(true);
    expect(h.host.ownsTool('mcp/other')).toBe(false);
  });

  it('fetchRequest → proxyFetch → fetchResult 回 worker', async () => {
    const h = makeHost();
    h.host.start(demoManifest, '/x/demo', DEMO);
    await until(() => (h.host.ownsTool('p_demo_fetchit') ? true : undefined));
    const out = await h.host.callTool('p_demo_fetchit', { url: 'https://x.test/' });
    expect(JSON.parse(out)).toEqual({ status: 200, body: 'pong' });
    expect(h.fetches).toEqual([{ url: 'https://x.test/' }]);
  });

  it('工具触发崩溃 → restarting 广播 → 自动重启回 running；在途 waiter 被 reject', async () => {
    const h = makeHost();
    h.host.start(demoManifest, '/x/demo', DEMO);
    await until(() => (h.host.ownsTool('p_demo_boom') ? true : undefined));
    await expect(h.host.callTool('p_demo_boom', {})).rejects.toThrow('plugin worker exited');
    await until(() =>
      h.statuses.some((s) => s.status === 'restarting') ? true : undefined,
    );
    // 重启后再次 ready（第二个 running 广播）且工具可用
    await until(() =>
      h.statuses.filter((s) => s.status === 'running').length >= 2 ? true : undefined,
    );
    const out = await h.host.callTool('p_demo_echo', { b: 2 });
    expect(JSON.parse(out)).toEqual({ echoed: { b: 2 } });
  });

  it('crash-on-start → 重启机会耗尽 → error 广播 + statuses() error + 不再重启', async () => {
    const h = makeHost({ restartDelays: [0, 0] });
    const crashManifest = DesktopPluginManifestSchema.parse({
      id: 'crashy',
      name: 'Crashy',
      version: '1.0.0',
      engine: 'desktop',
    });
    h.host.start(crashManifest, '/x/crashy', CRASH);
    const err = await until(
      () => h.statuses.find((s) => s.status === 'error'),
      8000,
    );
    expect(err.lastError).toContain('restarts exhausted');
    expect(h.statuses.filter((s) => s.status === 'restarting')).toHaveLength(2);
    expect(h.host.statuses()).toEqual([
      { id: 'crashy', status: 'error', lastError: expect.stringContaining('restarts exhausted') },
    ]);
    expect(h.host.activeToolDefs()).toEqual([]);
    expect(h.host.activeCues()).toEqual([]);
  });

  it('stop 后 worker 退出不触发重启', async () => {
    const h = makeHost();
    h.host.start(demoManifest, '/x/demo', DEMO);
    await until(() => (h.host.ownsTool('p_demo_echo') ? true : undefined));
    await h.host.stop('demo');
    await new Promise((r) => setTimeout(r, 100));
    expect(h.statuses.some((s) => s.status === 'restarting')).toBe(false);
    expect(h.host.statuses()).toEqual([]);
    expect(h.host.ownsTool('p_demo_echo')).toBe(false);
  });
});
