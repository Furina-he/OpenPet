import { describe, it, expect } from 'vitest';
import { PersonaStateBlobSchema, DEFAULT_PERSONA_STATE, updatePersonaState } from '../src/state';

describe('PersonaState', () => {
  it('default blob is valid and starts neutral', () => {
    const parsed = PersonaStateBlobSchema.parse(DEFAULT_PERSONA_STATE);
    expect(parsed.affinity).toBe(50);
    expect(parsed.turns).toBe(0);
  });

  it('updatePersonaState bumps turns, clamps affinity, records intent', () => {
    const next = updatePersonaState(DEFAULT_PERSONA_STATE, {
      mood: 'happy',
      energy: 'high',
      ts: 1000,
    });
    expect(next.turns).toBe(1);
    expect(next.affinity).toBe(51);
    expect(next.lastMood).toBe('happy');
    expect(next.lastEnergy).toBe('high');
    expect(next.lastInteraction).toBe(1000);
  });

  it('affinity never exceeds 100', () => {
    let s = { ...DEFAULT_PERSONA_STATE, affinity: 100 };
    s = updatePersonaState(s, { ts: 2000 });
    expect(s.affinity).toBe(100);
  });

  it('missing intent leaves last mood/energy unchanged', () => {
    const seeded = { ...DEFAULT_PERSONA_STATE, lastMood: 'shy' };
    const next = updatePersonaState(seeded, { ts: 3000 });
    expect(next.lastMood).toBe('shy');
  });

  it('result round-trips through the schema (no undefined optional leakage)', () => {
    const next = updatePersonaState(DEFAULT_PERSONA_STATE, { ts: 5 });
    // 无 intent 且无既有 lastMood → 该键应缺失，而非 undefined（exactOptionalPropertyTypes）
    expect('lastMood' in next).toBe(false);
    expect(() => PersonaStateBlobSchema.parse(next)).not.toThrow();
  });
});
