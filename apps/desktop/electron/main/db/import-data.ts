/**
 * .dsbak 导入（D7，恢复语义，spec §4）：运行中不换库——校验后落 `<sqlitePath>.import`，
 * 下次启动 applyPendingImport 原子换库（旧库留 .bak-<ts> 兜底）。合并策略 → follow-up。
 */
import AdmZip from 'adm-zip';
import { existsSync, renameSync, writeFileSync } from 'node:fs';
import { SCHEMA_VERSION } from './schema.js';

export function stageDsbakImport(dsbakPath: string, sqlitePath: string): void {
  const zip = new AdmZip(dsbakPath);
  const manifestEntry = zip.getEntry('manifest.json');
  if (!manifestEntry) throw new Error('.dsbak 缺少 manifest.json');
  const manifest = JSON.parse(zip.readAsText(manifestEntry)) as { schemaVersion?: number };
  if (typeof manifest.schemaVersion !== 'number' || manifest.schemaVersion > SCHEMA_VERSION) {
    throw new Error(
      `备份 schema 版本(${manifest.schemaVersion})高于当前应用(${SCHEMA_VERSION})，请先升级应用`,
    );
  }
  const db = zip.getEntry('sessions.db');
  if (!db) throw new Error('.dsbak 缺少 sessions.db（可能是纯内存导出）');
  writeFileSync(`${sqlitePath}.import`, db.getData());
}

/** 启动早期调用（建 store 前）；返回是否换了库。 */
export function applyPendingImport(sqlitePath: string, now: () => number = Date.now): boolean {
  const pending = `${sqlitePath}.import`;
  if (!existsSync(pending)) return false;
  if (existsSync(sqlitePath)) renameSync(sqlitePath, `${sqlitePath}.bak-${now()}`);
  renameSync(pending, sqlitePath);
  return true;
}
