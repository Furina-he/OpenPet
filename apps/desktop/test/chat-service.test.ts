import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ChatService } from '../electron/main/chat-service';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROVIDER_ENTRY = require.resolve('@desksoul/sidecar/dist/workers/provider-worker-entry.js');
const WEDGED_ENTRY = path.join(__dirname, 'fixtures/wedged-worker.mjs');
const CRASH_ENTRY = path.join(__dirname, 'fixtures/crash-worker.mjs');
const PLUGIN_ENTRY = path.join(__dirname, 'fixtures/plugin-worker.mjs');

type Sent = { channel: string; params: any };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function until(pred: () => boolean, what: string, timeoutMs = 4000): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timed out waiting for ${what}`)), timeoutMs);
    const tick = setInterval(() => {
      if (pred()) {
        clearTimeout(t);
        clearInterval(tick);
        resolve();
      }
    }, 5);
  });
}

function doneOf(sent: Sent[], sessionId: string): Sent | undefined {
  return sent.find((s) => s.channel === 'chat.done' && s.params.sessionId === sessionId);
}

let svc: ChatService | null = null;
afterEach(async () => {
  await svc?.dispose();
  svc = null;
});

describe('ChatService · 流式管线', () => {
  it('broadcasts seq-stamped clean chat.stream then chat.done; snapshot agrees', async () => {
    const sent: Sent[] = [];
    svc = new ChatService({
      providerEntryPath: PROVIDER_ENTRY,
      broadcast: (channel, params) => sent.push({ channel, params }),
      host: { intervalMs: 0 },
      queue: { flushIntervalMs: 5 },
    });
    svc.send('s1', '你好');
    await until(() => !!doneOf(sent, 's1'), 'chat.done');

    const streams = sent.filter((s) => s.channel === 'chat.stream');
    expect(streams.length).toBeGreaterThan(0);
    const text = streams.map((s) => s.params.text).join('');
    expect(text).toContain('热可可');
    expect(text).not.toMatch(/<emo:|<act:|\[intent/); // 干净文本
    const seqs = streams.map((s) => s.params.seq as number);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs); // 单调递增
    expect(sent.some((s) => s.channel === 'behavior.applyEmotion')).toBe(true); // 双轨仍在

    const snap = svc.snapshot('s1');
    expect(snap.messages).toEqual([
      { role: 'user', text: '你好', finishReason: null },
      { role: 'assistant', text, finishReason: 'stop' },
    ]);
    expect(snap.streaming).toBe(false);
    expect(snap.seq).toBe(seqs[seqs.length - 1]);
  });

  it('snapshot mid-stream reports streaming=true with accumulated partial text', async () => {
    const sent: Sent[] = [];
    svc = new ChatService({
      providerEntryPath: PROVIDER_ENTRY,
      broadcast: (channel, params) => sent.push({ channel, params }),
      host: { intervalMs: 40 },
      queue: { flushIntervalMs: 5 },
    });
    svc.send('s1', 'hi');
    await until(() => sent.some((s) => s.channel === 'chat.stream'), 'first delta');
    const snap = svc.snapshot('s1');
    expect(snap.streaming).toBe(true);
    expect(snap.messages[snap.messages.length - 1]!.finishReason).toBeNull();
    svc.cancel('s1');
    await until(() => !!doneOf(sent, 's1'), 'done after cancel');
  });
});

describe('ChatService · 取消三层传播', () => {
  it('stops the UI instantly: zero chat.stream broadcasts after cancel()', async () => {
    const sent: Sent[] = [];
    svc = new ChatService({
      providerEntryPath: PROVIDER_ENTRY,
      broadcast: (channel, params) => sent.push({ channel, params }),
      host: { intervalMs: 40 },
      queue: { flushIntervalMs: 5 },
    });
    svc.send('s1', 'hi');
    await until(() => sent.some((s) => s.channel === 'chat.stream'), 'first delta');
    svc.cancel('s1');
    const streamsAtCancel = sent.filter((s) => s.channel === 'chat.stream').length;
    await until(() => !!doneOf(sent, 's1'), 'cancel done');
    expect(doneOf(sent, 's1')!.params.finishReason).toBe('cancel');
    expect(sent.filter((s) => s.channel === 'chat.stream').length).toBe(streamsAtCancel);
    const snap = svc.snapshot('s1');
    expect(snap.messages[snap.messages.length - 1]!.finishReason).toBe('cancel');
  });

  it('force-terminates a wedged worker within the grace window', async () => {
    const sent: Sent[] = [];
    svc = new ChatService({
      providerEntryPath: WEDGED_ENTRY,
      broadcast: (channel, params) => sent.push({ channel, params }),
      host: { cancelGraceMs: 100 },
      queue: { flushIntervalMs: 5 },
    });
    svc.send('s1', 'hi');
    await until(() => sent.some((s) => s.channel === 'chat.stream'), 'wedged first delta');
    const t0 = Date.now();
    svc.cancel('s1');
    await until(() => !!doneOf(sent, 's1'), 'forced cancel done');
    expect(Date.now() - t0).toBeLessThan(1000); // 100ms grace + 余量
    expect(doneOf(sent, 's1')!.params.finishReason).toBe('cancel');
  });

  it('cancel on an idle session is a no-op that cannot poison the next stream', async () => {
    const sent: Sent[] = [];
    svc = new ChatService({
      providerEntryPath: PROVIDER_ENTRY,
      broadcast: (channel, params) => sent.push({ channel, params }),
      host: { intervalMs: 0 },
      queue: { flushIntervalMs: 5 },
    });
    expect(svc.cancel('s1')).toEqual({ ok: true }); // 无在途流
    svc.send('s1', 'hi');
    await until(() => !!doneOf(sent, 's1'), 'done');
    expect(doneOf(sent, 's1')!.params.finishReason).toBe('stop'); // 没被殃及
  });
});

describe('ChatService · 守卫与恢复', () => {
  it('rejects a second send on a streaming session with -32001', async () => {
    const sent: Sent[] = [];
    svc = new ChatService({
      providerEntryPath: PROVIDER_ENTRY,
      broadcast: (channel, params) => sent.push({ channel, params }),
      host: { intervalMs: 40 },
      queue: { flushIntervalMs: 5 },
    });
    svc.send('s1', 'a');
    try {
      svc.send('s1', 'b');
      expect.unreachable('second send should have thrown');
    } catch (e) {
      expect((e as { code?: number }).code).toBe(-32001);
    }
    svc.cancel('s1');
    await until(() => !!doneOf(sent, 's1'), 'cleanup done');
  });

  it('maps a missing worker to -32002 and records nothing', async () => {
    svc = new ChatService({
      providerEntryPath: CRASH_ENTRY,
      broadcast: () => {},
      host: { baseBackoffMs: 60_000 }, // 死后长退避 → send 时必然无 worker
    });
    await sleep(300); // 等 crash-worker 首死
    try {
      svc.send('s1', 'hi');
      expect.unreachable('send without a live worker should have thrown');
    } catch (e) {
      expect((e as { code?: number }).code).toBe(-32002);
    }
    expect(svc.snapshot('s1').messages).toEqual([]); // 失败的发送不进历史
  });

  it('worker death mid-stream seals the turn as error; history survives for snapshot', async () => {
    const sent: Sent[] = [];
    svc = new ChatService({
      providerEntryPath: PROVIDER_ENTRY,
      broadcast: (channel, params) => sent.push({ channel, params }),
      host: { intervalMs: 30, baseBackoffMs: 50 },
      queue: { flushIntervalMs: 5 },
    });
    svc.send('s1', 'hi');
    await until(() => sent.some((s) => s.channel === 'chat.stream'), 'first delta');
    svc.killWorkerForTest();
    await until(() => !!doneOf(sent, 's1'), 'error done');
    expect(doneOf(sent, 's1')!.params.finishReason).toBe('error');
    const snap = svc.snapshot('s1');
    expect(snap.messages[0]).toEqual({ role: 'user', text: 'hi', finishReason: null });
    expect(snap.messages[1]!.finishReason).toBe('error');
  });

  it('persists across service restarts (Main 重启的 chat.snapshot 数据源)', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'desksoul-svc-')), 'sessions.json');
    const sent: Sent[] = [];
    svc = new ChatService({
      providerEntryPath: PROVIDER_ENTRY,
      broadcast: (channel, params) => sent.push({ channel, params }),
      host: { intervalMs: 0 },
      queue: { flushIntervalMs: 5 },
      persistPath: file,
    });
    svc.send('s1', '第一轮');
    await until(() => !!doneOf(sent, 's1'), 'done');
    await svc.dispose(); // 冲洗落盘

    svc = new ChatService({
      providerEntryPath: PROVIDER_ENTRY,
      broadcast: () => {},
      persistPath: file,
    });
    const snap = svc.snapshot('s1');
    expect(snap.messages[0]!.text).toBe('第一轮');
    expect(snap.messages[1]!.text).toContain('热可可');
    expect(snap.streaming).toBe(false);
  });

  it('wires the plugin gateway through to the worker', async () => {
    const sent: Sent[] = [];
    svc = new ChatService({
      providerEntryPath: PLUGIN_ENTRY,
      broadcast: (channel, params) => sent.push({ channel, params }),
      queue: { flushIntervalMs: 5 },
      plugins: { tools: new Map([['echo', (args: unknown) => args]]) },
    });
    svc.send('p1', 'x');
    await until(() => !!doneOf(sent, 'p1'), 'plugin fixture done');
    const text = sent
      .filter((s) => s.channel === 'chat.stream')
      .map((s) => s.params.text)
      .join('');
    expect(JSON.parse(text).echo).toEqual({ value: { hi: 1 } });
    expect(svc.plugins.skills.get('demo')).toEqual({ title: 'Demo Skill' });
  });
});

describe('ChatService · fetch gateway (M5)', () => {
  const FETCH_ENTRY = path.join(__dirname, 'fixtures/fetch-worker.mjs');
  it('wires fetch gateway: worker fetch gets auth-injected and streamed back', async () => {
    const sent: Sent[] = [];
    svc = new ChatService({
      providerEntryPath: FETCH_ENTRY,
      broadcast: (channel, params) => sent.push({ channel, params }),
      queue: { flushIntervalMs: 5 },
      fetch: {
        agent: (spec, sink) => {
          sink.head(200, {});
          sink.data(spec.headers.authorization ?? 'noauth');
          sink.end();
        },
        resolveHost: () => ({ providerId: 'openai' }),
        injectAuth: async (_id, h) => ({ ...h, authorization: 'Bearer injected' }),
      },
    });
    svc.send('s1', 'hi');
    await until(() => !!doneOf(sent, 's1'), 'fetch worker done');
    const streamed = sent
      .filter((s) => s.channel === 'chat.stream')
      .map((s) => s.params.text)
      .join('');
    expect(streamed).toContain('Bearer injected');
  });
});

describe('ChatService · assembles messages (M5)', () => {
  const ECHO_ENTRY = path.join(__dirname, 'fixtures/echo-start-worker.mjs');
  it('assembles messages from history + current text', async () => {
    const sent: Sent[] = [];
    svc = new ChatService({
      providerEntryPath: ECHO_ENTRY,
      broadcast: (channel, params) => sent.push({ channel, params }),
      defaultProviderId: 'openai',
      queue: { flushIntervalMs: 5 },
    });
    svc.send('s1', 'first');
    await until(() => sent.filter((s) => s.channel === 'chat.done').length === 1, 'first done');
    svc.send('s1', 'second');
    await until(() => sent.filter((s) => s.channel === 'chat.done').length === 2, 'second done');
    const lastStream = sent.filter((s) => s.channel === 'chat.stream').at(-1)!;
    const parsed = JSON.parse(Buffer.from(lastStream.params.text.slice(4), 'base64').toString('utf8'));
    const roles = parsed.request.messages.map((m: { role: string }) => m.role);
    expect(roles).toEqual(['user', 'assistant', 'user']);
    expect(parsed.request.messages.at(-1)).toEqual({ role: 'user', content: 'second' });
    expect(parsed.providerId).toBe('openai');
  });
});

describe('ChatService · openai-format end-to-end (M5)', () => {
  it('streams an openai-format reply via injected agent to chat.stream', async () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"你好"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"呀"}}]}\n\n',
      'data: [DONE]\n\n',
    ];
    const sent: Sent[] = [];
    svc = new ChatService({
      providerEntryPath: PROVIDER_ENTRY,
      broadcast: (channel, params) => sent.push({ channel, params }),
      defaultProviderId: 'openai',
      queue: { flushIntervalMs: 5 },
      fetch: {
        agent: (_spec, sink) => {
          sink.head(200, { 'content-type': 'text/event-stream' });
          for (const l of sse) sink.data(l);
          sink.end();
        },
        resolveHost: () => ({ providerId: 'openai' }),
        injectAuth: async (_id, h) => h,
      },
    });
    svc.send('s1', 'hi');
    await until(() => !!doneOf(sent, 's1'), 'e2e done');
    const text = sent
      .filter((s) => s.channel === 'chat.stream')
      .map((s) => s.params.text)
      .join('');
    expect(text).toBe('你好呀');
    expect(doneOf(sent, 's1')!.params.finishReason).toBe('stop');
  });
});

describe('ChatService · usage 落账 (M5)', () => {
  it('records usage from the stream without emitting it as chat text', async () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":1}}\n\n',
      'data: [DONE]\n\n',
    ];
    const sent: Sent[] = [];
    svc = new ChatService({
      providerEntryPath: PROVIDER_ENTRY,
      broadcast: (c, p) => sent.push({ channel: c, params: p }),
      defaultProviderId: 'openai',
      queue: { flushIntervalMs: 5 },
      fetch: {
        agent: (_s, sink) => {
          sink.head(200, {});
          for (const l of sse) sink.data(l);
          sink.end();
        },
        resolveHost: () => ({ providerId: 'openai' }),
        injectAuth: async (_i, h) => h,
      },
    });
    svc.send('s1', 'hi');
    await until(() => !!doneOf(sent, 's1'), 'usage done');
    const text = sent
      .filter((s) => s.channel === 'chat.stream')
      .map((s) => s.params.text)
      .join('');
    expect(text).toBe('hi'); // usage 不出现在文本里
    expect(svc.snapshot('s1').messages.at(-1)).toMatchObject({ tokensIn: 5, tokensOut: 1 });
  });
});

describe('ChatService · provider fallback (M5)', () => {
  const FB_ENTRY = path.join(__dirname, 'fixtures/fallback-worker.mjs');

  it('falls back to the next provider when the first errors before any delta', async () => {
    const sent: Sent[] = [];
    svc = new ChatService({
      providerEntryPath: FB_ENTRY,
      broadcast: (c, p) => sent.push({ channel: c, params: p }),
      providerChain: ['bad', 'good'],
      queue: { flushIntervalMs: 5 },
    });
    svc.send('s1', 'hi');
    await until(() => !!doneOf(sent, 's1'), 'fallback done');
    const text = sent
      .filter((s) => s.channel === 'chat.stream')
      .map((s) => s.params.text)
      .join('');
    expect(text).toBe('ok');
    expect(doneOf(sent, 's1')!.params.finishReason).toBe('stop');
  });

  it('does NOT fall back once a delta has been emitted', async () => {
    const sent: Sent[] = [];
    svc = new ChatService({
      providerEntryPath: FB_ENTRY,
      broadcast: (c, p) => sent.push({ channel: c, params: p }),
      providerChain: ['good', 'bad'],
      queue: { flushIntervalMs: 5 },
    });
    svc.send('s1', 'hi');
    await until(() => !!doneOf(sent, 's1'), 'good done');
    const dones = sent.filter((s) => s.channel === 'chat.done');
    expect(dones).toHaveLength(1);
    expect(dones[0].params.finishReason).toBe('stop');
  });
});

describe('ChatService · tool_call 回灌 (M5)', () => {
  const TOOL_ENTRY = path.join(__dirname, 'fixtures/tool-worker.mjs');
  it('executes a tool_call via gateway then re-prompts once with the result', async () => {
    const sent: Sent[] = [];
    svc = new ChatService({
      providerEntryPath: TOOL_ENTRY,
      broadcast: (c, p) => sent.push({ channel: c, params: p }),
      providerChain: ['openai'],
      queue: { flushIntervalMs: 5 },
      plugins: { tools: new Map([['echo', (args: unknown) => `echoed:${JSON.stringify(args)}`]]) },
    });
    svc.send('s1', 'use a tool');
    await until(() => !!doneOf(sent, 's1'), 'reprompt done');
    const text = sent
      .filter((s) => s.channel === 'chat.stream')
      .map((s) => s.params.text)
      .join('');
    expect(text).toContain('result=echoed:');
    const dones = sent.filter((s) => s.channel === 'chat.done');
    expect(dones).toHaveLength(1); // 回灌轮的 done 才广播；首轮 tool_call 的 done 被吞
  });
});
