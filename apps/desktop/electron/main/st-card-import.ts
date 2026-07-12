/**
 * ⑫ ST 卡安装（spec §3）：灵魂（卡文本）+ 肉体（复制已装形象包）合成新角色包。
 * 自包含裁定：整目录复制 donor（不做跨包引用），换来卸载/导出/复制零特例。
 * staging（mkdtemp）→ rename 落位，EXDEV 降级 cpSync（照 pack-import 模式）。
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CharacterManifestSchema, type CharacterManifest } from '@openpet/protocol';
import { mapStCardToSoul, pickCharacterId, readStCard } from './st-card.js';

export interface StCardSummary {
  name: string;
  creator: string;
  version: string;
  greetingCount: number;
  lorebookCount: number;
  tags: string[];
  hasAvatar: boolean;
}

/** 两段式①：解析摘要（不安装）。坏卡抛错，调用侧包 RpcError。 */
export function inspectStCard(cardPath: string): StCardSummary {
  const { card, avatar } = readStCard(cardPath);
  const soul = mapStCardToSoul(card);
  return {
    name: soul.name,
    creator: soul.author ?? '',
    version: soul.version,
    greetingCount: soul.persona.greetings?.length ?? 0,
    lorebookCount: soul.lorebook?.entries.length ?? 0,
    tags: soul.tags ?? [],
    hasAvatar: avatar !== null,
  };
}

export interface InstallStCardOpts {
  cardPath: string;
  donorId: string;
  /** rootOf(donorId) 结果（builtin 或 userData 根均可作形象来源）。 */
  donorRoot: string;
  importedRoot: string;
  exists: (id: string) => boolean;
}

export function installStCard(opts: InstallStCardOpts): { id: string } {
  const { card, avatar } = readStCard(opts.cardPath);
  const soul = mapStCardToSoul(card);
  const donorDir = path.join(opts.donorRoot, opts.donorId);
  const donor = CharacterManifestSchema.parse(
    JSON.parse(readFileSync(path.join(donorDir, 'manifest.json'), 'utf8')),
  );
  const id = pickCharacterId(soul.name, opts.exists);
  const staging = mkdtempSync(path.join(tmpdir(), 'st-install-'));
  const stagingPack = path.join(staging, id);
  try {
    cpSync(donorDir, stagingPack, { recursive: true });
    const avatarFile = avatar ? `card.${avatar.ext}` : null;
    if (avatar && avatarFile) writeFileSync(path.join(stagingPack, avatarFile), avatar.buf);
    // 肉体承 donor（engine/model/词表/cues），灵魂来自卡；donor 的 id/voice/元数据不承（spec §3）。
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
      ...(avatarFile ? { preview: avatarFile } : donor.preview ? { preview: donor.preview } : {}),
      persona: soul.persona,
      ...(soul.lorebook ? { lorebook: soul.lorebook } : {}),
      ...(soul.author ? { author: soul.author } : {}),
      ...(soul.description ? { description: soul.description } : {}),
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
