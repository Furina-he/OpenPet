import { describe, it, expect } from 'vitest';
import { migrateProviderConfig } from '../src/provider-migrate.js';

const keyLookup = (id: string) => (id === 'openai' ? 'sk-test' : '');

describe('migrateProviderConfig', () => {
  it('empty when no/unknown active provider', () => {
    expect(
      migrateProviderConfig({ activeProvider: '', activeModel: '', rawPrefs: {} }, keyLookup),
    ).toEqual({ sources: [], models: [], defaultChatModelId: '' });
    expect(
      migrateProviderConfig({ activeProvider: 'mystery', activeModel: 'x', rawPrefs: {} }, keyLookup),
    ).toEqual({ sources: [], models: [], defaultChatModelId: '' });
  });

  it('synthesizes source+model+default from legacy openai config', () => {
    const r = migrateProviderConfig(
      {
        activeProvider: 'openai',
        activeModel: 'gpt-4o',
        rawPrefs: { 'model.openaiBaseUrl': 'https://relay.example.com/v1' },
      },
      keyLookup,
    );
    expect(r.sources[0]).toMatchObject({
      id: 'openai',
      adapter: 'openai',
      capability: 'chat',
      apiBase: 'https://relay.example.com/v1',
      key: 'sk-test',
      enabled: true,
    });
    expect(r.models[0]).toMatchObject({ id: 'openai/gpt-4o', sourceId: 'openai', model: 'gpt-4o' });
    expect(r.defaultChatModelId).toBe('openai/gpt-4o');
  });

  it('maps claude→anthropic adapter, falls back to dialect default model', () => {
    const r = migrateProviderConfig(
      { activeProvider: 'claude', activeModel: '', rawPrefs: {} },
      () => 'k',
    );
    expect(r.sources[0]?.adapter).toBe('anthropic');
    expect(r.models[0]?.model).toBe('claude-sonnet-4-6');
    expect(r.defaultChatModelId).toBe('claude/claude-sonnet-4-6');
  });
});
