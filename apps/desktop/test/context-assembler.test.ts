import { describe, it, expect } from 'vitest';
import { assembleContext } from '../electron/main/context-assembler.js';
import { MemoryStore } from '../electron/main/db/memory-store.js';
import { DEFAULT_PERSONA_STATE } from '@desksoul/protocol';

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
});
