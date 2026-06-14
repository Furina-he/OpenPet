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

  it('returns undefined for formats not yet wired (anthropic/gemini/ollama)', () => {
    // Phase 3 仅 openai 格式；其余在 Task 3.6 / Phase 5 接入
    expect(resolveProvider('claude')).toBeUndefined();
  });
});
