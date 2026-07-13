import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ChatService } from '../electron/main/chat-service';
import { MemoryStore } from '../electron/main/db/memory-store';
import { createTraceCollector } from '../electron/main/trace-collector';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROVIDER_ENTRY = require.resolve('@openpet/sidecar/dist/workers/provider-worker-entry.js');
const WEDGED_ENTRY = path.join(__dirname, 'fixtures/wedged-worker.mjs');
const CRASH_ENTRY = path.join(__dirname, 'fixtures/crash-worker.mjs');
const PLUGIN_ENTRY = path.join(__dirname, 'fixtures/plugin-worker.mjs');
const PLAIN_ENTRY = path.join(__dirname, 'fixtures/plain-worker.mjs');

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
  it('批次⑥ 预算门：budgetGate 返回错误串 → send 抛 RpcError(-32003)，不产生任何流', async () => {
    const sent: Sent[] = [];
    svc = new ChatService({
      providerEntryPath: PROVIDER_ENTRY,
      broadcast: (channel, params) => sent.push({ channel, params }),
      host: { intervalMs: 0 },
      queue: { flushIntervalMs: 5 },
      budgetGate: () => '已达本月 token 预算上限',
    });
    try {
      svc.send('s1', 'hi');
      expect.unreachable('send should have thrown');
    } catch (e) {
      expect((e as { code?: number }).code).toBe(-32003);
    }
    await sleep(60);
    expect(sent.filter((s) => s.channel === 'chat.stream')).toEqual([]);
    expect(svc.snapshot('s1').messages).toEqual([]); // 被拦截的发送不进历史
  });

  it('批次⑥ 预算门：budgetGate 返回 null → 正常完成一轮', async () => {
    const sent: Sent[] = [];
    svc = new ChatService({
      providerEntryPath: PROVIDER_ENTRY,
      broadcast: (channel, params) => sent.push({ channel, params }),
      host: { intervalMs: 0 },
      queue: { flushIntervalMs: 5 },
      budgetGate: () => null,
    });
    svc.send('s1', '你好');
    await until(() => !!doneOf(sent, 's1'), 'chat.done');
    expect(doneOf(sent, 's1')!.params.finishReason).toBe('stop');
  });

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
    // send 变 async（§5）：host.send 不可用的 -32002 由 sendInner 抛 → rejected promise。
    await expect(svc.send('s1', 'hi')).rejects.toMatchObject({ code: -32002 });
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

  it('error done 时广播 behavior.applyEmotion(confused)（J3 角色歪头）', async () => {
    const sent: Sent[] = [];
    svc = new ChatService({
      providerEntryPath: PROVIDER_ENTRY,
      broadcast: (channel, params) => sent.push({ channel, params }),
      host: { intervalMs: 30, baseBackoffMs: 50 },
      queue: { flushIntervalMs: 5 },
      store: new MemoryStore(),
    });
    svc.send('s1', '你好');
    await until(() => sent.some((s) => s.channel === 'chat.stream'), 'first delta');
    svc.killWorkerForTest(); // 合成 finishReason:'error'
    await until(() => !!doneOf(sent, 's1'), 'error done');
    expect(doneOf(sent, 's1')!.params.finishReason).toBe('error');
    expect(
      sent.some((s) => s.channel === 'behavior.applyEmotion' && s.params.name === 'confused'),
    ).toBe(true);
  });

  it('reads history from the injected store across service restarts (chat.snapshot 数据源)', async () => {
    const store = new MemoryStore();
    const sent: Sent[] = [];
    svc = new ChatService({
      providerEntryPath: PROVIDER_ENTRY,
      broadcast: (channel, params) => sent.push({ channel, params }),
      host: { intervalMs: 0 },
      queue: { flushIntervalMs: 5 },
      store,
    });
    svc.send('s1', '第一轮');
    await until(() => !!doneOf(sent, 's1'), 'done');
    await svc.dispose();

    // 新 ChatService 复用同一 ConversationStore（模拟 Main 重启后从持久层重建视图）
    svc = new ChatService({ providerEntryPath: PROVIDER_ENTRY, broadcast: () => {}, store });
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
        injectAuth: async (_id, _url, h) => ({
          headers: { ...h, authorization: 'Bearer injected' },
        }),
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
    const parsed = JSON.parse(
      Buffer.from(lastStream.params.text.slice(4), 'base64').toString('utf8'),
    );
    const roles = parsed.request.messages.map((m: { role: string }) => m.role);
    expect(roles).toEqual(['system', 'user', 'assistant', 'user']); // M6 ContextAssembler 注入 system
    expect(parsed.request.messages[0].role).toBe('system');
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
        injectAuth: async (_id, _url, h) => ({ headers: h }),
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
        injectAuth: async (_i, _url, h) => ({ headers: h }),
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
  const CRASH_ON_SEND_ENTRY = path.join(__dirname, 'fixtures/crash-on-send-worker.mjs');

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

  it('seals an error done and still schedules respawn when the worker crashes before first delta (chain configured)', async () => {
    // 回归：onDeath 清算里的降级 re-send 遇到 worker 已死会抛错；若未捕获，会打断
    // 重生调度并让 session 永挂。这里钉死：本 session 收到 error done + 重生被调度。
    const sent: Sent[] = [];
    let respawns = 0;
    svc = new ChatService({
      providerEntryPath: CRASH_ON_SEND_ENTRY,
      broadcast: (c, p) => sent.push({ channel: c, params: p }),
      providerChain: ['bad', 'good'],
      queue: { flushIntervalMs: 5 },
      host: { baseBackoffMs: 50, onRespawnScheduled: () => respawns++ },
    });
    svc.send('s1', 'hi');
    await until(() => !!doneOf(sent, 's1'), 'sealed error done after crash', 2000);
    expect(doneOf(sent, 's1')!.params.finishReason).toBe('error');
    expect(respawns).toBeGreaterThanOrEqual(1);
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
    // §5：回灌请求尾部 = assistant(tool_calls) 载体 + tool(toolCallId) 规范序列（严格端点不再 400）。
    const tail = JSON.parse(text.split('|tail=')[1]!) as Array<Record<string, unknown>>;
    expect(tail[0]).toMatchObject({
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 't1', name: 'echo', argsJson: '{"v":42}' }],
    });
    expect(tail[1]).toMatchObject({ role: 'tool', content: 'echoed:{"v":42}', toolCallId: 't1' });
    const dones = sent.filter((s) => s.channel === 'chat.done');
    expect(dones).toHaveLength(1); // 回灌轮的 done 才广播；首轮 tool_call 的 done 被吞
  });
});

