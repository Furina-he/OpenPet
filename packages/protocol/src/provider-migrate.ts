import {
  BUILTIN_PROVIDERS,
  getProviderBaseUrl,
  modelEntryId,
  type ProviderSource,
  type ModelEntry,
} from './provider-config.js';

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
