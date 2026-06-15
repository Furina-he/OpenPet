import { describe, it, expect } from 'vitest';
import { MemoryStore } from '../../electron/main/db/memory-store.js';
import { DEFAULT_PERSONA_STATE } from '@desksoul/protocol';

describe('MemoryStore', () => {
  it('appends and reads back recent messages in ts order', () => {
    const s = new MemoryStore();
    s.appendMessage({ characterId: 'c', sessionId: 's', role: 'user', text: 'hi', ts: 1 });
    s.appendMessage({
      characterId: 'c',
      sessionId: 's',
      role: 'assistant',
      text: 'yo',
      ts: 2,
      finishReason: 'stop',
    });
    const rows = s.recentMessages('c', 's', 10);
    expect(rows.map((r) => r.text)).toEqual(['hi', 'yo']);
    expect(rows[1]!.finishReason).toBe('stop');
  });

  it('isolates by character_id and session_id', () => {
    const s = new MemoryStore();
    s.appendMessage({ characterId: 'a', sessionId: 's', role: 'user', text: 'A', ts: 1 });
    s.appendMessage({ characterId: 'b', sessionId: 's', role: 'user', text: 'B', ts: 1 });
    s.appendMessage({ characterId: 'a', sessionId: 'other', role: 'user', text: 'A2', ts: 1 });
    expect(s.recentMessages('a', 's', 10).map((r) => r.text)).toEqual(['A']);
  });

  it('recentMessages returns only the last N (ts order preserved)', () => {
    const s = new MemoryStore();
    for (let i = 1; i <= 5; i++) {
      s.appendMessage({ characterId: 'c', sessionId: 's', role: 'user', text: `m${i}`, ts: i });
    }
    expect(s.recentMessages('c', 's', 2).map((r) => r.text)).toEqual(['m4', 'm5']);
  });

  it('persona state round-trips; null before first write', () => {
    const s = new MemoryStore();
    expect(s.getPersonaState('c')).toBeNull();
    s.putPersonaState('c', { ...DEFAULT_PERSONA_STATE, affinity: 60 }, 123);
    expect(s.getPersonaState('c')?.affinity).toBe(60);
  });

  it('storageUsage counts messages and distinct characters', () => {
    const s = new MemoryStore();
    s.appendMessage({ characterId: 'a', sessionId: 's', role: 'user', text: 'x', ts: 1 });
    s.appendMessage({ characterId: 'b', sessionId: 's', role: 'user', text: 'y', ts: 1 });
    const u = s.storageUsage();
    expect(u.messageCount).toBe(2);
    expect(u.characterCount).toBe(2);
  });

  it('appendMessage returns a monotonically increasing id', () => {
    const s = new MemoryStore();
    const id1 = s.appendMessage({ characterId: 'c', sessionId: 's', role: 'user', text: 'a', ts: 1 });
    const id2 = s.appendMessage({ characterId: 'c', sessionId: 's', role: 'user', text: 'b', ts: 2 });
    expect(id2).toBeGreaterThan(id1);
  });
});
