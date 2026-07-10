/**
 * ProviderService —— provider.* RPC（AstrBot 对齐两层 Source+Model）。
 * 纯函数集合，注入 getPrefs/setPref + httpGetJson；由 ipc-router spread 进 router。
 * key 明文随 source 存（prefs）；HTTP 取模型/测试在此读 source.key 注入。
 */
import {
  ADAPTER_TEMPLATES,
  PROVIDER_TEMPLATES,
  getModelsUrlForAdapter,
  type Adapter,
  type ErrorKind,
  type ModelCaps,
  type ModelEntry,
  type PrefKey,
  type Prefs,
  type ProviderSource,
} from '@openpet/protocol';

/** GET 一个 URL（可带头）返回解析后 JSON；非 2xx 抛带 `status` 的 Error。 */
export type HttpGetJson = (url: string, headers?: Record<string, string>) => Promise<unknown>;

export interface ProviderServiceDeps {
  httpGetJson: HttpGetJson;
  getPrefs: () => Prefs;
  setPref: <K extends PrefKey>(key: K, value: Prefs[K]) => void;
}

const DEFAULT_KEY_BY_CAP: Record<string, PrefKey> = {
  chat: 'model.defaultChatModelId',
  embedding: 'model.defaultEmbeddingModelId',
  stt: 'model.defaultSttModelId',
  tts: 'model.defaultTtsModelId',
  rerank: 'model.defaultRerankModelId',
  agent_runner: 'model.defaultAgentModelId',
};

function classify(e: unknown): ErrorKind {
  const status = (e as { status?: number }).status;
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  if (status && status >= 500) return 'server';
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
  if (msg.includes('timeout')) return 'timeout';
  return 'network';
}

function parseModelIds(payload: unknown): string[] {
  const data = (payload as { data?: unknown; models?: unknown }).data;
  const models = (payload as { data?: unknown; models?: unknown }).models;
  const source = Array.isArray(data) ? data : Array.isArray(models) ? models : [];
  return source
    .map((item) => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object') {
        const record = item as { id?: unknown; name?: unknown };
        if (typeof record.id === 'string') return record.id;
        if (typeof record.name === 'string') return record.name;
      }
      return '';
    })
    .filter(Boolean);
}

/** adapter → auth header（query-key 改 url 在 getModelsUrlForAdapter 处理；此处取模型/测试用 header/无）。 */
function authHeaders(adapter: Adapter, key: string): Record<string, string> {
  const t = ADAPTER_TEMPLATES.find((x) => x.adapter === adapter);
  if (!t || t.authStyle === 'none' || !key) return {};
  if (t.authStyle === 'bearer') return { authorization: `Bearer ${key}` };
  if (t.authStyle === 'x-api-key') return { 'x-api-key': key, 'anthropic-version': '2023-06-01' };
  return {}; // query-key：modelsUrl 已带 ?key=
}

