import type { PrefsStore } from './store.js';
import { MemoryPrefsStore } from './memory-store.js';
import { JsonPrefsStore } from './json-store.js';

export type { PrefsStore } from './store.js';
export { MemoryPrefsStore } from './memory-store.js';
export { JsonPrefsStore } from './json-store.js';
export { createPrefEffects, applyAllEffects, type PrefEffects } from './effects.js';

export interface CreatePrefsStoreOptions {
  /** 给路径 → JsonPrefsStore；构造失败降级 MemoryPrefsStore。缺省纯内存（测试）。 */
  prefsPath?: string;
}

export function createPrefsStore(opts: CreatePrefsStoreOptions = {}): PrefsStore {
  if (!opts.prefsPath) return new MemoryPrefsStore();
  try {
    return new JsonPrefsStore(opts.prefsPath);
  } catch (e) {
    console.warn('[prefs] JsonPrefsStore unavailable, falling back to in-memory:', e);
    return new MemoryPrefsStore();
  }
}
