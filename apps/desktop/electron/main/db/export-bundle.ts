import AdmZip from 'adm-zip';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExportManifest } from '@openpet/protocol';
import type { ConversationStore } from './store.js';
import { SCHEMA_VERSION } from './schema.js';

export interface ExportOptions {
  now?: () => number;
  /** SqliteStore 的源 db 路径（给了则一致性快照进 zip）；MemoryStore 省略=仅 manifest。 */
  sqlitePath?: string;
  /** ⑲ 记忆 wiki 根（userData/memory）；存在则整目录进 zip 的 memory/（跳过 .tmp 临时文件）。 */
  memoryRoot?: string;
}

/** 递归收集目录下文件（相对路径，/ 分隔），跳过 .tmp。 */
export function listMemoryFiles(root: string, rel = ''): string[] {
  const dir = rel ? join(root, rel) : root;
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const r = rel ? `${rel}/${name}` : name;
    if (statSync(join(root, r)).isDirectory()) out.push(...listMemoryFiles(root, r));
    else if (!name.endsWith('.tmp')) out.push(r);
  }
  return out;
}

/**
 * 导出 .dsbak（zip）：manifest.json（元信息）+ sessions.db（若有 sqlite 后端）。
 * 决策（用户确认）：**不含 secrets.kc**——密钥绑机器、有明文泄露风险。
 */
export async function exportDsbak(
  store: ConversationStore,
  outPath: string,
  opts: ExportOptions = {},
): Promise<void> {
  const now = opts.now ?? (() => Date.now());
  const usage = store.storageUsage();
  const manifest: ExportManifest = {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: now(),
    characterIds: ['default'], // MVP 单角色；多角色时由 store 暴露 listCharacters()
    messageCount: usage.messageCount,
  };
  const zip = new AdmZip();
  zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'));

  if (opts.sqlitePath) {
    const tmp = await mkdtemp(join(tmpdir(), 'dsbak-src-'));
    const snap = join(tmp, 'sessions.db');
    await store.backupTo(snap);
    if (existsSync(snap)) zip.addLocalFile(snap, '', 'sessions.db');
  }
  if (opts.memoryRoot && existsSync(opts.memoryRoot)) {
    for (const rel of listMemoryFiles(opts.memoryRoot)) {
      zip.addLocalFile(
        join(opts.memoryRoot, rel),
        `memory/${rel.split('/').slice(0, -1).join('/')}`,
      );
    }
  }
  zip.writeZip(outPath);
}
