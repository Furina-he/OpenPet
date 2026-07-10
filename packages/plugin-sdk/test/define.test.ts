import { describe, it, expect } from 'vitest';
import {
  defineProvider,
  defineSkill,
  defineTool,
  parseSseStream,
  installFetchProxy,
} from '../src/index.js';

describe('sdk barrel + define helpers', () => {
  it('re-exports the core surface', () => {
    expect(typeof defineProvider).toBe('function');
    expect(typeof parseSseStream).toBe('function');
    expect(typeof installFetchProxy).toBe('function');
  });

  it('defineSkill returns the descriptor', () => {
    const s = defineSkill({ id: 'pomodoro', setup() {} });
    expect(s.id).toBe('pomodoro');
    expect(typeof s.setup).toBe('function');
  });

  it('defineTool returns id + run', () => {
    const t = defineTool({ id: 'echo', run: (a) => a });
    expect(t.id).toBe('echo');
    expect(t.run({ x: 1 })).toEqual({ x: 1 });
  });
});
