import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChatEvent } from '@desksoul/protocol';
import { ProviderHost } from '../electron/main/provider-host';
import { createPluginGateway } from '../electron/main/plugin-gateway';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PROVIDER_ENTRY = require.resolve('@desksoul/sidecar/dist/workers/provider-worker-entry.js');
const WEDGED_ENTRY = path.join(__dirname, 'fixtures/wedged-worker.mjs');
const CRASH_ENTRY = path.join(__dirname, 'fixtures/crash-worker.mjs');
const PLUGIN_ENTRY = path.join(__dirname, 'fixtures/plugin-worker.mjs');

type Collected = { sessionId: string; event: ChatEvent };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let host: ProviderHost | null = null;
afterEach(async () => {
  await host?.dispose();
  host = null;
});

function untilEvent(
  events: Collected[],
  pred: (e: Collected) => boolean,
  timeoutMs = 4000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timed out waiting for event')), timeoutMs);
    const tick = setInterval(() => {
      if (events.some(pred)) {
        clearTimeout(t);
        clearInterval(tick);
        resolve();
      }
    }, 5);
  });
}

function untilDone(events: Collected[], sessionId: string, timeoutMs = 4000): Promise<void> {
  return untilEvent(events, (e) => e.sessionId === sessionId && e.event.type === 'done', timeoutMs);
}

function doneOf(events: Collected[], sessionId: string): ChatEvent | undefined {
  return events.find((e) => e.sessionId === sessionId && e.event.type === 'done')?.event;
}

describe('ProviderHost · streaming (S4 semantics)', () => {
  it('streams a full reply over a real worker then a stop done', async () => {
    const events: Collected[] = [];
    host = new ProviderHost(PROVIDER_ENTRY, (sessionId, event) => events.push({ sessionId, event }), {
      intervalMs: 0,
    });
    host.send('sess-a');
    await untilDone(events, 'sess-a');

    expect(events.filter((e) => e.event.type === 'delta').length).toBeGreaterThan(0);
    expect(doneOf(events, 'sess-a')).toEqual({ type: 'done', finishReason: 'stop' });
  });

  it('cancels gracefully within the grace window (no force-terminate)', async () => {
    const events: Collected[] = [];
    let forced = false;
    host = new ProviderHost(PROVIDER_ENTRY, (sessionId, event) => events.push({ sessionId, event }), {
      intervalMs: 40,
      cancelGraceMs: 200,
      onForceTerminate: () => (forced = true),
    });
    host.send('sess-b');
    await sleep(60);
    host.cancel('sess-b');
    await untilDone(events, 'sess-b');

    expect(doneOf(events, 'sess-b')).toEqual({ type: 'done', finishReason: 'cancel' });
    expect(forced).toBe(false);
  });

  it('force-terminates a wedged worker and synthesizes a cancel done', async () => {
    const events: Collected[] = [];
    let forced = false;
    host = new ProviderHost(WEDGED_ENTRY, (sessionId, event) => events.push({ sessionId, event }), {
      cancelGraceMs: 100,
      onForceTerminate: () => (forced = true),
    });
    host.send('sess-c');
    await sleep(50);
    host.cancel('sess-c');
    await untilDone(events, 'sess-c');

    expect(forced).toBe(true);
    expect(doneOf(events, 'sess-c')).toEqual({ type: 'done', finishReason: 'cancel' });
  });

  it('keeps serving after a force-terminate respawn', async () => {
    const events: Collected[] = [];
    host = new ProviderHost(WEDGED_ENTRY, (sessionId, event) => events.push({ sessionId, event }), {
      cancelGraceMs: 100,
    });
    host.send('sess-d');
    await sleep(50);
    host.cancel('sess-d');
    await untilDone(events, 'sess-d');

    host.send('sess-e');
    await untilEvent(events, (e) => e.sessionId === 'sess-e' && e.event.type === 'delta');
  });

  it('error-dones sibling sessions when force-terminate kills the shared worker', async () => {
    const events: Collected[] = [];
    host = new ProviderHost(WEDGED_ENTRY, (sessionId, event) => events.push({ sessionId, event }), {
      cancelGraceMs: 80,
    });
    host.send('w1');
    host.send('w2');
    await untilEvent(events, (e) => e.sessionId === 'w2' && e.event.type === 'delta');
    host.cancel('w1');
    await untilDone(events, 'w1');
    await untilDone(events, 'w2');

    expect(doneOf(events, 'w1')).toEqual({ type: 'done', finishReason: 'cancel' });
    expect(doneOf(events, 'w2')).toEqual({ type: 'done', finishReason: 'error' });
  });
});