export function createProviderService(deps: ProviderServiceDeps) {
  const sources = (): ProviderSource[] => deps.getPrefs()['model.providerSources'];
  const models = (): ModelEntry[] => deps.getPrefs()['model.models'];
  const findSource = (id: string): ProviderSource | undefined => sources().find((s) => s.id === id);
  const sourceOfModel = (modelId: string): ProviderSource | undefined => {
    const m = models().find((x) => x.id === modelId);
    return m ? findSource(m.sourceId) : undefined;
  };

  return {
    'provider.getConfig': async (_p: Record<string, never>) => ({
      sources: sources(),
      models: models(),
      templates: ADAPTER_TEMPLATES,
      providerTemplates: PROVIDER_TEMPLATES,
    }),

    'provider.upsertSource': async (p: { source: ProviderSource }) => {
      const list = [...sources()];
      const idx = list.findIndex((s) => s.id === p.source.id);
      if (idx >= 0) list[idx] = p.source;
      else list.push(p.source);
      deps.setPref('model.providerSources', list);
      return { ok: true as const, id: p.source.id };
    },

    'provider.deleteSource': async (p: { id: string }) => {
      deps.setPref(
        'model.providerSources',
        sources().filter((s) => s.id !== p.id),
      );
      const keptModels = models().filter((m) => m.sourceId !== p.id);
      deps.setPref('model.models', keptModels);
      // 清空指向被删 model 的默认指针
      const prefs = deps.getPrefs();
      for (const key of Object.values(DEFAULT_KEY_BY_CAP)) {
        const cur = prefs[key] as string;
        if (cur && !keptModels.some((m) => m.id === cur)) deps.setPref(key, '' as never);
      }
      return { ok: true as const };
    },

    'provider.fetchModels': async (p: { sourceId: string }) => {
      const src = findSource(p.sourceId);
      if (!src) return { models: [] as string[] };
      const url = getModelsUrlForAdapter(src.adapter, src.apiBase, src.key);
      const payload = await deps.httpGetJson(url, authHeaders(src.adapter, src.key));
      const ids = parseModelIds(payload);
      // 默认模型回退：优先按源的具名模板（source.name）匹配，否则按 adapter+capability 取
      // 同类首个具名模板（embedding 源 → embedding 默认，不再错回退 chat）。
      const t =
        (src.name && PROVIDER_TEMPLATES.find((x) => x.name === src.name)) ||
        PROVIDER_TEMPLATES.find(
          (x) => x.adapter === src.adapter && x.capability === src.capability,
        );
      return { models: ids.length ? ids : (t?.defaultModels ?? []) };
    },

    'provider.addModel': async (p: { entry: ModelEntry }) => {
      const list = [...models()];
      if (!list.some((m) => m.id === p.entry.id)) list.push(p.entry);
      deps.setPref('model.models', list);
      return { ok: true as const };
    },

    'provider.deleteModel': async (p: { id: string }) => {
      deps.setPref(
        'model.models',
        models().filter((m) => m.id !== p.id),
      );
      return { ok: true as const };
    },

    'provider.setModelEnabled': async (p: { id: string; enabled: boolean }) => {
      deps.setPref(
        'model.models',
        models().map((m) => (m.id === p.id ? { ...m, enabled: p.enabled } : m)),
      );
      return { ok: true as const };
    },

    'provider.updateModelCaps': async (p: { id: string; caps: ModelCaps }) => {
      deps.setPref(
        'model.models',
        models().map((m) => (m.id === p.id ? { ...m, caps: p.caps } : m)),
      );
      return { ok: true as const };
    },

    'provider.testModel': async (p: { id: string }) => {
      const src = sourceOfModel(p.id);
      if (!src) return { ok: false, errorKind: 'unknown' as ErrorKind };
      const url = getModelsUrlForAdapter(src.adapter, src.apiBase, src.key);
      const t0 = Date.now();
      try {
        await deps.httpGetJson(url, authHeaders(src.adapter, src.key));
        return { ok: true, latencyMs: Math.max(0, Date.now() - t0) };
      } catch (e) {
        return { ok: false, errorKind: classify(e) };
      }
    },

    'provider.testSource': async (p: { id: string }) => {
      // 源级检测：探活 base+key（GET 模型列表端点；openai/ollama 兼容端点均支持）。
      const src = findSource(p.id);
      if (!src) return { ok: false, errorKind: 'unknown' as ErrorKind };
      const url = getModelsUrlForAdapter(src.adapter, src.apiBase, src.key);
      const t0 = Date.now();
      try {
        await deps.httpGetJson(url, authHeaders(src.adapter, src.key));
        return { ok: true, latencyMs: Math.max(0, Date.now() - t0) };
      } catch (e) {
        return {
          ok: false,
          errorKind: classify(e),
          error: e instanceof Error ? e.message : String(e),
        };
      }
    },

    'provider.setDefault': async (p: { capability: string; modelId: string }) => {
      const key = DEFAULT_KEY_BY_CAP[p.capability];
      if (key) deps.setPref(key, p.modelId as never);
      return { ok: true as const };
    },

    'provider.ollamaDetect': async (_p: Record<string, never>) => {
      // Ollama 本地探测：用第一个 ollama source 的 apiBase，否则模板默认。
      const src = sources().find((s) => s.adapter === 'ollama');
      const base =
        src?.apiBase ?? ADAPTER_TEMPLATES.find((t) => t.adapter === 'ollama')!.defaultApiBase;
      try {
        const tags = (await deps.httpGetJson(`${base}/api/tags`)) as {
          models?: Array<{ name: string }>;
        };
        return { available: true, models: (tags.models ?? []).map((m) => m.name) };
      } catch {
        return { available: false, models: [] as string[] };
      }
    },
  };
}
