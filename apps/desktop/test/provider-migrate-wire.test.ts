import { describe, it, expect } from 'vitest';
import { runProviderMigrationIfNeeded } from '../electron/main/startup-provider-migrate';
import { DEFAULT_PREFS, type Prefs, type ProviderSource } from '@openpet/protocol';

describe('runProviderMigrationIfNeeded', () => {
  it('migrates legacy config (reads raw file keys + keychain key) when sources empty', async () => {
    const state: Prefs = { ...DEFAULT_PREFS };
    // 批次⑥ arch#4：旧键已出 schema——迁移器改吃 prefs 原始 JSON 对象。
    const rawPrefs: Record<string, unknown> = {
      'model.activeProvider': 'openai',
      'model.activeModel': 'gpt-4o',
      'model.openaiBaseUrl': 'https://relay.example.com/v1',
    };
    await runProviderMigrationIfNeeded({
      getPrefs: () => state,
      setPref: (k, v) => {
        (state as Record<string, unknown>)[k] = v;
      },
      rawPrefs,
      keyLookup: async (pid) => (pid === 'openai' ? 'sk-x' : ''),
    });
    const sources = state['model.providerSources'] as ProviderSource[];
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({
      id: 'openai',
      adapter: 'openai',
      key: 'sk-x',
      apiBase: 'https://relay.example.com/v1', // 原始文件里的 BaseUrl 覆盖生效
    });
    expect(state['model.defaultChatModelId']).toBe('openai/gpt-4o');
  });

  it('no-op when sources already present', async () => {
    const state: Prefs = {
      ...DEFAULT_PREFS,
      'model.providerSources': [
        { id: 'x', adapter: 'openai', capability: 'chat', apiBase: 'b', key: '', enabled: true },
      ],
    };
    let wrote = false;
    await runProviderMigrationIfNeeded({
      getPrefs: () => state,
      setPref: () => {
        wrote = true;
      },
      rawPrefs: { 'model.activeProvider': 'openai' },
      keyLookup: async () => '',
    });
    expect(wrote).toBe(false);
  });

  it('no-op when there is no legacy active provider (empty/missing raw file)', async () => {
    const state: Prefs = { ...DEFAULT_PREFS };
    let wrote = false;
    await runProviderMigrationIfNeeded({
      getPrefs: () => state,
      setPref: () => {
        wrote = true;
      },
      rawPrefs: {},
      keyLookup: async () => 'sk-x',
    });
    expect(wrote).toBe(false);
  });
});
