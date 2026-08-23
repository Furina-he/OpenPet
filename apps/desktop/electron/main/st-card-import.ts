/**
 * ⑫ ST 卡安装（spec §3）：灵魂（卡文本）+ 肉体（复制已装形象包）合成新角色包。
 * ⑯ 起合成逻辑抽到 `soul-compose.ts`（与 `.dssoul` 灵魂包共用），本文件只做
 * 「读卡 → 映射灵魂 → 派生 id → 头像随包」的卡专属部分。
 */
import { composeFromDonor } from './soul-compose.js';
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
  const id = pickCharacterId(soul.name, opts.exists);
  const avatarFile = avatar ? `card.${avatar.ext}` : null;
  return composeFromDonor({
    soul,
    id,
    donorId: opts.donorId,
    donorRoot: opts.donorRoot,
    importedRoot: opts.importedRoot,
    ...(avatar && avatarFile
      ? { extraFiles: [{ relPath: avatarFile, data: avatar.buf }], preview: avatarFile }
      : {}),
  });
}
