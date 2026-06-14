import { describe, it, expect } from 'vitest';
import { createProviderConfig } from '../electron/main/provider-config';

const fakeKeychain = (keys: Record<string, string>) =>
  ({
    get: async (providerId: string) => keys[providerId] ?? null,
  }) as never;

describe('createProviderConfig', () => {
  it('resolveHost matches builtin hosts and rejects others', () => {
    const pc = createProviderConfig({ keychain: fakeKeychain({}) });
    expect(pc.resolveHost('https://api.openai.com/v1/chat/completions')).toEqual({
      providerId: 'openai',
    });
    expect(pc.resolveHost('https://api.anthropic.com/v1/messages')).toEqual({ providerId: 'claude' });
    expect(pc.resolveHost('https://evil.example/x')).toBeNull();
  });

  it('injectAuth uses bearer for openai', async () => {
    const pc = createProviderConfig({ keychain: fakeKeychain({ openai: 'sk-1' }) });
    const { headers } = await pc.injectAuth(
      'openai',
      'https://api.openai.com/v1/chat/completions',
      {},
    );
    expect(headers).toMatchObject({ authorization: 'Bearer sk-1' });
  });

  it('injectAuth uses x-api-key + anthropic-version for claude', async () => {
    const pc = createProviderConfig({ keychain: fakeKeychain({ claude: 'ak-1' }) });
    const { headers } = await pc.injectAuth('claude', 'https://api.anthropic.com/v1/messages', {});
    expect(headers['x-api-key']).toBe('ak-1');
    expect(headers['anthropic-version']).toBeDefined();
  });

  it('injectAuth rewrites url with key for gemini (query-key)', async () => {
    const pc = createProviderConfig({ keychain: fakeKeychain({ gemini: 'gk-1' }) });
    const { url, headers } = await pc.injectAuth(
      'gemini',
      'https://generativelanguage.googleapis.com/v1beta/models/m:streamGenerateContent?alt=sse',
      {},
    );
    expect(url).toContain('key=gk-1');
    expect(headers).toEqual({});
  });

  it('injectAuth leaves headers untouched when no key', async () => {
    const pc = createProviderConfig({ keychain: fakeKeychain({}) });
    const { headers } = await pc.injectAuth('openai', 'u', { a: '1' });
    expect(headers).toEqual({ a: '1' });
  });
});
