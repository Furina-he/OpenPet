import { describe, it, expect, vi } from 'vitest';
import { createProviderService, type ProviderServiceDeps } from '../electron/main/provider-service';
import {
  DEFAULT_PREFS,
  type Prefs,
  type ProviderSource,
  type ModelEntry,
} from '@openpet/protocol';

function makeDeps(over?: { http?: ProviderServiceDeps['httpGetJson']; prefs?: Partial<Prefs> }): {
  deps: ProviderServiceDeps;
  state: Prefs;
} {
  const state: Prefs = { ...DEFAULT_PREFS, ...over?.prefs };
  const deps: ProviderServiceDeps = {
    httpGetJson: over?.http ?? (async () => ({ data: [{ id: 'gpt-4o' }] })),
    getPrefs: () => state,
    setPref: (k, v) => {
      (state as Record<string, unknown>)[k] = v;
    },
  };
  return { deps, state };
}

const openaiSource: ProviderSource = {
  id: 'openai-main',
  adapter: 'openai',
  capability: 'chat',
  apiBase: 'https://api.openai.com/v1',
  key: '',
  enabled: true,
};

describe('provider-service · sources', () => {
  it('upsertSource adds, then getConfig returns it + templates', async () => {
    const { deps, state } = makeDeps();
    const svc = createProviderService(deps);
    const r = await svc['provider.upsertSource']({ source: openaiSource });
    expect(r).toEqual({ ok: true, id: 'openai-main' });
    expect((state['model.providerSources'] as ProviderSource[])[0]?.id).toBe('openai-main');
    const cfg = await svc['provider.getConfig']({});
    expect(cfg.sources[0]?.id).toBe('openai-main');
    expect(cfg.templates.length).toBeGreaterThan(0);
  });

  it('upsertSource updates in place by id (no duplicate)', async () => {
    const { deps, state } = makeDeps({ prefs: { 'model.providerSources': [openaiSource] } });
    const svc = createProviderService(deps);
    await svc['provider.upsertSource']({ source: { ...openaiSource, key: 'sk-new' } });
    const list = state['model.providerSources'] as ProviderSource[];
    expect(list).toHaveLength(1);
    expect(list[0]?.key).toBe('sk-new');
  });

  it('deleteSource removes its models and clears a default pointing to them', async () => {
    const { deps, state } = makeDeps({
      prefs: {
        'model.providerSources': [openaiSource],
        'model.models': [
          {
            id: 'openai-main/gpt-4o',
            sourceId: 'openai-main',
            model: 'gpt-4o',
            enabled: true,
            caps: {},
          },
        ],
        'model.defaultChatModelId': 'openai-main/gpt-4o',
      },
    });
    const svc = createProviderService(deps);
    await svc['provider.deleteSource']({ id: 'openai-main' });
    expect(state['model.providerSources']).toEqual([]);
    expect(state['model.models']).toEqual([]);
    expect(state['model.defaultChatModelId']).toBe('');
  });
});

