import { describe, it, expect, vi } from 'vitest';
import { createProviderService, type ProviderServiceDeps } from '../electron/main/provider-service';

function makeDeps(
  httpGetJson?: ProviderServiceDeps['httpGetJson'],
  prefs?: Record<string, unknown>,
): ProviderServiceDeps {
  const store: Record<string, string> = {};
  return {
    keychain: {
      get: async (id: string) => store[id] ?? null,
      set: async (id: string, _k: string, v: string) => {
        store[id] = v;
      },
      delete: async (id: string) => {
        delete store[id];
      },
    },
    httpGetJson: httpGetJson ?? (async () => ({ models: [{ name: 'llama3' }] })),
    ...(prefs ? { getPrefs: () => prefs } : {}),
  };
}

describe('provider-service', () => {
  it('saveKey then listProviders reports hasKey', async () => {
    const svc = createProviderService(makeDeps());
    await svc['provider.saveKey']({ providerId: 'openai', key: 'sk-1' });
    const { providers } = await svc['provider.listProviders']({});
    expect(providers.find((p) => p.id === 'openai')!.hasKey).toBe(true);
  });

  it('deleteKey clears hasKey', async () => {
    const svc = createProviderService(makeDeps());
    await svc['provider.saveKey']({ providerId: 'openai', key: 'sk-1' });
    await svc['provider.deleteKey']({ providerId: 'openai' });
    const { providers } = await svc['provider.listProviders']({});
    expect(providers.find((p) => p.id === 'openai')!.hasKey).toBe(false);
  });

  it('ollama reports hasKey=true (no auth required)', async () => {
    const svc = createProviderService(makeDeps());
    const { providers } = await svc['provider.listProviders']({});
    expect(providers.find((p) => p.id === 'ollama')!.hasKey).toBe(true);
  });

  it('ollamaDetect returns available + models from /api/tags', async () => {
    const svc = createProviderService(
      makeDeps(vi.fn(async () => ({ models: [{ name: 'llama3' }, { name: 'qwen2' }] }))),
    );
    const r = await svc['provider.ollamaDetect']({});
    expect(r.available).toBe(true);
    expect(r.models).toEqual(['llama3', 'qwen2']);
  });

  it('ollamaDetect returns unavailable when tags errors', async () => {
    const svc = createProviderService(
      makeDeps(
        vi.fn(async () => {
          throw new Error('ECONNREFUSED');
        }),
      ),
    );
    expect((await svc['provider.ollamaDetect']({})).available).toBe(false);
  });

  it('testConnection classifies a 401 as auth', async () => {
    const svc = createProviderService(
      makeDeps(
        vi.fn(async () => {
          const e = Object.assign(new Error('401'), { status: 401 });
          throw e;
        }),
      ),
    );
    await svc['provider.saveKey']({ providerId: 'openai', key: 'bad' });
    expect(await svc['provider.testConnection']({ providerId: 'openai' })).toMatchObject({
      ok: false,
      errorKind: 'auth',
    });
  });

  it('listModels queries OpenAI-compatible upstream from overridden base URL', async () => {
    const http = vi.fn(async () => ({ data: [{ id: 'relay-gpt' }, { id: 'relay-coder' }] }));
    const svc = createProviderService(
      makeDeps(http, { 'model.openaiBaseUrl': 'https://relay.example.com/v1' }),
    );
    await svc['provider.saveKey']({ providerId: 'openai', key: 'sk-relay' });

    await expect(svc['provider.listModels']({ providerId: 'openai' })).resolves.toEqual({
      models: ['relay-gpt', 'relay-coder'],
    });
    expect(http).toHaveBeenCalledWith('https://relay.example.com/v1/models', {
      authorization: 'Bearer sk-relay',
    });
  });

  it('testConnection uses overridden OpenAI-compatible base URL', async () => {
    const http = vi.fn(async () => ({ data: [] }));
    const svc = createProviderService(
      makeDeps(http, { 'model.openaiBaseUrl': 'https://relay.example.com/v1' }),
    );
    await svc['provider.saveKey']({ providerId: 'openai', key: 'sk-relay' });

    await expect(svc['provider.testConnection']({ providerId: 'openai' })).resolves.toEqual({
      ok: true,
    });
    expect(http).toHaveBeenCalledWith('https://relay.example.com/v1/models', {
      authorization: 'Bearer sk-relay',
    });
  });
});
