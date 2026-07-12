import { describe, expect, it } from 'vitest';
import { PackLorebookSchema } from '@openpet/protocol';
import { createContextPipeline } from '../electron/main/context-pipeline.js';
import { MemoryStore } from '../electron/main/db/memory-store.js';

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

  it('批次⑥ memoryStage：retrieveMemory 命中 → 注入；异常 → 放行', async () => {
    const pipeline = createContextPipeline({
      store: new MemoryStore(),
      character: () => ({ id: 'c', name: '小灵' }),
      retrieveMemory: async () => ['用户在深圳工作'],
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


describe('⑫ loreStage', () => {
  it('命中注入 + trace context.lore；无 lorebook 供给不触发', async () => {
    const store = new MemoryStore();
    store.appendMessage({ characterId: 'a', sessionId: 's', role: 'user', text: '我们聊过 Nyx 城', ts: 1 });
    const trace: Array<[string, unknown]> = [];
    const pipeline = createContextPipeline({
      store,
      character: () => ({ id: 'a', name: 'A' }),
      lorebook: () => PackLorebookSchema.parse({ entries: [{ keys: ['Nyx 城'], content: '城建在悬崖上' }] }),
    });
    const req = await pipeline.build({ sessionId: 's', userText: '继续说', trace: (a, f) => trace.push([a, f]) });
    expect(req.messages[0]?.content).toContain('城建在悬崖上');
    expect(trace.some(([a, f]) => a === 'context.lore' && (f as { hits: number }).hits === 1)).toBe(true);
  });
});
