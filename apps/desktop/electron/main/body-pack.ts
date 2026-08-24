/**
 * ⑰ body-pack —— `.dsbody`(zip) → userData/bodies/<id>（spec §1）。
 *
 * 形象库是与 characters 平行的第三个根：肉体包没有灵魂，混进 characters 会污染
 * E1 列表与 `character.switch`。安全口径整条镜像 `pack-import.ts`：逐 entry
 * `isSafeRelPath`（防 zip-slip）+ 解压总量上限 + staging 校验 → rename 落位。
 * 纯 Node 可单测；Electron 弹框在 ipc-router 侧。
 */
import AdmZip from 'adm-zip';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BodyPackSchema, CHARACTER_ID_RE, isSafeRelPath, type BodyPack } from '@openpet/protocol';

/** 与 pack-import 同量级（模型文件是大头）。 */
const MAX_UNPACKED_BYTES = 300 * 1024 * 1024;

export interface InstalledBody {
  body: BodyPack;
  /** 目录大小（E1 形象卡片）。 */
  sizeBytes: number;
  /** 安装时间 = 目录 birthtime（异常回退 mtime）。 */
  installedAt: number;
}

/** 摘要（不安装）：zip 根部 `body.json`。 */
export function inspectBody(srcPath: string): BodyPack {
  const zip = new AdmZip(srcPath);
  const entry = zip.getEntry('body.json');
  if (!entry) throw new Error('形象包根缺少 body.json');
  return BodyPackSchema.parse(JSON.parse(zip.readAsText(entry)));
}

/** 安装到 bodiesRoot/<body.id>；exists(id) 查形象库冲突。返回 body.json。 */
export function installBody(
  srcPath: string,
  bodiesRoot: string,
  exists: (id: string) => boolean,
  maxUnpackedBytes = MAX_UNPACKED_BYTES,
): BodyPack {
  const body = inspectBody(srcPath);
  if (exists(body.id)) throw new Error(`形象 id "${body.id}" 已存在`);

  const zip = new AdmZip(srcPath);
  let total = 0;
  for (const e of zip.getEntries()) {
    const name = e.entryName.replace(/\/$/, ''); // 目录 entry 去尾斜杠再校验
    if (name.length > 0 && !isSafeRelPath(name)) {
      throw new Error(`包内非法路径: ${e.entryName}`);
    }
    total += e.header.size;
    if (total > maxUnpackedBytes) throw new Error('形象包解压总量超过上限');
  }
  mkdirSync(bodiesRoot, { recursive: true });
  const dest = path.join(bodiesRoot, body.id);
  const staging = mkdtempSync(path.join(tmpdir(), 'ds-body-'));
  try {
    zip.extractAllTo(staging, true);
    try {
      renameSync(staging, dest); // staging 根即包根（body.json 在根）
    } catch {
      // 跨盘（tmp 与 userData 不同盘符）rename 抛 EXDEV → 降级递归拷贝（照 pack-import）
      cpSync(staging, dest, { recursive: true });
    }
  } catch (e) {
    rmSync(dest, { recursive: true, force: true });
    throw e;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  return body;
}

function dirSize(dir: string): number {
  let total = 0;
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    total += ent.isDirectory() ? dirSize(p) : statSync(p).size;
  }
  return total;
}

/** 读单个已装形象（目录名即 id；不符/坏包抛错）。 */
export function readInstalledBody(bodiesRoot: string, id: string): InstalledBody {
  const dir = path.join(bodiesRoot, id);
  const body = BodyPackSchema.parse(JSON.parse(readFileSync(path.join(dir, 'body.json'), 'utf8')));
  if (body.id !== id) throw new Error(`body id "${body.id}" mismatches directory "${id}"`);
  const st = statSync(dir);
  return {
    body,
    sizeBytes: dirSize(dir),
    installedAt: st.birthtimeMs > 0 ? st.birthtimeMs : st.mtimeMs,
  };
}

/** 扫形象库；坏包跳过 + warn（照 character-service.scanRoot）。 */
export function listBodies(bodiesRoot: string): InstalledBody[] {
  if (!existsSync(bodiesRoot)) return [];
  const out: InstalledBody[] = [];
  for (const ent of readdirSync(bodiesRoot, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    try {
      out.push(readInstalledBody(bodiesRoot, ent.name));
    } catch (e) {
      console.warn(`[body] skip broken body pack "${ent.name}": ${String(e)}`);
    }
  }
  return out.sort((a, b) => a.body.name.localeCompare(b.body.name));
}

/** 删除形象目录（id 形状强校验，杜绝路径注入）。 */
export function removeBody(bodiesRoot: string, id: string): void {
  if (!CHARACTER_ID_RE.test(id)) throw new Error(`非法形象 id: ${id}`);
  rmSync(path.join(bodiesRoot, id), { recursive: true, force: true });
}
