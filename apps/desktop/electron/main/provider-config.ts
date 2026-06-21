/**
 * ProviderConfig（Main 侧）—— 源感知 host 白名单 + 密钥注入，供 FetchGateway。
 * resolveHost：匹配已配置 source 的 apiBase（最长前缀）→ sourceId。
 * injectAuth：按 source.adapter 的 authStyle 用 source.key 注入（明文随 source 存）。
 */
import {
  ADAPTER_TEMPLATES,
  normalizeProviderBaseUrl,
  type Prefs,
  type ProviderSource,
} from '@desksoul/protocol';

export interface ProviderConfigDeps {
  getPrefs: () => Prefs;
}

export interface ProviderConfigService {
  resolveHost(url: string): { providerId: string } | null;
  injectAuth(
    sourceId: string,
    url: string,
    headers: Record<string, string>,
  ): Promise<{ url?: string; headers: Record<string, string> }>;
}

export function createProviderConfig(deps: ProviderConfigDeps): ProviderConfigService {
  const sources = (): ProviderSource[] => deps.getPrefs()['model.providerSources'];
  return {
    resolveHost(url) {
      // 最长 apiBase 前缀匹配，减少同前缀歧义。
      let best: { providerId: string; len: number } | null = null;
      for (const s of sources()) {
        const base = normalizeProviderBaseUrl(s.apiBase);
        if (base && url.startsWith(base) && (!best || base.length > best.len)) {
          best = { providerId: s.id, len: base.length };
        }
      }
      return best ? { providerId: best.providerId } : null;
    },
    async injectAuth(sourceId, url, headers) {
      const s = sources().find((x) => x.id === sourceId);
      if (!s || !s.key) return { headers };
      const t = ADAPTER_TEMPLATES.find((x) => x.adapter === s.adapter);
      if (!t || t.authStyle === 'none') return { headers };
      if (t.authStyle === 'bearer') return { headers: { ...headers, authorization: `Bearer ${s.key}` } };
      if (t.authStyle === 'x-api-key')
        return { headers: { ...headers, 'x-api-key': s.key, 'anthropic-version': '2023-06-01' } };
      if (t.authStyle === 'query-key') {
        const sep = url.includes('?') ? '&' : '?';
        return { url: `${url}${sep}key=${encodeURIComponent(s.key)}`, headers };
      }
      return { headers };
    },
  };
}
