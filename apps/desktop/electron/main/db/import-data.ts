/**
 * .dsbak 导入（D7，恢复语义，spec §4）：运行中不换库——校验后落 `<sqlitePath>.import`，
 * 下次启动 applyPendingImport 原子换库（旧库留 .bak-<ts> 兜底）。合并策略 → follow-up。
 */
import AdmZip from 'adm-zip';
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { SCHEMA_VERSION } from './schema.js';

/**
 * ⑲：memoryRoot 给了且 zip 含 memory/ → 解到 `<memoryRoot>.import`（下次启动原子替换，旧目录
 * `.bak-<ts>` 与库同口径）；zip 无 memory/ → 清掉可能残留的 .import（老备份不动现有 wiki）。
 */
export function stageDsbakImport(dsbakPath: string, sqlitePath: string, memoryRoot?: string): void {
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
  if (!memoryRoot) return;
  const staging = `${memoryRoot}.import`;
  rmSync(staging, { recursive: true, force: true });
  const entries = zip
    .getEntries()
    .filter((e) => e.entryName.startsWith('memory/') && !e.isDirectory);
  if (entries.length === 0) return;
  for (const e of entries) {
    const rel = e.entryName.slice('memory/'.length);
    if (!rel || rel.split('/').some((seg) => seg === '..' || seg === '')) continue; // zip-slip 防御
    const dest = path.join(staging, rel);
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, e.getData());
  }
}

/** 启动早期调用（建 store 前）；返回是否换了库。memoryRoot 给了则同时原子替换 wiki 目录。 */
export function applyPendingImport(
  sqlitePath: string,
  now: () => number = Date.now,
  memoryRoot?: string,
): boolean {
  const pending = `${sqlitePath}.import`;
  let swapped = false;
  if (existsSync(pending)) {
    if (existsSync(sqlitePath)) renameSync(sqlitePath, `${sqlitePath}.bak-${now()}`);
    renameSync(pending, sqlitePath);
    swapped = true;
  }
  if (memoryRoot) {
    const staging = `${memoryRoot}.import`;
    if (existsSync(staging)) {
      if (existsSync(memoryRoot)) renameSync(memoryRoot, `${memoryRoot}.bak-${now()}`);
      renameSync(staging, memoryRoot);
      swapped = true;
    }
  }
  return swapped;
}
