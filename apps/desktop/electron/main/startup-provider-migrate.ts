import { migrateProviderConfig, type PrefKey, type Prefs } from '@desksoul/protocol';

export interface ProviderMigrateDeps {
  getPrefs: () => Prefs;
  setPref: <K extends PrefKey>(key: K, value: Prefs[K]) => void;
  /** 旧 keychain 明文读出（异步）；迁移时搬进 source.key。 */
  keyLookup: (providerId: string) => Promise<string>;
}

/**
 * 启动时一次性：旧单 provider 配置 → 两层 Source+Model。仅当新 sources 为空且有旧
 * activeProvider 才跑。迁移只合成 activeProvider 一个 source，故只需预取它的 key（异步），
 * 再交给同步纯函数 migrateProviderConfig 合成。
 */
export async function runProviderMigrationIfNeeded(deps: ProviderMigrateDeps): Promise<void> {
  const p = deps.getPrefs();
  if (p['model.providerSources'].length > 0) return;
  const activeProvider = p['model.activeProvider'];
  if (!activeProvider) return;
  const key = await deps.keyLookup(activeProvider);
  const migrated = migrateProviderConfig(
    {
      activeProvider,
      activeModel: p['model.activeModel'],
      rawPrefs: p as Record<string, unknown>,
    },
    (pid) => (pid === activeProvider ? key : ''),
  );
  if (migrated.sources.length === 0) return;
  deps.setPref('model.providerSources', migrated.sources);
  deps.setPref('model.models', migrated.models);
  deps.setPref('model.defaultChatModelId', migrated.defaultChatModelId);
}
