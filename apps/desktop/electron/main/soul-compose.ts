/**
 * ⑯ 灵魂/肉体合成（spec §2）——「灵魂（人设文本）+ donor 形象目录 → 完整角色包」，
 * 以及 ⑰ 反向操作 `swapBody`（已装角色原地换形象，characterId 不变）。
 *
 * `.dssoul` 灵魂包安装走 composeFromDonor：`CharacterManifestSchema` 强制
 * `engine` + `model`，纯灵魂不是合法角色包，必须与已装包的肉体字段合成。
 *
 * 灵魂/肉体字段的切分线是 protocol 的 `BODY_FIELDS`/`SOUL_FIELDS`（唯一真源）：
 * 合成与换形象读同一张表，谁也不许在本文件里再抄一份。
 *
 * 自包含裁定：整目录复制形象，不做跨包引用，换来卸载/导出/复制零特例。
 * staging（mkdtemp）→ rename 落位，跨盘 EXDEV 降级 cpSync（照 pack-import 模式）。
 */
import AdmZip from 'adm-zip';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  CharacterManifestSchema,
  isSafeRelPath,
  pickBodyFields,
  pickSoulFields,
  SoulPackSchema,
  type BodyPack,
  type CharacterManifest,
  type PackLorebook,
  type PackPersona,
  type SoulPack,
} from '@openpet/protocol';
import { RpcError } from './router.js';

/** 灵魂层最小面（`.dssoul` 的 SoulPack 满足；⑰ 起它是唯一灵魂来源）。 */
export interface SoulLike {
  name: string;
  version: string;
  author?: string;
  description?: string;
  license?: string;
  tags?: string[];
  persona: PackPersona;
  lorebook?: PackLorebook;
}

export interface ComposeFromDonorOpts {
  soul: SoulLike;
  /** 新角色 id（调用方决定；灵魂包 = soul.id）。 */
  id: string;
  donorId: string;
  /** rootOf(donorId) 结果（builtin 或 userData 根均可作形象来源）。 */
  donorRoot: string;
  importedRoot: string;
  /** 额外写进包内的文件（灵魂包 preview 图）；相对路径已由调用方校验。 */
  extraFiles?: Array<{ relPath: string; data: Buffer }>;
  /** manifest.preview 覆盖；缺省承 donor.preview。 */
  preview?: string;
}

/** 读 donor 包 manifest（形象/词表/cues 的来源）。 */
export function readDonorManifest(donorRoot: string, donorId: string): CharacterManifest {
  return CharacterManifestSchema.parse(
    JSON.parse(readFileSync(path.join(donorRoot, donorId, 'manifest.json'), 'utf8')),
  );
}

/**
 * 合成落位：肉体承 donor（BODY_FIELDS），灵魂来自 soul（SOUL_FIELDS）；
 * donor 的 id/voice/元数据不承（spec §3）。返回新角色 id。
 */
