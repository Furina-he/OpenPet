import { describe, it, expect } from 'vitest';
import { runProviderMigrationIfNeeded } from '../electron/main/startup-provider-migrate';
import { DEFAULT_PREFS, type Prefs, type ProviderSource } from '@desksoul/protocol';

describe('runProviderMigrationIfNeeded', () => {
  it('migrates legacy config (reads keychain key) when sources empty', async () => {
    const state: Prefs = {
      ...DEFAULT_PREFS,
      'model.activeProvider': 'openai',
      'model.activeModel': 'gpt-4o',
    };
    await runProviderMigrationIfNeeded({
      getPrefs: () => state,
      setPref: (k, v) => {
        (state as Record<string, unknown>)[k] = v;
      },
      keyLookup: async (pid) => (pid === 'openai' ? 'sk-x' : ''),
    });
    const sources = state['model.providerSources'] as ProviderSource[];
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ id: 'openai', adapter: 'openai', key: 'sk-x' });
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
      keyLookup: async () => '',
    });
    expect(wrote).toBe(false);
  });

  it('no-op when there is no legacy active provider', async () => {
    const state: Prefs = { ...DEFAULT_PREFS };
    let wrote = false;
    await runProviderMigrationIfNeeded({
      getPrefs: () => state,
      setPref: () => {
        wrote = true;
      },
      keyLookup: async () => 'sk-x',
    });
    expect(wrote).toBe(false);
  });
});
