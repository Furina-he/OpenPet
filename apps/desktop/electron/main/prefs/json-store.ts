import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { PrefsSchema, DEFAULT_PREFS, type Prefs, type PrefKey } from '@desksoul/protocol';
import type { PrefsStore } from './store.js';

/**
 * 生产 PrefsStore：prefs.json 原子写（写 .tmp 再 rename）。
 * 读时用 PrefsSchema 解析：缺失 key 由默认回填；坏 JSON / 校验失败 → 全量默认（不崩）。
 */
export class JsonPrefsStore implements PrefsStore {
  private prefs: Prefs;
  constructor(private readonly filePath: string) {
    this.prefs = this.load();
  }
  private load(): Prefs {
    try {
      const parsed = PrefsSchema.safeParse(JSON.parse(readFileSync(this.filePath, 'utf8')));
      return parsed.success ? parsed.data : { ...DEFAULT_PREFS };
    } catch {
      return { ...DEFAULT_PREFS };
    }
  }
  getAll(): Prefs {
    return { ...this.prefs };
  }
  set<K extends PrefKey>(key: K, value: Prefs[K]): void {
    this.prefs = { ...this.prefs, [key]: value };
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.prefs, null, 2), 'utf8');
    renameSync(tmp, this.filePath);
  }
  close(): void {
    /* no-op */
  }
}
