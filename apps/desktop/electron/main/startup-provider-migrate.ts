import { migrateProviderConfig, type PrefKey, type Prefs } from '@openpet/protocol';

export interface ProviderMigrateDeps {
  getPrefs: () => Prefs;
  setPref: <K extends PrefKey>(key: K, value: Prefs[K]) => void;
  /**
   * prefs 原始 JSON 对象（批次⑥ arch#4：旧键已从 PrefsSchema 删除，经类型化 Prefs 读不到；
   * index.ts 在建 prefsStore 前 readFileSync+JSON.parse 兜出，文件不存在/坏 JSON → {}）。
   */
  rawPrefs: Record<string, unknown>;
  /** 旧 keychain 明文读出（异步）；迁移时搬进 source.key。 */
  keyLookup: (providerId: string) => Promise<string>;
}

/**
 * 启动时一次性：旧单 provider 配置 → 两层 Source+Model。仅当新 sources 为空且原始文件
 * 有旧 activeProvider 才跑。迁移只合成 activeProvider 一个 source，故只需预取它的 key（异步），
 * 再交给同步纯函数 migrateProviderConfig 合成。写入走 prefsStore（新键在 schema 内）。
 */
export async function runProviderMigrationIfNeeded(deps: ProviderMigrateDeps): Promise<void> {
  const p = deps.getPrefs();
  if (p['model.providerSources'].length > 0) return;
  const raw = deps.rawPrefs;
  const activeProvider =
    typeof raw['model.activeProvider'] === 'string' ? raw['model.activeProvider'] : '';
  if (!activeProvider) return;
  const key = await deps.keyLookup(activeProvider);
  const migrated = migrateProviderConfig(
    {
      activeProvider,
      activeModel: typeof raw['model.activeModel'] === 'string' ? raw['model.activeModel'] : '',
      rawPrefs: raw,
    },
    (pid) => (pid === activeProvider ? key : ''),
  );
  if (migrated.sources.length === 0) return;
  deps.setPref('model.providerSources', migrated.sources);
  deps.setPref('model.models', migrated.models);
  deps.setPref('model.defaultChatModelId', migrated.defaultChatModelId);
}
