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

  it('returns undefined for formats not yet wired (anthropic/gemini)', () => {
    // claude/gemini 在 Task 3.6 接入
    expect(resolveProvider('claude')).toBeUndefined();
    expect(resolveProvider('gemini')).toBeUndefined();
  });

  it('wires ollama (Phase 5)', () => {
    expect(typeof resolveProvider('ollama')).toBe('function');
  });
});