export function composeFromDonor(opts: ComposeFromDonorOpts): { id: string } {
  const donorDir = path.join(opts.donorRoot, opts.donorId);
  const donor = readDonorManifest(opts.donorRoot, opts.donorId);
  const { soul, id } = opts;
  const staging = mkdtempSync(path.join(tmpdir(), 'ds-soul-'));
  const stagingPack = path.join(staging, id);
  try {
    cpSync(donorDir, stagingPack, { recursive: true });
    for (const f of opts.extraFiles ?? []) {
      writeFileSync(path.join(stagingPack, f.relPath), f.data);
    }
    const manifest: CharacterManifest = CharacterManifestSchema.parse({
      id,
      ...pickBodyFields(donor),
      ...pickSoulFields(soul),
      // 灵魂包自带 preview 图 → 覆盖 donor 的（preview 属肉体字段，故必须排在 body 之后）
      ...(opts.preview ? { preview: opts.preview } : {}),
    });
    writeFileSync(path.join(stagingPack, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
    mkdirSync(opts.importedRoot, { recursive: true });
    const dest = path.join(opts.importedRoot, id);
    try {
      renameSync(stagingPack, dest);
    } catch {
      cpSync(stagingPack, dest, { recursive: true }); // 跨盘 EXDEV 降级（照 pack-import）
    }
    return { id };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

/** 灵魂包解压总量上限（纯文本 + 一张预览图，50MB 已极宽松）。 */
const MAX_SOUL_BYTES = 50 * 1024 * 1024;
const PREVIEW_RE = /^preview\.(png|jpg|jpeg|webp|gif)$/i;

/** 读 .dssoul（zip，根部 soul.json）；同 pack-import 安全口径：逐 entry isSafeRelPath + 总量上限。 */
export function readSoulPack(srcPath: string): { soul: SoulPack; preview: { relPath: string; data: Buffer } | null } {
  const zip = new AdmZip(srcPath);
  let total = 0;
  for (const e of zip.getEntries()) {
    const name = e.entryName.replace(/\/$/, ''); // 目录 entry 去尾斜杠再校验
    if (name.length > 0 && !isSafeRelPath(name)) throw new Error(`包内非法路径: ${e.entryName}`);
    total += e.header.size;
    if (total > MAX_SOUL_BYTES) throw new Error('灵魂包解压总量超过 50MB 上限');
  }
  const entry = zip.getEntry('soul.json');
  if (!entry) throw new Error('灵魂包根缺少 soul.json');
  const soul = SoulPackSchema.parse(JSON.parse(zip.readAsText(entry)));
  const previewEntry = zip.getEntries().find((e) => PREVIEW_RE.test(e.entryName));
  const preview = previewEntry
    ? { relPath: previewEntry.entryName, data: previewEntry.getData() }
    : null;
  return { soul, preview };
}

export interface InstallSoulPackOpts {
  soulPath: string;
  donorId: string;
  donorRoot: string;
  importedRoot: string;
  exists: (id: string) => boolean;
}

/** 安装 .dssoul：解包校验 → id 冲突拒绝（不静默改名，同 pack-import 口径）→ 与 donor 合成落位。 */
export function installSoulPack(opts: InstallSoulPackOpts): { id: string } {
  const { soul, preview } = readSoulPack(opts.soulPath);
  if (opts.exists(soul.id)) throw new Error(`角色 id "${soul.id}" 已存在`);
  return composeFromDonor({
    soul,
    id: soul.id,
    donorId: opts.donorId,
    donorRoot: opts.donorRoot,
    importedRoot: opts.importedRoot,
    ...(preview ? { extraFiles: [preview], preview: preview.relPath } : {}),
  });
}

// --- ⑰ 一键换形象（spec §2）---

export interface SwapBodyOpts {
  characterId: string;
  /** `characters.rootOf(characterId)` 结果（null = 不存在）。 */
  characterRoot: string | null;
  /** 导入包根；目标角色必须在这里（内置角色只读）。 */
  importedRoot: string;
  /** 形象包 body.json（已过 BodyPackSchema）。 */
  body: BodyPack;
  /** 形象包目录（bodiesRoot/<bodyId>）。 */
  bodyDir: string;
  /** 落位提交；缺省 rename + 跨盘 EXDEV 降级 cpSync（测试注入故障点验回滚）。 */
  commit?: (stagingPack: string, dest: string) => void;
}

function commitMove(stagingPack: string, dest: string): void {
  try {
    renameSync(stagingPack, dest);
  } catch {
    cpSync(stagingPack, dest, { recursive: true }); // 跨盘 EXDEV（照 pack-import）
  }
}

/**
 * 换形象 = 切分线的反向操作：**characterId 不变**，灵魂字段照抄旧 manifest，
 * 肉体字段整组取自形象包 → 记忆/会话/人设/音色按 id 索引，全部原地保留（"换皮不换人"）。
 *
 * 先校验 + staging 备齐（失败时角色目录零改动），再原子替换：
 * 旧目录 rename 成 `<id>.bak`（单份，下次换形象覆盖）→ staging 落位 → 失败 rename 回滚。
 */
export function swapBody(opts: SwapBodyOpts): { id: string } {
  const { characterId, importedRoot, body } = opts;
  if (!opts.characterRoot) throw new RpcError(-32602, `character not found: ${characterId}`);
  if (path.resolve(opts.characterRoot) !== path.resolve(importedRoot)) {
    throw new RpcError(-32602, '内置角色只读，请复制后编辑');
  }
  const dest = path.join(importedRoot, characterId);
  const prev = CharacterManifestSchema.parse(
    JSON.parse(readFileSync(path.join(dest, 'manifest.json'), 'utf8')),
  );
  const staging = mkdtempSync(path.join(tmpdir(), 'ds-swap-'));
  const stagingPack = path.join(staging, characterId);
  const bak = `${dest}.bak`;
  try {
    cpSync(opts.bodyDir, stagingPack, { recursive: true });
    rmSync(path.join(stagingPack, 'body.json'), { force: true }); // 形象包描述文件不进角色包
    const manifest: CharacterManifest = CharacterManifestSchema.parse({
      id: characterId,
      ...pickSoulFields(prev),
      ...pickBodyFields(body),
    });
    writeFileSync(
      path.join(stagingPack, 'manifest.json'),
      JSON.stringify(manifest, null, 2),
      'utf8',
    );
    rmSync(bak, { recursive: true, force: true });
    renameSync(dest, bak);
    try {
      (opts.commit ?? commitMove)(stagingPack, dest);
    } catch (e) {
      rmSync(dest, { recursive: true, force: true }); // 半成品清掉再恢复
      try {
        renameSync(bak, dest);
      } catch {
        throw new RpcError(
          -32603,
          `换形象失败且回滚未完成：旧角色目录保留在 ${bak}，请手动改名回 ${characterId}`,
        );
      }
      throw e;
    }
    return { id: characterId };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}
