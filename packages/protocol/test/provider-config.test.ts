import { describe, it, expect } from 'vitest';
import { BUILTIN_PROVIDERS, getDialect } from '../src/provider-config.js';

describe('BUILTIN_PROVIDERS', () => {
  it('includes openai/deepseek/qwen/claude/gemini/ollama', () => {
    for (const id of ['openai', 'deepseek', 'qwen', 'claude', 'gemini', 'ollama']) {
      expect(BUILTIN_PROVIDERS[id]).toBeDefined();
    }
  });

  it('openai is bearer + openai format with default models', () => {
    const d = getDialect('openai')!;
    expect(d.authStyle).toBe('bearer');
    expect(d.format).toBe('openai');
    expect(d.host).toContain('openai.com');
    expect(d.defaultModels.length).toBeGreaterThan(0);
  });

  it('claude uses x-api-key + anthropic format', () => {
    expect(getDialect('claude')!.authStyle).toBe('x-api-key');
    expect(getDialect('claude')!.format).toBe('anthropic');
  });

  it('gemini uses query-key; ollama needs no auth', () => {
    expect(getDialect('gemini')!.authStyle).toBe('query-key');
    expect(getDialect('ollama')!.authStyle).toBe('none');
  });

  it('getDialect returns undefined for unknown id', () => {
    expect(getDialect('nope')).toBeUndefined();
  });
});
