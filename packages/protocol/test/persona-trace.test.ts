import { describe, expect, it } from 'vitest';
import {
  PersonaSchema,
  PERSONA_TEMPLATES,
  TraceRecordSchema,
  ChatMessageSchema,
  Methods,
  DEFAULT_PREFS,
} from '../src/index.js';

describe('§6 PersonaSchema', () => {
  it('beginDialogs 奇数条拒绝（user/assistant 须成对）', () => {
    expect(
      PersonaSchema.safeParse({ id: 'p1', name: '猫娘', systemPrompt: 'x', beginDialogs: ['一条'] })
        .success,
    ).toBe(false);
  });
  it('beginDialogs 缺省 [] 通过；偶数条通过', () => {
    expect(PersonaSchema.safeParse({ id: 'p1', name: '猫娘', systemPrompt: 'x' }).success).toBe(true);
    expect(
      PersonaSchema.safeParse({
        id: 'p1',
        name: '猫娘',
        systemPrompt: 'x',
        beginDialogs: ['你好', '哼。'],
      }).success,
    ).toBe(true);
  });
  it('内置 4 模板（F1：治愈伙伴/工作助理/学习伴侣/自由发挥）', () => {
    expect(PERSONA_TEMPLATES.map((t) => t.name)).toEqual(['治愈伙伴', '工作助理', '学习伴侣', '自由发挥']);
    for (const t of PERSONA_TEMPLATES) expect(t.systemPrompt.length).toBeGreaterThan(10);
  });
});

describe('§7 Trace + prefs + methods', () => {
  it('TraceRecordSchema 解析', () => {
    expect(
      TraceRecordSchema.safeParse({ ts: 1, spanId: 's', action: 'turn.start', fields: { a: 1 } })
        .success,
    ).toBe(true);
  });
  it('新 prefs 默认值', () => {
    expect(DEFAULT_PREFS['trace.enabled']).toBe(true);
    expect(DEFAULT_PREFS['persona.list']).toEqual([]);
    expect(DEFAULT_PREFS['persona.defaultId']).toBe('');
    expect(DEFAULT_PREFS['persona.bindings']).toEqual({});
  });
  it('methods 注册齐全', () => {
    for (const m of [
      'persona.getAll',
      'persona.upsert',
      'persona.delete',
      'persona.setDefault',
      'persona.bind',
      'trace.history',
      'trace.clear',
      'trace.record',
    ] as const)
      expect(Methods[m]).toBeDefined();
  });
});

describe('§5 ChatMessage 工具回灌字段', () => {
  it('assistant 可带 toolCalls；tool 可带 toolCallId；旧形状不受影响', () => {
    expect(
      ChatMessageSchema.safeParse({
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'c1', name: 'get_time', argsJson: '{}' }],
      }).success,
    ).toBe(true);
    expect(
      ChatMessageSchema.safeParse({ role: 'tool', content: '12:00', toolCallId: 'c1' }).success,
    ).toBe(true);
    expect(ChatMessageSchema.safeParse({ role: 'user', content: 'hi' }).success).toBe(true);
  });
});
