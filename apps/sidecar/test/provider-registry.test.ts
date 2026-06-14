import { describe, it, expect } from 'vitest';
import { resolveProvider } from '../src/workers/provider-registry.js';

describe('resolveProvider', () => {
  it('returns an openai-format chat fn for openai/deepseek/qwen', () => {
    for (const id of ['openai', 'deepseek', 'qwen']) {
      expect(typeof resolveProvider(id)).toBe('function');
    }
  });

  it('returns undefined for unknown id', () => {
    expect(resolveProvider('nope')).toBeUndefined();
  });

  it('wires anthropic (claude) and gemini (Task 6.4)', () => {
    expect(typeof resolveProvider('claude')).toBe('function');
    expect(typeof resolveProvider('gemini')).toBe('function');
  });

  it('wires ollama (Phase 5)', () => {
    expect(typeof resolveProvider('ollama')).toBe('function');
  });
});
