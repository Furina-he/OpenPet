import {
  BUILTIN_PROVIDERS,
  getDialect,
  modelEntryId,
  normalizeProviderBaseUrl,
  type ProviderSource,
  type ModelEntry,
} from './provider-config.js';

// --- 旧 model.*BaseUrl 查表（批次⑥ 自 provider-config 下沉；仅迁移器消费——
//     schema 已删这些键，读的是 prefs 原始 JSON 对象，不依赖 PrefsSchema）。 ---
export const PROVIDER_BASE_URL_PREF_KEYS = {
  openai: 'model.openaiBaseUrl',
  deepseek: 'model.deepseekBaseUrl',
  qwen: 'model.qwenBaseUrl',
  claude: 'model.claudeBaseUrl',
  gemini: 'model.geminiBaseUrl',
  ollama: 'model.ollamaBaseUrl',
} as const;

export function providerBaseUrlPrefKey(
  providerId: string,
): (typeof PROVIDER_BASE_URL_PREF_KEYS)[keyof typeof PROVIDER_BASE_URL_PREF_KEYS] | undefined {
  return PROVIDER_BASE_URL_PREF_KEYS[providerId as keyof typeof PROVIDER_BASE_URL_PREF_KEYS];
}

export function getProviderBaseUrl(
  providerId: string,
  prefs?: Record<string, unknown>,
): string | undefined {
  const dialect = getDialect(providerId);
  if (!dialect) return undefined;
  const key = providerBaseUrlPrefKey(providerId);
  const configured = key && typeof prefs?.[key] === 'string' ? prefs[key] : '';
  return normalizeProviderBaseUrl(configured || dialect.baseUrl);
}

export interface LegacyProviderPrefs {
  activeProvider: string;
  activeModel: string;
  /** 旧 prefs 全量（供 getProviderBaseUrl 读各 *BaseUrl 覆盖）。 */
  rawPrefs: Record<string, unknown>;
}

export interface MigratedProviderConfig {
  sources: ProviderSource[];
  models: ModelEntry[];
  defaultChatModelId: string;
}

/**
 * 旧单 provider 配置 → 新两层 Source+Model。纯函数：key 由 Main 经 keyLookup 注入（无副作用，
 * 便于单测）。仅当 activeProvider 是内置 dialect 时合成。
 */
export function migrateProviderConfig(
  legacy: LegacyProviderPrefs,
  keyLookup: (providerId: string) => string,
): MigratedProviderConfig {
  const empty: MigratedProviderConfig = { sources: [], models: [], defaultChatModelId: '' };
  const pid = legacy.activeProvider;
  const dialect = BUILTIN_PROVIDERS[pid];
  if (!pid || !dialect) return empty;

  const apiBase = getProviderBaseUrl(pid, legacy.rawPrefs) ?? dialect.baseUrl;
  const source: ProviderSource = {
    id: pid,
    adapter: dialect.format, // ProviderFormat 与 Adapter 同一字符串联合
    capability: 'chat',
    apiBase,
    key: keyLookup(pid),
    enabled: true,
    name: dialect.name, // 迁移源带上显示名 + 图标键（pid 即内置厂商键，命中 providerIconUrl）
    icon: pid,
  };

  const model = legacy.activeModel || dialect.defaultModels[0] || '';
  if (!model) return { sources: [source], models: [], defaultChatModelId: '' };

  const entry: ModelEntry = {
    id: modelEntryId(pid, model),
    sourceId: pid,
    model,
    enabled: true,
    caps: {},
  };
  return { sources: [source], models: [entry], defaultChatModelId: entry.id };
}