describe('ProviderHost · supervision (S2 semantics)', () => {
  it('synthesizes an error done when the worker dies mid-stream, then recovers', async () => {
    const events: Collected[] = [];
    host = new ProviderHost(PROVIDER_ENTRY, (sessionId, event) => events.push({ sessionId, event }), {
      intervalMs: 30,
      baseBackoffMs: 50,
    });
    host.send('s-crash');
    await untilEvent(events, (e) => e.sessionId === 's-crash' && e.event.type === 'delta');
    host.killWorkerForTest();
    await untilDone(events, 's-crash');
    expect(doneOf(events, 's-crash')).toEqual({ type: 'done', finishReason: 'error' });

    // 退避 50ms 后重生，新流可用
    await sleep(150);
    host.send('s-after');
    await untilDone(events, 's-after');
    expect(doneOf(events, 's-after')).toEqual({ type: 'done', finishReason: 'stop' });
  });

  it('escalates backoff exponentially while the worker keeps crashing', async () => {
    const waits: number[] = [];
    host = new ProviderHost(CRASH_ENTRY, () => {}, {
      baseBackoffMs: 50,
      maxBackoffMs: 10_000,
      onRespawnScheduled: (ms) => waits.push(ms),
    });
    await sleep(600);
    expect(waits.length).toBeGreaterThanOrEqual(3);
    expect(waits.slice(0, 3)).toEqual([50, 100, 200]);
  });

  it('caps backoff at maxBackoffMs', async () => {
    const waits: number[] = [];
    host = new ProviderHost(CRASH_ENTRY, () => {}, {
      baseBackoffMs: 50,
      maxBackoffMs: 120,
      onRespawnScheduled: (ms) => waits.push(ms),
    });
    await sleep(700);
    expect(Math.max(...waits)).toBeLessThanOrEqual(120);
    expect(waits).toContain(120);
  });

  it('resets backoff only after a healthy response (proof of life)', async () => {
    const waits: number[] = [];
    const events: Collected[] = [];
    host = new ProviderHost(PROVIDER_ENTRY, (sessionId, event) => events.push({ sessionId, event }), {
      intervalMs: 0,
      baseBackoffMs: 50,
      onRespawnScheduled: (ms) => waits.push(ms),
    });
    // 健康流 → backoff 重置为 base → 杀掉 → 第一次重启等待 = base
    host.send('h1');
    await untilDone(events, 'h1');
    host.killWorkerForTest();
    await sleep(150);
    // 再来一轮：健康 → 杀 → 等待仍应是 base（配合 escalates 用例共同钉死「只有响应才重置」）
    host.send('h2');
    await untilDone(events, 'h2');
    host.killWorkerForTest();
    await sleep(150);

    expect(waits).toEqual([50, 50]);
  });
});

describe('ProviderHost · plugin.* dispatch (M2)', () => {
  it('routes worker plugin requests through the gateway and back', async () => {
    const gateway = createPluginGateway({ tools: new Map([['echo', (args: unknown) => args]]) });
    const events: Collected[] = [];
    host = new ProviderHost(PLUGIN_ENTRY, (sessionId, event) => events.push({ sessionId, event }), {
      onPluginRequest: (f) => gateway.handle(f),
    });
    host.send('p1');
    await untilDone(events, 'p1');
    const delta = events.find((e) => e.event.type === 'delta')!.event as {
      type: 'delta';
      text: string;
    };
    expect(JSON.parse(delta.text)).toEqual({
      register: { ok: true },
      permission: { granted: false },
      echo: { value: { hi: 1 } },
      missing: { errorCode: -32601 },
      badParams: { errorCode: -32602 },
    });
    expect(gateway.skills.get('demo')).toEqual({ title: 'Demo Skill' });
  });

  it('answers -32601 to every plugin request when no gateway is wired', async () => {
    const events: Collected[] = [];
    host = new ProviderHost(PLUGIN_ENTRY, (sessionId, event) => events.push({ sessionId, event }));
    host.send('p2');
    await untilDone(events, 'p2');
    const delta = events.find((e) => e.event.type === 'delta')!.event as {
      type: 'delta';
      text: string;
    };
    const out = JSON.parse(delta.text);
    expect(out.register).toEqual({ errorCode: -32601 });
    expect(out.echo).toEqual({ errorCode: -32601 });
  });
});

describe('ProviderHost · fetch gateway dispatch (M5)', () => {
  const FETCH_ENTRY = path.join(__dirname, 'fixtures/fetch-worker.mjs');
  it('routes plugin.fetchRequest to onFetchRequest and streams chunks back', async () => {
    const events: Collected[] = [];
    host = new ProviderHost(
      FETCH_ENTRY,
      (sessionId, event) => events.push({ sessionId, event }),
      {
        onFetchRequest: (frame, send) => {
          send({ kind: 'plugin.fetchChunk', id: frame.id, phase: 'head', status: 200, headers: {} });
          send({ kind: 'plugin.fetchChunk', id: frame.id, phase: 'data', chunk: 'OK' });
          send({ kind: 'plugin.fetchChunk', id: frame.id, phase: 'end' });
        },
      },
    );
    host.send('fsess');
    await untilDone(events, 'fsess');
    const delta = events.find((e) => e.event.type === 'delta')!.event as {
      type: 'delta';
      text: string;
    };
    expect(delta.text).toBe('H200OK');
  });
});

describe('ProviderHost · send carries ChatRequest (M5)', () => {
  const ECHO_ENTRY = path.join(__dirname, 'fixtures/echo-start-worker.mjs');
  it('passes providerId + request into the chat.start frame', async () => {
    const events: Collected[] = [];
    host = new ProviderHost(ECHO_ENTRY, (sessionId, event) => events.push({ sessionId, event }));
    host.send('s1', {
      providerId: 'openai',
      request: { messages: [{ role: 'user', content: 'hi' }] },
    });
    await untilDone(events, 's1');
    const delta = events.find((e) => e.event.type === 'delta')!.event as {
      type: 'delta';
      text: string;
    };
    const parsed = JSON.parse(Buffer.from(delta.text.slice(4), 'base64').toString('utf8')); // 去掉 'REQ:'
    expect(parsed.providerId).toBe('openai');
    expect(parsed.request.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });
});
