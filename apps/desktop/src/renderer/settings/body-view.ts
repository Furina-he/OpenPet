/**
 * ⑰ E1「形象」tab 纯逻辑（肉体包卡片 VM / 换形象目标筛选 / 已装判定）；SFC 只做薄渲染。
 * 形象包 preview 走 asset:// 第三根（bodies），与角色卡片同一套 URL 形状。
 */
import type { BodyPack } from '@openpet/protocol';
import { spriteSourceOf, type SpriteThumbSource } from './character-library-view.js';

export interface InstalledBodyLike {
  body: BodyPack;
  sizeBytes: number;
  installedAt: number;
}

export interface BodyCardVm {
  id: string;
  name: string;
  version: string;
  engine: string;
  license: string | null;
  author: string | null;
  description: string | null;
  tags: string[];
  previewUrl: string | null;
  /** ⑳ 帧动画缩略图数据源（非 sprite = null）。 */
  sprite: SpriteThumbSource | null;
  sizeBytes: number;
  installedAt: number;
}

export function toBodyCard(item: InstalledBodyLike): BodyCardVm {
  const b = item.body;
  return {
    id: b.id,
    name: b.name,
    version: b.version,
    engine: b.engine,
    license: b.license ?? null,
    author: b.author ?? null,
    description: b.description ?? null,
    tags: b.tags ?? [],
    previewUrl: b.preview ? `asset://${b.id}/${b.preview}` : null,
    sprite: spriteSourceOf(b.id, b),
    sizeBytes: item.sizeBytes,
    installedAt: item.installedAt,
  };
}

export interface SwapTargetLike {
  characterId: string;
  builtin: boolean;
  manifest: { name: string; engine: string };
}

export interface SwapTargetVm {
  id: string;
  name: string;
  engine: string;
}

/**
 * 可换形象的角色 = 仅导入包（内置只读，照 updateManifest 口径「复制后编辑」）。
 * 空表 = UI 给「先复制一份内置角色」的引导，而不是弹一个选不了的下拉。
 */
export function swapTargets(items: readonly SwapTargetLike[]): SwapTargetVm[] {
  return items
    .filter((c) => !c.builtin)
    .map((c) => ({ id: c.characterId, name: c.manifest.name, engine: c.manifest.engine }));
}

/** 换形象是否跨引擎（弹窗多给一句提示：动作/表情表整组换代）。 */
export function isCrossEngine(
  target: { manifest: { engine: string } } | null,
  body: { engine: string } | null,
): boolean {
  return !!target && !!body && target.manifest.engine !== body.engine;
}

/** 市场「已装」判定用：把形象库映射成与角色列表同形状的池子。 */
export function bodiesAsInstalled(
  bodies: readonly InstalledBodyLike[],
): Array<{ characterId: string; manifest: { version: string } }> {
  return bodies.map((b) => ({ characterId: b.body.id, manifest: { version: b.body.version } }));
}
