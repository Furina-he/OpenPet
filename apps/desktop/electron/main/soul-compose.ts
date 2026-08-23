/**
 * ⑯ 灵魂/肉体合成（spec §2）——「灵魂（人设文本）+ donor 形象目录 → 完整角色包」。
 *
 * 本函数是 ⑫ ST 卡导入既有逻辑的抽取（行为不变，st-card-import 现调用它），
 * ⑯ 的 `.dssoul` 灵魂包安装复用同一条路径：`CharacterManifestSchema` 强制
 * `engine` + `model`，纯灵魂不是合法角色包，必须与已装包的肉体字段合成。
 *
 * 自包含裁定（承 ⑫）：整目录复制 donor，不做跨包引用，换来卸载/导出/复制零特例。
 * staging（mkdtemp）→ rename 落位，跨盘 EXDEV 降级 cpSync（照 pack-import 模式）。
 */
import AdmZip from 'adm-zip';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  CharacterManifestSchema,
  isSafeRelPath,
  SoulPackSchema,
  type CharacterManifest,
  type PackLorebook,
  type PackPersona,
  type SoulPack,
} from '@openpet/protocol';

/** 灵魂层最小面（⑫ 的 StCardSoul 与 ⑯ 的 SoulPack 都满足）。 */
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
  /** 新角色 id（调用方决定：ST 卡 = pickCharacterId 派生，灵魂包 = soul.id）。 */
  id: string;
  donorId: string;
  /** rootOf(donorId) 结果（builtin 或 userData 根均可作形象来源）。 */
  donorRoot: string;
  importedRoot: string;
  /** 额外写进包内的文件（ST 卡头像 / 灵魂包 preview）；相对路径已由调用方校验。 */
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
 * 合成落位：肉体承 donor（engine/model/词表/cues），灵魂来自 soul；
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
      name: soul.name,
      version: soul.version,
      engine: donor.engine,
      model: donor.model,
      ...(donor.emotions ? { emotions: donor.emotions } : {}),
      ...(donor.actions ? { actions: donor.actions } : {}),
      ...(donor.cues ? { cues: donor.cues } : {}),
      ...(donor.live2dEmotions ? { live2dEmotions: donor.live2dEmotions } : {}),
      ...(donor.live2dMotions ? { live2dMotions: donor.live2dMotions } : {}),
      ...(opts.preview ? { preview: opts.preview } : donor.preview ? { preview: donor.preview } : {}),
      persona: soul.persona,
      ...(soul.lorebook ? { lorebook: soul.lorebook } : {}),
      ...(soul.author ? { author: soul.author } : {}),
      ...(soul.description ? { description: soul.description } : {}),
      ...(soul.license ? { license: soul.license } : {}),
      ...(soul.tags ? { tags: soul.tags } : {}),
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
