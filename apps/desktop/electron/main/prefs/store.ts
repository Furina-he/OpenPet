import type { Prefs, PrefKey } from '@desksoul/protocol';

/**
 * PrefsStore — 应用偏好持久化（tech-design §6 prefs.json）。单写者归 Main。
 * 两个实现：JsonPrefsStore（生产，原子写）/ MemoryPrefsStore（单测 + 降级）。
 * 与 ConversationStore 同构的接口化 + DI。
 */
export interface PrefsStore {
  getAll(): Prefs;
  set<K extends PrefKey>(key: K, value: Prefs[K]): void;
  close(): void;
}
