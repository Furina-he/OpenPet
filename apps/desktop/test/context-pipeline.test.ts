import { describe, expect, it } from 'vitest';
import { PackLorebookSchema } from '@openpet/protocol';
import { createContextPipeline } from '../electron/main/context-pipeline.js';
import { MemoryStore } from '../electron/main/db/memory-store.js';

const MEM_SZ = { resident: ['### 用户档案\n用户在深圳工作'], pages: [] };

describe('context-pipeline', () => {
  it('§6 persona dep 注入 assembleContext', async () => {
    const pipeline = createContextPipeline({
      store: new MemoryStore(),
      character: () => ({ id: 'c', name: '小灵' }),
      persona: () => ({ systemPrompt: '你是X。', beginDialogs: ['a', 'b'] }),
    });
    const req = await pipeline.build({ sessionId: 's', userText: 'hi' });
    expect(req.messages[0]!.content.startsWith('你是X。')).toBe(true);
    expect(req.messages[1]).toEqual({ role: 'user', content: 'a' });
  });

  it('§6 persona 缺省/返回 null → 内置人设不受影响', async () => {
    const pipeline = createContextPipeline({
      store: new MemoryStore(),
      character: () => ({ id: 'c', name: '小灵' }),
      persona: () => null,
    });
    const req = await pipeline.build({ sessionId: 's', userText: 'hi' });
    expect(req.messages[0]!.content).toContain('桌面 AI 伙伴');
    expect(req.messages[1]).toEqual({ role: 'user', content: 'hi' });
  });

  it('⑲ memoryStage：retrieveMemory 命中 → 注入 + history 传入 + trace 三路计数；异常 → 放行', async () => {
    const store = new MemoryStore();
    store.appendMessage({
      characterId: 'c',
      sessionId: 's',
      role: 'user',
      text: '早些的消息',
      ts: 1,
    });
    let gotHistory: readonly string[] = [];
    const trace: Array<[string, unknown]> = [];
    const p2 = createContextPipeline({
      store,
      character: () => ({ id: 'c', name: '小灵' }),
      retrieveMemory: async (_q, h) => {
        gotHistory = h;
        return { ...MEM_SZ, stats: { resident: 1, keyword: 2, vector: 0, chars: 30 } };
      },
    });
    await p2.build({ sessionId: 's', userText: 'hi', trace: (a, f) => trace.push([a, f]) });
    expect(gotHistory).toEqual(['早些的消息']);
    expect(trace.find(([a]) => a === 'context.memory')?.[1]).toEqual({
      resident: 1,
      keyword: 2,
      vector: 0,
      chars: 30,
    });
    const pipeline = createContextPipeline({
      store: new MemoryStore(),
      character: () => ({ id: 'c', name: '小灵' }),
      retrieveMemory: async () => MEM_SZ,
    });
    const req = await pipeline.build({ sessionId: 's', userText: 'hi' });
    expect(req.messages[0]!.content).toContain('深圳');
    const boom = createContextPipeline({
      store: new MemoryStore(),
      character: () => ({ id: 'c', name: '小灵' }),
      retrieveMemory: async () => {
        throw new Error('x');
      },
    });
    await expect(boom.build({ sessionId: 's', userText: 'hi' })).resolves.toBeTruthy();
  });
});

describe('⑮ summaryStage', () => {
  it('sessionSummary 供给命中 → 注入「早前对话摘要」块 + trace；返回 null / 缺省不注入', async () => {
    const trace: Array<[string, unknown]> = [];
    const pipeline = createContextPipeline({
      store: new MemoryStore(),
      character: () => ({ id: 'c', name: '小灵' }),
      sessionSummary: (sid) => (sid === 's' ? '之前聊了工作压力' : null),
    });
    const req = await pipeline.build({
      sessionId: 's',
      userText: 'hi',
      trace: (a, f) => trace.push([a, f]),
    });
    expect(req.messages[0]!.content).toContain('之前聊了工作压力');
    expect(trace.some(([a]) => a === 'context.summary')).toBe(true);

    const off = createContextPipeline({
      store: new MemoryStore(),
      character: () => ({ id: 'c', name: '小灵' }),
      sessionSummary: () => null,
    });
    const req2 = await off.build({ sessionId: 's', userText: 'hi' });
    expect(req2.messages[0]!.content).not.toContain('早前对话摘要');
  });
});

describe('⑮ 并行检索（spec §5）', () => {
  it('慢 kb 不阻塞 memory：两 stage 并发启动（串行则 kb 结束才轮到 memory）', async () => {
    const events: string[] = [];
    const pipeline = createContextPipeline({
      store: new MemoryStore(),
      character: () => ({ id: 'c', name: '小灵' }),
      retrieveKb: async () => {
        events.push('kb:start');
        await new Promise((r) => setTimeout(r, 30));
        events.push('kb:end');
        return [{ text: 'kb 片段' }];
      },
      retrieveMemory: async () => {
        events.push('memory:start');
        return MEM_SZ;
      },
    });
    const req = await pipeline.build({ sessionId: 's', userText: 'hi' });
    expect(events.indexOf('memory:start')).toBeLessThan(events.indexOf('kb:end'));
    // 组装产物与串行版一致：两块都注入且顺序不变（memory 在 kb 前）
    const sys = req.messages[0]!.content;
    expect(sys).toContain('kb 片段');
    expect(sys.indexOf('深圳')).toBeLessThan(sys.indexOf('kb 片段'));
  });

  it('单 stage 抛错（lore 供给炸）→ 其余 stage 照常注入，对话不阻断', async () => {
    const pipeline = createContextPipeline({
      store: new MemoryStore(),
      character: () => ({ id: 'c', name: '小灵' }),
      retrieveMemory: async () => MEM_SZ,
      lorebook: () => {
        throw new Error('lore boom');
      },
    });
    const req = await pipeline.build({ sessionId: 's', userText: 'hi' });
    expect(req.messages[0]!.content).toContain('深圳');
  });
});

describe('⑫ loreStage', () => {
  it('命中注入 + trace context.lore；无 lorebook 供给不触发', async () => {
    const store = new MemoryStore();
    store.appendMessage({
      characterId: 'a',
      sessionId: 's',
      role: 'user',
      text: '我们聊过 Nyx 城',
      ts: 1,
    });
    const trace: Array<[string, unknown]> = [];
    const pipeline = createContextPipeline({
      store,
      character: () => ({ id: 'a', name: 'A' }),
      lorebook: () =>
        PackLorebookSchema.parse({ entries: [{ keys: ['Nyx 城'], content: '城建在悬崖上' }] }),
    });
    const req = await pipeline.build({
      sessionId: 's',
      userText: '继续说',
      trace: (a, f) => trace.push([a, f]),
    });
    expect(req.messages[0]?.content).toContain('城建在悬崖上');
    expect(trace.some(([a, f]) => a === 'context.lore' && (f as { hits: number }).hits === 1)).toBe(
      true,
    );
  });
});
