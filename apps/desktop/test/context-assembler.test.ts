import { describe, it, expect } from 'vitest';
import {
  assembleContext,
  prefixDigest,
  WORKING_TURNS,
  workingWindow,
} from '../electron/main/context-assembler.js';
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
    store.appendMessage({
      characterId: 'default',
      sessionId: 's',
      role: 'user',
      text: 'q1',
      ts: 1,
    });
    store.appendMessage({
      characterId: 'default',
      sessionId: 's',
      role: 'assistant',
      text: 'a1',
      ts: 2,
      finishReason: 'stop',
    });
    const req = assembleContext({ store, character: CH, sessionId: 's', userText: 'q2' });
    expect(req.messages.map((m) => m.content)).toEqual([
      req.messages[0]!.content,
      'q1',
      'a1',
      'q2',
    ]);
  });

  it('caps working memory to the last WORKING_TURNS messages', () => {
    const store = new MemoryStore();
    for (let i = 0; i < 50; i++) {
      store.appendMessage({
        characterId: 'default',
        sessionId: 's',
        role: 'user',
        text: `m${i}`,
        ts: i,
      });
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
    store.appendMessage({
      characterId: 'other',
      sessionId: 's',
      role: 'user',
      text: 'secret',
      ts: 1,
    });
    const req = assembleContext({ store, character: CH, sessionId: 's', userText: 'hi' });
    expect(req.messages.some((m) => m.content === 'secret')).toBe(false);
  });

  it('透传 model 进 ChatRequest.model；未给则不带该键', () => {
    const store = new MemoryStore();
    const base = {
      store,
      character: { id: 'default', name: '小灵' },
      sessionId: 's1',
      userText: 'hi',
    };
    expect(assembleContext({ ...base, model: 'claude-sonnet-4-6' }).model).toBe(
      'claude-sonnet-4-6',
    );
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

  it('⑲ memory 注入 system「记忆」块（常驻 + ### 命中页；不进消息数组）', () => {
    const req = assembleContext({
      store: new MemoryStore(),
      character: { id: 'c', name: '小灵' },
      sessionId: 's',
      userText: 'hi',
      memory: {
        resident: ['### 用户档案\n用户在深圳工作'],
        pages: [{ title: '年糕', body: '用户养的猫，名字叫年糕' }],
      },
    });
    const sys = req.messages[0]!.content;
    expect(sys).toContain('## 记忆');
    expect(sys).toContain('### 用户档案');
    expect(sys).toContain('### 年糕');
    expect(sys).toContain('年糕');
    expect(sys).toContain('行为标签'); // 桌宠边界不变
    // 记忆只进 system，不进消息数组
    expect(req.messages.at(-1)).toEqual({ role: 'user', content: 'hi' });
    expect(req.messages).toHaveLength(2);
  });

  it('⑮ sessionSummary 注入「早前对话摘要」块，排 lore 后、长期记忆前；缺省无块', () => {
    const req = assembleContext({
      store: new MemoryStore(),
      character: { id: 'c', name: '小灵' },
      sessionId: 's',
      userText: 'hi',
      sessionSummary: '之前聊了工作压力，约好周末去爬山',
      memory: { resident: ['### 用户档案\n用户在深圳工作'], pages: [] },
      loreHits: ['城建在悬崖上'],
    });
    const sys = req.messages[0]!.content;
    expect(sys).toContain('早前对话摘要');
    expect(sys).toContain('去爬山');
    expect(sys.indexOf('世界设定')).toBeLessThan(sys.indexOf('早前对话摘要'));
    expect(sys.indexOf('早前对话摘要')).toBeLessThan(sys.indexOf('## 记忆'));
    const bare = assembleContext({
      store: new MemoryStore(),
      character: { id: 'c', name: '小灵' },
      sessionId: 's',
      userText: 'hi',
    });
    expect(bare.messages[0]!.content).not.toContain('早前对话摘要');
  });
});

describe('⑫ 世界设定块 + 宏展开', () => {
  const CH2 = { id: 'a', name: '芙宁娜' };

  it('loreHits 注入「世界设定」块且宏展开；缺省无块', () => {
    const store = new MemoryStore();
    const req = assembleContext({
      store,
      character: CH2,
      sessionId: 's',
      userText: 'hi',
      loreHits: ['{{char}}的城堡在悬崖上'],
      macroCtx: { user: '旅行者' },
    });
    const sys = req.messages[0]?.content ?? '';
    expect(sys).toContain('## 世界设定');
    expect(sys).toContain('芙宁娜的城堡在悬崖上');
    const bare = assembleContext({
      store,
      character: { id: 'a', name: 'A' },
      sessionId: 's',
      userText: 'hi',
    });
    expect(bare.messages[0]?.content).not.toContain('## 世界设定');
  });
  it('personaPrompt 与 beginDialogs 宏展开；未给 macroCtx 不展开（向后兼容）', () => {
    const store = new MemoryStore();
    const req = assembleContext({
      store,
      character: CH2,
      sessionId: 's',
      userText: 'hi',
      personaPrompt: '你是{{char}}，称呼对方{{user}}',
      beginDialogs: ['{{user}}你好', '嗯，{{char}}在'],
      macroCtx: { user: '旅行者' },
    });
    expect(req.messages[0]?.content).toContain('你是芙宁娜，称呼对方旅行者');
    expect(req.messages[1]?.content).toBe('旅行者你好');
    expect(req.messages[2]?.content).toBe('嗯，芙宁娜在');
    const raw = assembleContext({
      store,
      character: { id: 'a', name: 'A' },
      sessionId: 's',
      userText: 'hi',
      personaPrompt: '{{user}}',
    });
    expect(raw.messages[0]?.content).toContain('{{user}}');
  });
});

describe('⑭ 风格锚 + idle_duration', () => {
  it('styleAnchor 以 system 消息插在 history 之后、当前 user 之前，且宏展开', () => {
    const store = new MemoryStore();
    store.appendMessage({
      characterId: 'a',
      sessionId: 's',
      role: 'user',
      text: '早',
      ts: Date.now() - 3_600_000,
    });
    const req = assembleContext({
      store,
      character: { id: 'a', name: '芙宁娜' },
      sessionId: 's',
      userText: 'hi',
      styleAnchor: '你是{{char}}，{{idle_duration}}没聊了，说话要短',
      macroCtx: { user: '旅行者' },
    });
    const n = req.messages.length;
    expect(req.messages[n - 1]).toMatchObject({ role: 'user', content: 'hi' });
    expect(req.messages[n - 2]?.role).toBe('system');
    expect(req.messages[n - 2]?.content).toContain('芙宁娜');
    expect(req.messages[n - 2]?.content).toContain('1 小时');
    expect(req.messages[n - 3]?.content).toBe('早'); // history 在锚之前
  });
  it('无 styleAnchor 不插消息（向后兼容）', () => {
    const req = assembleContext({
      store: new MemoryStore(),
      character: { id: 'a', name: 'A' },
      sessionId: 's',
      userText: 'hi',
    });
    expect(req.messages.filter((m) => m.role === 'system')).toHaveLength(1); // 只有开头 system
  });
});

describe('㉔ 缓存友好布局（spec 2026-09-26-memory-v3 §4）', () => {
  const MEM = {
    resident: ['### 用户档案\n深圳前端'],
    pages: [{ title: '年糕', body: '橘猫' }],
  };
  function seed(store: MemoryStore, n: number, from = 0): void {
    for (let i = from; i < from + n; i++)
      store.appendMessage({
        characterId: 'default',
        sessionId: 's',
        role: i % 2 === 0 ? 'user' : 'assistant',
        text: `m${i}`,
        ts: i + 1,
      });
  }
  const base = (store: MemoryStore, over: Record<string, unknown> = {}) =>
    assembleContext({
      store,
      character: CH,
      sessionId: 's',
      userText: '现在',
      memory: MEM,
      kbHits: [{ text: 'KB 片段' }],
      loreHits: ['世界设定条目'],
      sessionSummary: '早前聊过猫',
      styleAnchor: '说人话',
      moodValue: 0.9,
      cacheFriendly: true,
      ...over,
    });

  it('前缀 = 人设 + 规约 + 摘要 + 常驻记忆；不含关系记忆 / 命中 / 知识库 / 世界设定 / 锚', () => {
    const store = new MemoryStore();
    store.putPersonaState('default', { ...DEFAULT_PERSONA_STATE, affinity: 66 }, 1);
    const req = base(store);
    const prefix = req.messages[0]!.content;
    expect(prefix).toContain('行为标签');
    expect(prefix).toContain('## 早前对话摘要');
    expect(prefix).toContain('## 记忆（关于用户与我们的过往');
    expect(prefix).toContain('深圳前端');
    for (const s of ['关系记忆', '年糕', 'KB 片段', '世界设定', '说人话', '相关记忆'])
      expect(prefix).not.toContain(s);
  });

  it('句尾一条 system：关系记忆 + 世界设定 + 相关记忆 + 参考资料 + 风格锚（锚在最后），紧贴当前输入', () => {
    const store = new MemoryStore();
    store.putPersonaState('default', { ...DEFAULT_PERSONA_STATE, affinity: 66 }, 1);
    seed(store, 4);
    const req = base(store);
    const tail = req.messages.at(-2)!;
    expect(req.messages.at(-1)).toEqual({ role: 'user', content: '现在' });
    expect(tail.role).toBe('system');
    expect(req.messages.filter((m) => m.role === 'system')).toHaveLength(2);
    const t = tail.content;
    const order = ['【关系记忆】你与用户的亲密度 66/100', '## 世界设定', '## 相关记忆（这一轮想起的', '### 年糕\n橘猫', '## 参考资料', '说人话'];
    const idx = order.map((s) => t.indexOf(s));
    expect(idx.every((i) => i >= 0)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    expect(t.endsWith('说人话')).toBe(true);
    expect(t).toContain('你现在心情不错'); // 心情句随关系记忆挪到句尾
  });

  it('两轮之间前缀逐字相同（亲密度 / 心情 / 命中 / 知识库都变了）', () => {
    const store = new MemoryStore();
    store.putPersonaState('default', { ...DEFAULT_PERSONA_STATE, affinity: 50 }, 1);
    seed(store, 6);
    const r1 = base(store);
    store.putPersonaState('default', { ...DEFAULT_PERSONA_STATE, affinity: 51, turns: 9 }, 2);
    seed(store, 2, 6);
    const r2 = base(store, {
      moodValue: -0.9,
      memory: { resident: MEM.resident, pages: [{ title: '别的', body: '别的' }] },
      kbHits: [{ text: '另一片段' }],
      loreHits: ['另一条'],
      userText: '下一句',
    });
    expect(r2.messages[0]).toEqual(r1.messages[0]);
    // 历史前缀也不动：r1 的历史是 r2 历史的前缀
    const h1 = r1.messages.slice(1, -2);
    expect(r2.messages.slice(1, 1 + h1.length)).toEqual(h1);
  });

  it('分档窗口：n ≤ 20 全带；n > 20 带 20 + (n − 20) mod 10 条，起点每 10 条才跳', () => {
    expect([0, 5, 20, 21, 29, 30, 31, 39, 40].map(workingWindow)).toEqual([
      0, 5, 20, 21, 29, 20, 21, 29, 20,
    ]);
    const store = new MemoryStore();
    seed(store, 25);
    const hist = (r: ReturnType<typeof base>) => r.messages.slice(1, -2).map((m) => m.content);
    const a = hist(base(store));
    expect(a).toHaveLength(25);
    expect(a[0]).toBe('m0');
    seed(store, 4, 25); // 29 条：起点不动
    const b = hist(base(store));
    expect(b).toHaveLength(29);
    expect(b[0]).toBe('m0');
    seed(store, 1, 29); // 30 条：起点跳 10
    const c = hist(base(store));
    expect(c).toHaveLength(20);
    expect(c[0]).toBe('m10');
  });

  it('宏照旧展开（前缀与句尾两处）；无易变内容时句尾只剩关系记忆行', () => {
    const store = new MemoryStore();
    const req = assembleContext({
      store,
      character: CH,
      sessionId: 's',
      userText: 'x',
      personaPrompt: '你是{{char}}，叫用户{{user}}。',
      styleAnchor: '对{{user}}说人话',
      macroCtx: { user: '阿明' },
      cacheFriendly: true,
    });
    expect(req.messages[0]!.content).toContain('你是小灵，叫用户阿明。');
    expect(req.messages.at(-2)!.content).toMatch(/^【关系记忆】[\s\S]*对阿明说人话$/);
    const bare = assembleContext({ store, character: CH, sessionId: 's', userText: 'x', cacheFriendly: true });
    expect(bare.messages.at(-2)!.content).toMatch(/^【关系记忆】[^\n]*。$/);
  });

  it('开场白留在前缀之后、历史之前；prefixDigest 覆盖开头 system + 开场白', () => {
    const store = new MemoryStore();
    seed(store, 2);
    const req = assembleContext({
      store,
      character: CH,
      sessionId: 's',
      userText: 'x',
      beginDialogs: ['你好', '嗨'],
      cacheFriendly: true,
    });
    expect(req.messages.slice(1, 5).map((m) => m.content)).toEqual(['你好', '嗨', 'm0', 'm1']);
    const d = prefixDigest(req.messages, 2);
    expect(d.hash).toMatch(/^[0-9a-f]{8}$/);
    expect(d.chars).toBe(req.messages[0]!.content.length + 3);
    expect(prefixDigest(req.messages, 0).hash).not.toBe(d.hash);
  });

  it('开关关（缺省）= 本批前布局：记忆 / 关系记忆都在开头 system，锚单独一条，窗口 20 条滑动', () => {
    const store = new MemoryStore();
    seed(store, 25);
    const req = assembleContext({
      store,
      character: CH,
      sessionId: 's',
      userText: '现在',
      memory: MEM,
      styleAnchor: '说人话',
    });
    expect(req.messages[0]!.content).toContain('关系记忆');
    expect(req.messages[0]!.content).toContain('### 年糕\n橘猫');
    expect(req.messages[0]!.content).not.toContain('相关记忆');
    expect(req.messages.at(-2)).toEqual({ role: 'system', content: '说人话' });
    expect(req.messages.slice(1, -2)).toHaveLength(WORKING_TURNS);
  });
});
