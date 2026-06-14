import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PluginHost } from '../electron/main/plugin-host.js';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Real sidecar worker entry — the same file Main resolves in production.
const sidecarEntry = require.resolve('@desksoul/sidecar/dist/worker-entry.js');
// Fixture that throws on start, to exercise backoff escalation.
const crashEntry = path.join(__dirname, 'fixtures', 'crash-worker.mjs');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let host: PluginHost | null = null;
afterEach(async () => {
  await host?.dispose();
  host = null;
});

describe('PluginHost ↔ sidecar worker', () => {
  // 判据1: Renderer→Main→Worker→Main 往返
  it('round-trips sys.ping through the worker', async () => {
    host = new PluginHost(sidecarEntry);
    const res = await host.call('sys.ping', { nonce: 'a' });
    expect(res).toEqual({ pong: 'ok', echoNonce: 'a' });
  });

  // 判据2+3: terminate 模拟崩溃 → 退避重启 → 重启后仍可调用
  it('reconnects after terminate and serves calls again', async () => {
    host = new PluginHost(sidecarEntry, { baseBackoffMs: 200 });
    expect(await host.call('sys.ping', { nonce: 'a' })).toMatchObject({ echoNonce: 'a' });

    host.terminate();
    await sleep(500); // > base backoff, lets respawn settle

    expect(await host.call('sys.ping', { nonce: 'b' })).toMatchObject({ echoNonce: 'b' });
  });

  // 判据4: 连续崩溃时退避指数递增(健康响应才会重置)
  it('escalates backoff exponentially while the worker keeps crashing', async () => {
    const waits: number[] = [];
    host = new PluginHost(crashEntry, {
      baseBackoffMs: 50,
      maxBackoffMs: 10_000,
      onRespawnScheduled: (ms) => waits.push(ms),
    });

    // crash-on-start → respawn → crash → ... let a few cycles accrue
    // CI may be slower; allow up to 1500ms for 3 cycles (same tolerance as provider-host watchdog).
    await sleep(1500);

    expect(waits.length).toBeGreaterThanOrEqual(3);
    expect(waits[0]).toBe(50);
    expect(waits[1]).toBe(100);
    expect(waits[2]).toBe(200);
  });

  // 判据4(封顶): 退避不超过 max
  it('caps backoff at maxBackoffMs', async () => {
    const waits: number[] = [];
    host = new PluginHost(crashEntry, {
      baseBackoffMs: 50,
      maxBackoffMs: 120,
      onRespawnScheduled: (ms) => waits.push(ms),
    });
    await sleep(700);
    expect(Math.max(...waits)).toBeLessThanOrEqual(120);
  });

  // 判据5: worker 抛未捕获异常,host(本进程)不退出,仍能继续工作
  it('survives worker crash — host process stays alive and recovers', async () => {
    host = new PluginHost(sidecarEntry, { baseBackoffMs: 100 });
    await host.call('sys.ping', { nonce: 'before' });

    host.terminate();
    await sleep(400);

    // if the host process had died, this line would never run
    expect(await host.call('sys.ping', { nonce: 'after' })).toMatchObject({
      echoNonce: 'after',
    });
  });

  // pending 调用在 worker 死亡时被 reject,不会永久挂起
  it('rejects in-flight calls when the worker dies', async () => {
    host = new PluginHost(sidecarEntry, { baseBackoffMs: 100 });
    await host.call('sys.ping', { nonce: 'warmup' });

    const inflight = host.call('sys.ping', { nonce: 'doomed' });
    host.terminate();
    await expect(inflight).rejects.toThrow(/worker died/);
  });
});