describe('ChatService · 状态层 persona (M6)', () => {
  it('persists messages to the injected store and evolves persona after a completed turn', async () => {
    const store = new MemoryStore();
    const sent: Sent[] = [];
    svc = new ChatService({
      providerEntryPath: PROVIDER_ENTRY,
      broadcast: (c, p) => sent.push({ channel: c, params: p }),
      host: { intervalMs: 0 },
      queue: { flushIntervalMs: 5 },
      store,
    });
    svc.send('s1', '你好');
    await until(() => !!doneOf(sent, 's1'), 'done');
    expect(store.recentMessages('default', 's1', 10)[0]).toMatchObject({
      role: 'user',
      text: '你好',
    });
    const persona = store.getPersonaState('default');
    expect(persona?.turns).toBe(1);
    expect(persona?.affinity).toBe(51); // 默认 50 + 1
  });

  it('does not evolve persona on a cancelled turn', async () => {
    const store = new MemoryStore();
    const sent: Sent[] = [];
    svc = new ChatService({
      providerEntryPath: PROVIDER_ENTRY,
      broadcast: (c, p) => sent.push({ channel: c, params: p }),
      host: { intervalMs: 40 },
      queue: { flushIntervalMs: 5 },
      store,
    });
    svc.send('s1', 'hi');
    await until(() => sent.some((s) => s.channel === 'chat.stream'), 'first delta');
    svc.cancel('s1');
    await until(() => !!doneOf(sent, 's1'), 'cancel done');
    expect(store.getPersonaState('default')).toBeNull(); // 取消不计一轮
  });

  it('storageUsage delegates to the injected store', async () => {
    const store = new MemoryStore();
    store.appendMessage({ characterId: 'default', sessionId: 's', role: 'user', text: 'x', ts: 1 });
    svc = new ChatService({ providerEntryPath: PROVIDER_ENTRY, broadcast: () => {}, store });
    expect(svc.storageUsage().messageCount).toBe(1);
  });
});

