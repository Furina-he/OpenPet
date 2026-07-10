import { describe, it, expect } from 'vitest';
import {
  mockProviderChat,
  MOCK_SCRIPT,
  DEMO_SCRIPTS,
  pickDemoScript,
  type ChatEvent,
} from '../src/workers/mock-provider';

async function collect(gen: AsyncGenerator<ChatEvent>): Promise<ChatEvent[]> {
  const out: ChatEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe('mockProviderChat', () => {
  it('streams every scripted chunk then a stop done', async () => {
    const ac = new AbortController();
    const events = await collect(mockProviderChat(ac.signal, { intervalMs: 0 }));

    const deltas = events.filter((e) => e.type === 'delta').map((e) => (e as { text: string }).text);
    expect(deltas).toEqual([...MOCK_SCRIPT]);

    const last = events.at(-1);
    expect(last).toEqual({ type: 'done', finishReason: 'stop' });
  });

  it('ends with cancel and stops emitting deltas once aborted mid-stream', async () => {
    const ac = new AbortController();
    const events: ChatEvent[] = [];
    let count = 0;
    for await (const e of mockProviderChat(ac.signal, { intervalMs: 5 })) {
      events.push(e);
      if (e.type === 'delta' && ++count === 2) ac.abort();
    }

    const last = events.at(-1);
    expect(last).toEqual({ type: 'done', finishReason: 'cancel' });
    // only the deltas emitted before/at the abort point — no full script
    const deltas = events.filter((e) => e.type === 'delta');
    expect(deltas.length).toBeLessThan(MOCK_SCRIPT.length);
  });

  it('emits no deltas when aborted before it starts', async () => {
    const ac = new AbortController();
    ac.abort();
    const events = await collect(mockProviderChat(ac.signal, { intervalMs: 5 }));
    expect(events).toEqual([{ type: 'done', finishReason: 'cancel' }]);
  });
});

describe('demo 台词池（M7b-2 跳过演示）', () => {
  it('DEMO_SCRIPTS[0] 即 MOCK_SCRIPT（默认不回归）', () => {
    expect(DEMO_SCRIPTS[0]).toBe(MOCK_SCRIPT);
  });
  it('pickDemoScript 按 index 轮换 + 回绕', () => {
    expect(pickDemoScript(0)).toBe(DEMO_SCRIPTS[0]);
    expect(pickDemoScript(1)).toBe(DEMO_SCRIPTS[1]);
    expect(pickDemoScript(DEMO_SCRIPTS.length)).toBe(DEMO_SCRIPTS[0]);
  });
  it('每条台词含 intent + 至少一个行为标签（驱动表情/动作）', () => {
    for (const s of DEMO_SCRIPTS) {
      const joined = s.join('');
      expect(joined).toMatch(/\[intent /);
      expect(joined).toMatch(/<(emo|act):/);
    }
  });
});
