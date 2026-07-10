import { PrefsSchema, type Prefs, type PrefKey } from '@openpet/protocol';
import type { PrefsStore } from './store.js';

/** 纯内存 PrefsStore：单测真源 / JsonPrefsStore 不可用时降级。 */
export class MemoryPrefsStore implements PrefsStore {
  private prefs: Prefs;
  constructor(initial: Partial<Prefs> = {}) {
    this.prefs = PrefsSchema.parse(initial);
  }
  getAll(): Prefs {
    return { ...this.prefs };
  }
  set<K extends PrefKey>(key: K, value: Prefs[K]): void {
    this.prefs = { ...this.prefs, [key]: value };
  }
  close(): void {
    /* no-op */
  }
}