describe('ChatService · 动态角色解析（C 重构）', () => {
  it('persists under the current character, not the one captured at construction', async () => {
    const store = new MemoryStore();
    const sent: Sent[] = [];
    let charId = 'alice';
    svc = new ChatService({
      providerEntryPath: PROVIDER_ENTRY,
      broadcast: (c, p) => sent.push({ channel: c, params: p }),
      host: { intervalMs: 0 },
      queue: { flushIntervalMs: 5 },
      store,
      character: () => ({ id: charId, name: 'X' }),
    });
    svc.send('s1', 'hi-alice');
    await until(() => sent.filter((s) => s.channel === 'chat.done').length === 1, 'alice done');
    charId = 'bob';
    svc.send('s2', 'hi-bob');
    await until(() => sent.filter((s) => s.channel === 'chat.done').length === 2, 'bob done');

    expect(store.recentMessages('alice', 's1', 10).map((m) => m.text)).toContain('hi-alice');
    expect(store.recentMessages('bob', 's2', 10).map((m) => m.text)).toContain('hi-bob');
  });
});

describe('ChatService · C′ reasoning/tool 联动 (§3)', () => {
  const TOOL_ENTRY = path.join(__dirname, 'fixtures/tool-worker.mjs');

  it('routes reasoning to chat.reasoning + thinking cue; reasoning never leaks into chat.stream', async () => {
    const sse = [
      'data: {"choices":[{"delta":{"reasoning_content":"先想想"}}]}\n\n',
      'data: {"choices":[{"delta":{"reasoning_content":"再想想"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"你好呀"}}]}\n\n',
      'data: [DONE]\n\n',
    ];
    const sent: Sent[] = [];
    svc = new ChatService({
      providerEntryPath: PROVIDER_ENTRY,
      broadcast: (c, p) => sent.push({ channel: c, params: p }),
      defaultProviderId: 'openai',
      queue: { flushIntervalMs: 5 },
      fetch: {
        agent: (_spec, sink) => {
          sink.head(200, { 'content-type': 'text/event-stream' });
          for (const l of sse) sink.data(l);
          sink.end();
        },
        resolveHost: () => ({ providerId: 'openai' }),
        injectAuth: async (_id, _url, h) => ({ headers: h }),
      },
    });
    svc.send('s1', 'hi');
    await until(() => !!doneOf(sent, 's1'), 'reasoning e2e done');

    const reasoning = sent.filter(
      (s) => s.channel === 'chat.reasoning' && s.params.sessionId === 's1',
    );
    expect(reasoning.map((r) => r.params.text)).toEqual(['先想想', '再想想']);
    // 桌宠线索：每轮首块一次 thinking 表情
    expect(
      sent.filter((s) => s.channel === 'behavior.applyEmotion' && s.params.name === 'thinking'),
    ).toHaveLength(1);
    // 气泡干净：reasoning 永不进 chat.stream
    const streamText = sent
      .filter((s) => s.channel === 'chat.stream')
      .map((s) => s.params.text)
      .join('');
    expect(streamText).toBe('你好呀');
    expect(streamText).not.toContain('想');
  });

  it('routes tool_call to chat.toolCall(pending) + searching cue, and still re-prompts', async () => {
    const sent: Sent[] = [];
    svc = new ChatService({
      providerEntryPath: TOOL_ENTRY,
      broadcast: (c, p) => sent.push({ channel: c, params: p }),
      providerChain: ['openai'],
      queue: { flushIntervalMs: 5 },
      plugins: { tools: new Map([['echo', (args: unknown) => `echoed:${JSON.stringify(args)}`]]) },
    });
    svc.send('s1', 'use a tool');
    await until(() => !!doneOf(sent, 's1'), 'tool reprompt done');

    const toolCalls = sent.filter((s) => s.channel === 'chat.toolCall');
    // §4：pending（core，收到 tool_call 事件）+ result（runToolsAndReprompt 执行后）。
    expect(toolCalls).toHaveLength(2);
    expect(toolCalls[0]!.params).toMatchObject({
      sessionId: 's1',
      call: { id: 't1', name: 'echo', phase: 'pending' },
    });
    expect(toolCalls[1]!.params).toMatchObject({
      sessionId: 's1',
      call: { id: 't1', name: 'echo', phase: 'result' },
    });
    expect(toolCalls[1]!.params.call.result).toContain('echoed:');
    expect(
      sent.filter((s) => s.channel === 'behavior.playAction' && s.params.name === 'searching'),
    ).toHaveLength(1);
    // 回灌仍发生：最终回复含 result=
    const text = sent
      .filter((s) => s.channel === 'chat.stream')
      .map((s) => s.params.text)
      .join('');
    expect(text).toContain('result=echoed:');
  });
});

