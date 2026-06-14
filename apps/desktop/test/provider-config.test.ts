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
    expect(await pc.injectAuth('openai', {})).toMatchObject({ authorization: 'Bearer sk-1' });
  });

  it('injectAuth uses x-api-key + anthropic-version for claude', async () => {
    const pc = createProviderConfig({ keychain: fakeKeychain({ claude: 'ak-1' }) });
    const h = await pc.injectAuth('claude', {});
    expect(h['x-api-key']).toBe('ak-1');
    expect(h['anthropic-version']).toBeDefined();
  });

  it('injectAuth leaves headers untouched when no key', async () => {
    const pc = createProviderConfig({ keychain: fakeKeychain({}) });
    expect(await pc.injectAuth('openai', { a: '1' })).toEqual({ a: '1' });
  });
});
