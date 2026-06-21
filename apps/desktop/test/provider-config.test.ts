import { describe, it, expect } from 'vitest';
import { createProviderConfig } from '../electron/main/provider-config';
import { DEFAULT_PREFS, type Prefs, type ProviderSource } from '@desksoul/protocol';

function prefsWith(sources: ProviderSource[]): () => Prefs {
  return () => ({ ...DEFAULT_PREFS, 'model.providerSources': sources });
}

const openai: ProviderSource = {
  id: 'openai-main',
  adapter: 'openai',
  capability: 'chat',
  apiBase: 'https://relay.example.com/v1',
  key: 'sk-r',
  enabled: true,
};
const claude: ProviderSource = {
  id: 'claude-main',
  adapter: 'anthropic',
  capability: 'chat',
  apiBase: 'https://api.anthropic.com/v1',
  key: 'ak-1',
  enabled: true,
};
const gemini: ProviderSource = {
  id: 'gemini-main',
  adapter: 'gemini',
  capability: 'chat',
  apiBase: 'https://generativelanguage.googleapis.com/v1beta',
  key: 'gk-1',
  enabled: true,
};

describe('provider-config(main) 源感知', () => {
  it('resolveHost matches a configured source apiBase → sourceId, rejects others', () => {
    const svc = createProviderConfig({ getPrefs: prefsWith([openai]) });
    expect(svc.resolveHost('https://relay.example.com/v1/chat/completions')).toEqual({
      providerId: 'openai-main',
    });
    expect(svc.resolveHost('https://evil.example.com/x')).toBeNull();
  });

  it('resolveHost prefers the longest matching apiBase prefix', () => {
    const specific: ProviderSource = { ...openai, id: 'specific', apiBase: 'https://relay.example.com/v1/team' };
    const svc = createProviderConfig({ getPrefs: prefsWith([openai, specific]) });
    expect(svc.resolveHost('https://relay.example.com/v1/team/chat')).toEqual({
      providerId: 'specific',
    });
  });

  it('injectAuth uses bearer for openai adapter, reading source.key', async () => {
    const svc = createProviderConfig({ getPrefs: prefsWith([openai]) });
    const r = await svc.injectAuth('openai-main', 'https://relay.example.com/v1/chat/completions', {});
    expect(r.headers.authorization).toBe('Bearer sk-r');
  });

  it('injectAuth uses x-api-key + anthropic-version for anthropic adapter', async () => {
    const svc = createProviderConfig({ getPrefs: prefsWith([claude]) });
    const r = await svc.injectAuth('claude-main', 'https://api.anthropic.com/v1/messages', {});
    expect(r.headers['x-api-key']).toBe('ak-1');
    expect(r.headers['anthropic-version']).toBeDefined();
  });

  it('injectAuth rewrites url with key for gemini (query-key)', async () => {
    const svc = createProviderConfig({ getPrefs: prefsWith([gemini]) });
    const r = await svc.injectAuth(
      'gemini-main',
      'https://generativelanguage.googleapis.com/v1beta/models/m:streamGenerateContent?alt=sse',
      {},
    );
    expect(r.url).toContain('key=gk-1');
    expect(r.headers).toEqual({});
  });

  it('injectAuth leaves headers untouched when source has no key or is unknown', async () => {
    const svc = createProviderConfig({ getPrefs: prefsWith([{ ...openai, key: '' }]) });
    expect((await svc.injectAuth('openai-main', 'u', { a: '1' })).headers).toEqual({ a: '1' });
    expect((await svc.injectAuth('nope', 'u', { a: '1' })).headers).toEqual({ a: '1' });
  });
});
