import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SessionStore } from '../electron/main/session-store.js';
import { MemoryStore } from '../electron/main/db/memory-store.js';

describe('SessionStore - 运行时状态机 + 持久化委托', () => {
  let store: SessionStore;
  let backend: MemoryStore;

  beforeEach(() => {
    backend = new MemoryStore();
    store = new SessionStore({ store: backend, characterId: 'default' });
  });
  afterEach(() => store.dispose());

  it('records user message (persisted immediately)', () => {
    store.appendUser('sess1', 'Hello');
    const snap = store.snapshot('sess1');
    expect(snap.messages).toHaveLength(1);
    expect(snap.messages[0]).toMatchObject({ role: 'user', text: 'Hello', finishReason: null });
    expect(snap.streaming).toBe(false);
    expect(snap.seq).toBe(0);
    expect(backend.recentMessages('default', 'sess1', 10)).toHaveLength(1);
  });

  it('accumulates deltas in-memory, persists the assistant message on finish', () => {
    store.appendUser('sess1', 'Hi');
    store.beginAssistant('sess1');
    expect(store.appendDelta('sess1', 'Hel')).toBe(1);
    store.appendDelta('sess1', 'lo');
    const mid = store.snapshot('sess1');
    expect(mid.streaming).toBe(true);
    expect(mid.messages.at(-1)).toMatchObject({ role: 'assistant', text: 'Hello', finishReason: null });
    // 流式中途仅 user 落库
    expect(backend.recentMessages('default', 'sess1', 10)).toHaveLength(1);

    store.finishAssistant('sess1', 'stop');
    const done = store.snapshot('sess1');
    expect(done.streaming).toBe(false);
    expect(done.messages.at(-1)).toMatchObject({ role: 'assistant', text: 'Hello', finishReason: 'stop' });
    expect(backend.recentMessages('default', 'sess1', 10)).toHaveLength(2);
  });

  it('snapshot reads persisted history across SessionStore instances (crash recovery)', () => {
    store.appendUser('sess1', 'Persisted');
    store.beginAssistant('sess1');
    store.appendDelta('sess1', 'Reply');
    store.finishAssistant('sess1', 'stop');

    const reborn = new SessionStore({ store: backend, characterId: 'default' });
    const snap = reborn.snapshot('sess1');
    expect(snap.messages.map((m) => m.text)).toEqual(['Persisted', 'Reply']);
    expect(snap.streaming).toBe(false);
  });

  it('mid-stream partial is NOT persisted (lost on crash, acceptable MVP)', () => {
    store.appendUser('sess1', 'Q');
    store.beginAssistant('sess1');
    store.appendDelta('sess1', 'partial');
    expect(backend.recentMessages('default', 'sess1', 10)).toHaveLength(1); // 只有 user
  });

  it('recordUsage attaches tokens to the persisted assistant message', () => {
    store.appendUser('sess1', 'hi');
    store.beginAssistant('sess1');
    store.appendDelta('sess1', 'yo');
    store.recordUsage('sess1', 3, 2);
    store.finishAssistant('sess1', 'stop');
    const a = backend.recentMessages('default', 'sess1', 10).at(-1)!;
    expect(a.tokensIn).toBe(3);
    expect(a.tokensOut).toBe(2);
  });

  it('keeps sessions independent (seq + messages)', () => {
    store.appendUser('sess1', 'A');
    store.appendUser('sess2', 'B');
    expect(store.snapshot('sess1').messages[0]!.text).toBe('A');
    expect(store.snapshot('sess2').messages[0]!.text).toBe('B');
  });

  it('snapshot of an unknown session is empty, not an error', () => {
    const snap = store.snapshot('unknown');
    expect(snap.messages).toEqual([]);
    expect(snap.streaming).toBe(false);
  });

  it('isStreaming tracks the in-flight assistant turn', () => {
    expect(store.isStreaming('sess1')).toBe(false);
    store.appendUser('sess1', 'hi');
    store.beginAssistant('sess1');
    expect(store.isStreaming('sess1')).toBe(true);
    store.finishAssistant('sess1', 'stop');
    expect(store.isStreaming('sess1')).toBe(false);
  });

  it('enforces character isolation in the backing store', () => {
    store.appendUser('sess1', 'mine');
    expect(backend.recentMessages('other', 'sess1', 10)).toEqual([]);
  });
});
