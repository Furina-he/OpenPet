import { describe, it, expect } from 'vitest';
import { BUILTIN_PROVIDERS, getDialect } from '../src/provider-config.js';
import {
  ProviderSourceSchema,
  ModelEntrySchema,
  AdapterTemplateSchema,
  ADAPTER_TEMPLATES,
  generateUniqueSourceId,
  modelEntryId,
  getModelsUrlForAdapter,
} from '../src/provider-config.js';

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

describe('ProviderSourceSchema', () => {
  it('defaults key="" / enabled=true on a minimal source', () => {
    const s = ProviderSourceSchema.parse({
      id: 'openai-main',
      adapter: 'openai',
      capability: 'chat',
      apiBase: 'https://api.openai.com/v1',
    });
    expect(s.key).toBe('');
    expect(s.enabled).toBe(true);
  });
  it('rejects unknown adapter / capability', () => {
    expect(
      ProviderSourceSchema.safeParse({ id: 'x', adapter: 'cohere', capability: 'chat', apiBase: '' })
        .success,
    ).toBe(false);
    expect(
      ProviderSourceSchema.safeParse({
        id: 'x',
        adapter: 'openai',
        capability: 'image',
        apiBase: '',
      }).success,
    ).toBe(false);
  });
});

describe('ModelEntrySchema', () => {
  it('defaults caps={} / enabled=true', () => {
    const m = ModelEntrySchema.parse({
      id: 'openai-main/gpt-4o',
      sourceId: 'openai-main',
      model: 'gpt-4o',
    });
    expect(m.caps).toEqual({});
    expect(m.enabled).toBe(true);
  });
});

describe('helpers + templates', () => {
  it('generateUniqueSourceId appends _N on collision', () => {
    expect(generateUniqueSourceId('openai', [])).toBe('openai');
    expect(generateUniqueSourceId('openai', ['openai'])).toBe('openai_1');
    expect(generateUniqueSourceId('openai', ['openai', 'openai_1'])).toBe('openai_2');
  });
  it('modelEntryId joins source/model', () => {
    expect(modelEntryId('openai-main', 'gpt-4o')).toBe('openai-main/gpt-4o');
  });
  it('ADAPTER_TEMPLATES parse and cover the 4 chat adapters', () => {
    for (const t of ADAPTER_TEMPLATES) expect(AdapterTemplateSchema.parse(t)).toEqual(t);
    const chat = ADAPTER_TEMPLATES.filter((t) => t.capability === 'chat').map((t) => t.adapter);
    expect(chat).toEqual(expect.arrayContaining(['openai', 'anthropic', 'gemini', 'ollama']));
  });
  it('getModelsUrlForAdapter builds per-adapter models URL (trailing slash normalized)', () => {
    expect(getModelsUrlForAdapter('openai', 'https://api.openai.com/v1/', 'k')).toBe(
      'https://api.openai.com/v1/models',
    );
    expect(getModelsUrlForAdapter('ollama', 'http://127.0.0.1:11434', '')).toBe(
      'http://127.0.0.1:11434/api/tags',
    );
    expect(getModelsUrlForAdapter('gemini', 'https://g/v1beta', 'sk')).toBe(
      'https://g/v1beta/models?key=sk',
    );
    expect(getModelsUrlForAdapter('gemini', 'https://g/v1beta', '')).toBe('https://g/v1beta/models');
  });
});
