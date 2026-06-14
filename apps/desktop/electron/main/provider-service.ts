/**
 * ProviderService —— provider.* RPC handlers（saveKey/deleteKey/listProviders/
 * listModels/ollamaDetect/testConnection）。纯函数集合，注入 keychain + httpGetJson；
 * 由 ipc-router spread 进 createRouter。M5 headless 验证用；UI 在 M7 接 D3。
 */
import { BUILTIN_PROVIDERS, getDialect, type ErrorKind } from '@desksoul/protocol';
import type { KeychainLike } from './provider-config.js';

/** GET 一个 URL（可带头）返回解析后 JSON；非 2xx 抛带 `status` 的 Error。 */
export type HttpGetJson = (url: string, headers?: Record<string, string>) => Promise<unknown>;

export interface KeychainRW extends KeychainLike {
  set(providerId: string, keyName: string, value: string): Promise<void>;
  delete(providerId: string, keyName: string): Promise<void>;
}

export interface ProviderServiceDeps {
  keychain: KeychainRW;
  httpGetJson: HttpGetJson;
}

function classify(e: unknown): ErrorKind {
  const status = (e as { status?: number }).status;
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  if (status && status >= 500) return 'server';
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
  if (msg.includes('timeout')) return 'timeout';
  return 'network';
}

export function createProviderService(deps: ProviderServiceDeps) {
  return {
    'provider.saveKey': async (p: { providerId: string; key: string }) => {
      await deps.keychain.set(p.providerId, 'apiKey', p.key);
      return { ok: true as const };
    },
    'provider.deleteKey': async (p: { providerId: string }) => {
      await deps.keychain.delete(p.providerId, 'apiKey');
      return { ok: true as const };
    },
    'provider.listProviders': async (_p: Record<string, never>) => {
      const providers = await Promise.all(
        Object.values(BUILTIN_PROVIDERS).map(async (d) => ({
          id: d.id,
          name: d.name,
          kind: d.kind,
          hasKey:
            d.authStyle === 'none' ? true : (await deps.keychain.get(d.id, 'apiKey')) !== null,
          enabled: true,
          models: d.defaultModels,
        })),
      );
      return { providers };
    },
    'provider.listModels': async (p: { providerId: string }) => {
      return { models: getDialect(p.providerId)?.defaultModels ?? [] };
    },
    'provider.ollamaDetect': async (_p: Record<string, never>) => {
      const ollama = getDialect('ollama')!;
      try {
        const tags = (await deps.httpGetJson(`${ollama.baseUrl}/api/tags`)) as {
          models?: Array<{ name: string }>;
        };
        return { available: true, models: (tags.models ?? []).map((m) => m.name) };
      } catch {
        return { available: false, models: [] as string[] };
      }
    },
    'provider.testConnection': async (p: { providerId: string }) => {
      const d = getDialect(p.providerId);
      if (!d) return { ok: false, errorKind: 'unknown' as ErrorKind, detail: 'unknown provider' };
      if (d.format === 'ollama') {
        try {
          await deps.httpGetJson(`${d.baseUrl}/api/tags`);
          return { ok: true };
        } catch (e) {
          return { ok: false, errorKind: classify(e) };
        }
      }
      const key = await deps.keychain.get(p.providerId, 'apiKey');
      if (!key) return { ok: false, errorKind: 'auth' as ErrorKind, detail: 'no key' };
      // openai 格式有 /models 可探活；其余 MVP 仅凭有 key 视为可达（真实 ping 留 V1+）
      if (d.format !== 'openai') return { ok: true };
      try {
        await deps.httpGetJson(`${d.baseUrl}/models`, { authorization: `Bearer ${key}` });
        return { ok: true };
      } catch (e) {
        return { ok: false, errorKind: classify(e) };
      }
    },
  };
}
