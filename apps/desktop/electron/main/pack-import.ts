/**
 * pack-import —— .dspack(zip)/文件夹 → userData/characters/<id>（spec §2）。
 *
 * 安全：逐 entry `isSafeRelPath`（防 zip-slip：`..`/`\`/盘符/绝对路径全拒）；解压
 * 总量上限 300MB；先解临时目录 → Zod 校验 manifest + id 冲突 → rename 落位。
 * 纯 Node 可单测；Electron 弹框在 ipc-router 侧（pickPath 注入）。
 */
import AdmZip from 'adm-zip';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CharacterManifestSchema, isSafeRelPath, type CharacterManifest } from '@openpet/protocol';

const MAX_UNPACKED_BYTES = 300 * 1024 * 1024;

function readManifest(raw: string): CharacterManifest {
  return CharacterManifestSchema.parse(JSON.parse(raw));
}

/** 摘要（不安装）：zip 或文件夹自动判别。 */
export function inspectPack(srcPath: string): CharacterManifest {
  if (statSync(srcPath).isDirectory()) {
    return readManifest(readFileSync(path.join(srcPath, 'manifest.json'), 'utf8'));
  }
  const zip = new AdmZip(srcPath);
  const entry = zip.getEntry('manifest.json');
  if (!entry) throw new Error('包根缺少 manifest.json');
  return readManifest(zip.readAsText(entry));
}

/** 安装到 importedRoot/<manifest.id>；exists(id) 查双根冲突。返回 manifest。 */
export function installPack(
  srcPath: string,
  importedRoot: string,
  exists: (id: string) => boolean,
): CharacterManifest {
  const manifest = inspectPack(srcPath);
  if (exists(manifest.id)) throw new Error(`角色 id "${manifest.id}" 已存在`);
  mkdirSync(importedRoot, { recursive: true });
  const dest = path.join(importedRoot, manifest.id);

  if (statSync(srcPath).isDirectory()) {
    cpSync(srcPath, dest, { recursive: true });
    return manifest;
  }

  const zip = new AdmZip(srcPath);
  let total = 0;
  for (const e of zip.getEntries()) {
    const name = e.entryName.replace(/\/$/, ''); // 目录 entry 去尾斜杠再校验
    if (name.length > 0 && !isSafeRelPath(name)) {
      throw new Error(`包内非法路径: ${e.entryName}`);
    }
    total += e.header.size;
    if (total > MAX_UNPACKED_BYTES) throw new Error('包解压总量超过 300MB 上限');
  }
  const staging = mkdtempSync(path.join(tmpdir(), 'ds-install-'));
  try {
    zip.extractAllTo(staging, true);
    try {
      renameSync(staging, dest); // staging 根即包根（manifest 在根）
    } catch {
      // 跨盘（tmp 与 userData 不同盘符）rename 抛 EXDEV → 降级递归拷贝。测试同盘不覆盖该分支。
      cpSync(staging, dest, { recursive: true });
    }
  } catch (e) {
    rmSync(dest, { recursive: true, force: true });
    throw e;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  return manifest;
}
