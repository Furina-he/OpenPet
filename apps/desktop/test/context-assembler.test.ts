import { describe, it, expect } from 'vitest';
import { assembleContext } from '../electron/main/context-assembler.js';
import { MemoryStore } from '../electron/main/db/memory-store.js';
import { DEFAULT_PERSONA_STATE } from '@openpet/protocol';

const CH = { id: 'default', name: '小灵', emotions: ['happy', 'shy'], actions: ['wave'] };

describe('assembleContext', () => {
  it('prepends a system prompt and appends the current user message', () => {
    const store = new MemoryStore();
    const req = assembleContext({ store, character: CH, sessionId: 's', userText: '你好' });
    expect(req.messages[0]!.role).toBe('system');
    expect(req.messages[0]!.content).toContain('小灵');
    expect(req.messages.at(-1)).toEqual({ role: 'user', content: '你好' });
  });

  it('injects working memory (recent turns) between system and current user', () => {
    const store = new MemoryStore();
    store.appendMessage({ characterId: 'default', sessionId: 's', role: 'user', text: 'q1', ts: 1 });
    store.appendMessage({
      characterId: 'default',
      sessionId: 's',
      role: 'assistant',
      text: 'a1',
      ts: 2,
      finishReason: 'stop',
    });
    const req = assembleContext({ store, character: CH, sessionId: 's', userText: 'q2' });
    expect(req.messages.map((m) => m.content)).toEqual([req.messages[0]!.content, 'q1', 'a1', 'q2']);
  });

  it('caps working memory to the last WORKING_TURNS messages', () => {
    const store = new MemoryStore();
    for (let i = 0; i < 50; i++) {
      store.appendMessage({ characterId: 'default', sessionId: 's', role: 'user', text: `m${i}`, ts: i });
    }
    const req = assembleContext({ store, character: CH, sessionId: 's', userText: 'now' });
    expect(req.messages).toHaveLength(22); // system + 20 working + 1 current
  });

  it('reflects persisted persona state in the system prompt', () => {
    const store = new MemoryStore();
    store.putPersonaState('default', { ...DEFAULT_PERSONA_STATE, affinity: 88 }, 1);
    const req = assembleContext({ store, character: CH, sessionId: 's', userText: 'hi' });
    expect(req.messages[0]!.content).toMatch(/88/);
  });

  it('filters out empty-text messages from history', () => {
    const store = new MemoryStore();
    store.appendMessage({
      characterId: 'default',
      sessionId: 's',
      role: 'assistant',
      text: '',
      ts: 1,
      finishReason: 'cancel',
    });
    const req = assembleContext({ store, character: CH, sessionId: 's', userText: 'hi' });
    expect(req.messages.filter((m) => m.content === '')).toHaveLength(0);
  });

  it('isolates working memory by character (no cross-character bleed)', () => {
    const store = new MemoryStore();
    store.appendMessage({ characterId: 'other', sessionId: 's', role: 'user', text: 'secret', ts: 1 });
    const req = assembleContext({ store, character: CH, sessionId: 's', userText: 'hi' });
    expect(req.messages.some((m) => m.content === 'secret')).toBe(false);
  });

  it('透传 model 进 ChatRequest.model；未给则不带该键', () => {
    const store = new MemoryStore();
    const base = { store, character: { id: 'default', name: '小灵' }, sessionId: 's1', userText: 'hi' };
    expect(assembleContext({ ...base, model: 'claude-sonnet-4-6' }).model).toBe('claude-sonnet-4-6');
    expect('model' in assembleContext(base)).toBe(false);
  });

  it('§5 kbHits 非空 → system 末尾追加「参考资料」+ 片段；空/未给 → 不追加', () => {
    const store = new MemoryStore();
    const base = { store, character: CH, sessionId: 's', userText: '猫住哪' };
    const withHits = assembleContext({
      ...base,
      kbHits: [{ text: '猫住在屋顶' }, { text: '狗住在院子' }],
    });
    const sys = withHits.messages[0]!.content;
    expect(sys).toContain('参考资料');
    expect(sys).toContain('猫住在屋顶');
    expect(sys).toContain('狗住在院子');
    // 片段只进 system，不进当前 user 消息（气泡/输入不受污染）
    expect(withHits.messages.at(-1)).toEqual({ role: 'user', content: '猫住哪' });

    const noHits = assembleContext(base);
    expect(noHits.messages[0]!.content).not.toContain('参考资料');
    expect(assembleContext({ ...base, kbHits: [] }).messages[0]!.content).not.toContain('参考资料');
  });

  it('§6 personaPrompt 替换人设首段但保留行为标签与关系记忆；beginDialogs 插在 system 后', () => {
    const store = new MemoryStore();
    const req = assembleContext({
      store,
      character: { id: 'c', name: '小灵' },
      sessionId: 's',
      userText: 'hi',
      personaPrompt: '你是傲娇猫娘小雪。',
      beginDialogs: ['你好呀', '哼，才没有想你呢。'],
    });
    const sys = req.messages[0]!.content;
    expect(sys.startsWith('你是傲娇猫娘小雪。')).toBe(true);
    expect(sys).not.toContain('桌面 AI 伙伴'); // 内置一句被替换
    expect(sys).toContain('行为标签'); // 桌宠边界：规约段永在
    expect(sys).toContain('亲密度'); // 关系记忆段永在
    expect(req.messages[1]).toEqual({ role: 'user', content: '你好呀' });
    expect(req.messages[2]).toEqual({ role: 'assistant', content: '哼，才没有想你呢。' });
    expect(req.messages.at(-1)).toEqual({ role: 'user', content: 'hi' });
  });

  it('批次⑥ memories 注入 system「长期记忆」段（不进消息数组）', () => {
    const req = assembleContext({
      store: new MemoryStore(),
      character: { id: 'c', name: '小灵' },
      sessionId: 's',
      userText: 'hi',
      memories: ['用户养了只猫，名字叫年糕', '用户在深圳工作'],
    });
    const sys = req.messages[0]!.content;
    expect(sys).toContain('关于用户的长期记忆');
    expect(sys).toContain('年糕');
    expect(sys).toContain('行为标签'); // 桌宠边界不变
    // 记忆只进 system，不进消息数组
    expect(req.messages.at(-1)).toEqual({ role: 'user', content: 'hi' });
    expect(req.messages).toHaveLength(2);
  });
});