describe('ChatService · §7 Trace 埋点', () => {
  it('§7 一轮对话产出 trace 时间线：turn.start → context.assembled → turn.done', async () => {
    const collector = createTraceCollector({ broadcast: () => {}, enabled: () => true });
    const sent: Sent[] = [];
    svc = new ChatService({
      providerEntryPath: PROVIDER_ENTRY,
      broadcast: (channel, params) => sent.push({ channel, params }),
      host: { intervalMs: 0 },
      queue: { flushIntervalMs: 5 },
      trace: collector,
    });
    svc.send('s1', '你好');
    await until(() => !!doneOf(sent, 's1'), 'traced done');
    const actions = collector.history().map((r) => r.action);
    expect(actions[0]).toBe('turn.start');
    expect(actions).toContain('context.assembled');
    expect(actions.at(-1)).toBe('turn.done');
  });
});

describe('ChatService · ⑬ 表情分类兜底钩子', () => {
  it('纯文本回复（零标签）→ done(stop) 后以干净全文触发一次', async () => {
    const calls: Array<[string, string]> = [];
    const sent: Sent[] = [];
    svc = new ChatService({
      providerEntryPath: PLAIN_ENTRY,
      broadcast: (channel, params) => sent.push({ channel, params }),
      host: { intervalMs: 0 },
      queue: { flushIntervalMs: 5 },
      emotionFallback: (sid, text) => calls.push([sid, text]),
    });
    svc.send('s1', '你好');
    await until(() => !!doneOf(sent, 's1'), 'chat.done');
    expect(calls).toEqual([['s1', '今天也要加油哦。']]);
  });
  it('mock 回复带 <emo:/>（applyEmotion 在场）→ 钩子不触发', async () => {
    const calls: Array<[string, string]> = [];
    const sent: Sent[] = [];
    svc = new ChatService({
      providerEntryPath: PROVIDER_ENTRY,
      broadcast: (channel, params) => sent.push({ channel, params }),
      host: { intervalMs: 0 },
      queue: { flushIntervalMs: 5 },
      emotionFallback: (sid, text) => calls.push([sid, text]),
    });
    svc.send('s1', '你好');
    await until(() => !!doneOf(sent, 's1'), 'chat.done');
    expect(sent.some((s) => s.channel === 'behavior.applyEmotion')).toBe(true);
    expect(calls).toEqual([]);
  });
  it('Star 拦截轮（合成 delta+done）→ 钩子不触发', async () => {
    const calls: Array<[string, string]> = [];
    const sent: Sent[] = [];
    svc = new ChatService({
      providerEntryPath: PLAIN_ENTRY,
      broadcast: (channel, params) => sent.push({ channel, params }),
      host: { intervalMs: 0 },
      queue: { flushIntervalMs: 5 },
      intercept: async () => '/help 的命令输出，这是一段没有任何标签的长文本。',
      emotionFallback: (sid, text) => calls.push([sid, text]),
    });
    await svc.send('s1', '/help');
    await until(() => !!doneOf(sent, 's1'), 'chat.done');
    expect(calls).toEqual([]);
  });
  it('取消轮（done cancel）→ 钩子不触发', async () => {
    const calls: Array<[string, string]> = [];
    const sent: Sent[] = [];
    svc = new ChatService({
      providerEntryPath: WEDGED_ENTRY,
      broadcast: (channel, params) => sent.push({ channel, params }),
      host: { intervalMs: 0 },
      queue: { flushIntervalMs: 5 },
      emotionFallback: (sid, text) => calls.push([sid, text]),
    });
    svc.send('s1', 'hi');
    await until(() => sent.some((s) => s.channel === 'chat.stream'), 'first delta');
    svc.cancel('s1');
    await until(() => !!doneOf(sent, 's1'), 'done after cancel');
    expect(calls).toEqual([]);
  });
});
