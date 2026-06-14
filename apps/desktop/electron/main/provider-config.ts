/**
 * ProviderConfig（Main 侧）—— dialect 驱动的 host 白名单 + 密钥注入，供 FetchGateway。
 *
 * resolveHost：遍历内置 dialect 的 host 前缀匹配 url → providerId（白名单）。
 * injectAuth：按 dialect.authStyle 从 Keychain 取密钥注入头（Bearer / x-api-key）。
 *   query-key（Gemini）需改写 url，FetchGateway 当前只注入 header —— 留 Phase 6 扩展。
 */
import { BUILTIN_PROVIDERS, getDialect } from '@desksoul/protocol';

export interface KeychainLike {
  get(providerId: string, keyName: string): Promise<string | null>;
}

export interface ProviderConfigDeps {
  keychain: KeychainLike;
}

export interface ProviderConfigService {
  resolveHost(url: string): { providerId: string } | null;
  injectAuth(providerId: string, headers: Record<string, string>): Promise<Record<string, string>>;
}

export function createProviderConfig(deps: ProviderConfigDeps): ProviderConfigService {
  return {
    resolveHost(url) {
      for (const d of Object.values(BUILTIN_PROVIDERS)) {
        if (url.startsWith(d.host)) return { providerId: d.id };
      }
      return null;
    },
    async injectAuth(providerId, headers) {
      const dialect = getDialect(providerId);
      if (!dialect || dialect.authStyle === 'none') return headers;
      const key = await deps.keychain.get(providerId, 'apiKey');
      if (!key) return headers;
      if (dialect.authStyle === 'bearer') return { ...headers, authorization: `Bearer ${key}` };
      if (dialect.authStyle === 'x-api-key')
        return { ...headers, 'x-api-key': key, 'anthropic-version': '2023-06-01' };
      // query-key（Gemini）需改 url，Phase 6 扩展 FetchGateway injectAuth 签名后接入
      return headers;
    },
  };
}
