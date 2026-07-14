import { describe, expect, it } from 'vitest';
import type { Prefs } from '@openpet/protocol';
import { MemoryStore } from '../electron/main/db/index.js';
import { createSessionSummarizer } from '../electron/main/session-summarizer.js';

function fakeCompletion(content: string, log?: { calls: number; bodies: string[] }, ok = true) {
  return async (_url: string, init?: RequestInit): Promise<Response> => {
    if (log) {
      log.calls++;
      log.bodies.push(String(init?.body ?? ''));
    }
    if (!ok) return new Response('boom', { status: 500 });
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  };
}

function makeSummarizer(
  store: MemoryStore,
  fetchImpl: ReturnType<typeof fakeCompletion>,
  opts: { on?: boolean } = {},
) {
  return createSessionSummarizer({
    store,
    fetchImpl,
    getPrefs: () => ({ 'chat.sessionSummary': opts.on ?? true }) as unknown as Prefs,
    resolveTarget: () => ({ apiBase: 'https://x/v1', model: 'gpt', key: 'k', adapter: 'openai' }),
    character: () => ({ id: 'default' }),
    workingTurns: 4, // 测试降窗
    minUnsummarized: 3,
  });
}

/** 依次插 n 条消息，返回行 id 列表。 */
function seed(store: MemoryStore, n: number, startTs = 1): number[] {
  const ids: number[] = [];
  for (let i = 0; i < n; i++) {
    ids.push(
      store.appendMessage({
        characterId: 'default',
        sessionId: 's1',
        role: i % 2 === 0 ? 'user' : 'assistant',
        text: `msg${i + 1}`,
        ts: startTs + i,
      }),
    );
  }
  return ids;
}

describe('session-summarizer（⑮ 记忆域 spec §2）', () => {
  it('阈值不满足不调 LLM：总数 ≤ workingTurns 或窗口外未摘要 < minUnsummarized', async () => {
    const store = new MemoryStore();
    const log = { calls: 0, bodies: [] as string[] };
    const sum = makeSummarizer(store, fakeCompletion('摘要', log));
    seed(store, 4); // 总数 = workingTurns → 不触发
    await sum.onTurnEnd('s1');
    expect(log.calls).toBe(0);
    seed(store, 2, 100); // 总数 6，窗口外 2 < 3 → 不触发
    await sum.onTurnEnd('s1');
    expect(log.calls).toBe(0);
  });

  it('触发：取 (upto, 总数-窗口] 区间 + 推进 upto；旧摘要参与合并', async () => {
    const store = new MemoryStore();
    const log = { calls: 0, bodies: [] as string[] };
    const sum = makeSummarizer(store, fakeCompletion('第一版摘要', log));
    const ids = seed(store, 7); // 总数 7，窗口 4，窗口外 3 ≥ 3 → 触发（msg1..msg3）
    await sum.onTurnEnd('s1');
    expect(log.calls).toBe(1);
    expect(log.bodies[0]).toContain('msg3');
    expect(log.bodies[0]).not.toContain('msg4'); // 窗口内不进摘要段
    expect(store.sessionSummaryGet('s1')).toEqual({ summary: '第一版摘要', upto: ids[2]! });

    // 再涨 3 条（总数 10，窗口外 6，未摘要 = 6-3 = 3 ≥ 3）→ 旧摘要参与合并，段 = msg4..msg6
    const log2 = { calls: 0, bodies: [] as string[] };
    const sum2 = makeSummarizer(store, fakeCompletion('第二版摘要', log2));
    seed(store, 3, 100);
    await sum2.onTurnEnd('s1');
    expect(log2.calls).toBe(1);
    expect(log2.bodies[0]).toContain('第一版摘要'); // 旧摘要进 prompt
    expect(log2.bodies[0]).toContain('msg6');
    expect(log2.bodies[0]).not.toContain('msg7');
    expect(store.sessionSummaryGet('s1')).toEqual({ summary: '第二版摘要', upto: ids[5]! });
  });

  it('失败静默：LLM 500 → 旧摘要与 upto 保留，下轮再试', async () => {
    const store = new MemoryStore();
    store.appendMessage({ characterId: 'default', sessionId: 's1', role: 'user', text: 'x', ts: 0 });
    store.sessionSummarySet('s1', '旧摘要', 1);
    seed(store, 8, 10);
    const sum = makeSummarizer(store, fakeCompletion('', undefined, false));
    await sum.onTurnEnd('s1');
    expect(store.sessionSummaryGet('s1')).toEqual({ summary: '旧摘要', upto: 1 });
  });

  it('开关关 / 非 openai 目标不干活', async () => {
    const store = new MemoryStore();
    seed(store, 10);
    const log = { calls: 0, bodies: [] as string[] };
    const off = makeSummarizer(store, fakeCompletion('摘要', log), { on: false });
    await off.onTurnEnd('s1');
    expect(log.calls).toBe(0);

    const nonOpenai = createSessionSummarizer({
      store,
      fetchImpl: fakeCompletion('摘要', log),
      getPrefs: () => ({ 'chat.sessionSummary': true }) as unknown as Prefs,
      resolveTarget: () => ({ apiBase: 'https://x', model: 'm', key: '', adapter: 'anthropic' }),
      character: () => ({ id: 'default' }),
      workingTurns: 4,
      minUnsummarized: 3,
    });
    await nonOpenai.onTurnEnd('s1');
    expect(log.calls).toBe(0);
    expect(store.sessionSummaryGet('s1').summary).toBeNull();
  });
});