describe('provider-service · models', () => {
  it('fetchModels queries upstream from source.apiBase with source.key', async () => {
    const http = vi.fn(async () => ({ data: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }] }));
    const { deps } = makeDeps({
      http,
      prefs: {
        'model.providerSources': [
          { ...openaiSource, apiBase: 'https://relay.example.com/v1', key: 'sk-r' },
        ],
      },
    });
    const svc = createProviderService(deps);
    await expect(svc['provider.fetchModels']({ sourceId: 'openai-main' })).resolves.toEqual({
      models: ['gpt-4o', 'gpt-4o-mini'],
    });
    expect(http).toHaveBeenCalledWith('https://relay.example.com/v1/models', {
      authorization: 'Bearer sk-r',
    });
  });

  it('fetchModels 空结果时按能力回退默认模型（embedding 源 → embedding 默认，非 chat）', async () => {
    const http = vi.fn(async () => ({ data: [] })); // upstream 返回空
    const embedSource: ProviderSource = {
      id: 'oai-embed',
      adapter: 'openai',
      capability: 'embedding',
      apiBase: 'https://api.openai.com/v1',
      key: '',
      enabled: true,
    };
    const { deps } = makeDeps({ http, prefs: { 'model.providerSources': [embedSource] } });
    const svc = createProviderService(deps);
    const r = await svc['provider.fetchModels']({ sourceId: 'oai-embed' });
    expect(r.models).toContain('text-embedding-3-small');
    expect(r.models).not.toContain('gpt-4o'); // 不回退到 chat 默认
  });

  it('addModel + updateModelCaps + setModelEnabled + deleteModel', async () => {
    const { deps, state } = makeDeps({ prefs: { 'model.providerSources': [openaiSource] } });
    const svc = createProviderService(deps);
    const entry: ModelEntry = {
      id: 'openai-main/gpt-4o',
      sourceId: 'openai-main',
      model: 'gpt-4o',
      enabled: true,
      caps: {},
    };
    await svc['provider.addModel']({ entry });
    await svc['provider.updateModelCaps']({ id: entry.id, caps: { vision: true, tool: true } });
    await svc['provider.setModelEnabled']({ id: entry.id, enabled: false });
    expect((state['model.models'] as ModelEntry[])[0]).toMatchObject({
      caps: { vision: true, tool: true },
      enabled: false,
    });
    await svc['provider.deleteModel']({ id: entry.id });
    expect(state['model.models']).toEqual([]);
  });

  it('setDefault writes the capability-specific pref key', async () => {
    const { deps, state } = makeDeps();
    const svc = createProviderService(deps);
    await svc['provider.setDefault']({ capability: 'chat', modelId: 'openai-main/gpt-4o' });
    expect(state['model.defaultChatModelId']).toBe('openai-main/gpt-4o');
    await svc['provider.setDefault']({ capability: 'embedding', modelId: 'oai/te-3' });
    expect(state['model.defaultEmbeddingModelId']).toBe('oai/te-3');
  });

  it('testModel classifies a 401 as auth', async () => {
    const http = vi.fn(async () => {
      throw Object.assign(new Error('401'), { status: 401 });
    });
    const { deps } = makeDeps({
      http,
      prefs: {
        'model.providerSources': [{ ...openaiSource, key: 'bad' }],
        'model.models': [
          {
            id: 'openai-main/gpt-4o',
            sourceId: 'openai-main',
            model: 'gpt-4o',
            enabled: true,
            caps: {},
          },
        ],
      },
    });
    const svc = createProviderService(deps);
    expect(await svc['provider.testModel']({ id: 'openai-main/gpt-4o' })).toMatchObject({
      ok: false,
      errorKind: 'auth',
    });
  });

  it('testSource 源级检测：连通 → ok+latency；缺失源 → unknown', async () => {
    const http = vi.fn(async () => ({ data: [] }));
    const { deps } = makeDeps({ http, prefs: { 'model.providerSources': [openaiSource] } });
    const svc = createProviderService(deps);
    const r = await svc['provider.testSource']({ id: 'openai-main' });
    expect(r.ok).toBe(true);
    expect(typeof r.latencyMs).toBe('number');
    expect(await svc['provider.testSource']({ id: 'nope' })).toMatchObject({
      ok: false,
      errorKind: 'unknown',
    });
  });

  it('ollamaDetect uses the first ollama source apiBase', async () => {
    const http = vi.fn(async () => ({ models: [{ name: 'llama3' }] }));
    const { deps } = makeDeps({
      http,
      prefs: {
        'model.providerSources': [
          {
            id: 'local',
            adapter: 'ollama',
            capability: 'chat',
            apiBase: 'http://127.0.0.1:9999',
            key: '',
            enabled: true,
          },
        ],
      },
    });
    const svc = createProviderService(deps);
    expect(await svc['provider.ollamaDetect']({})).toEqual({ available: true, models: ['llama3'] });
    expect(http).toHaveBeenCalledWith('http://127.0.0.1:9999/api/tags');
  });
});
