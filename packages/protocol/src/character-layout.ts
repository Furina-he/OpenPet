import { z } from 'zod';

/**
 * ㉓ 角色缩放 v2 + 位置记忆（spec §6）：character 窗几何的对外形状。
 * Main `character-stage` 是唯一真源；character 窗 / Hub D4 经 `character.layout` 拉取、
 * `character.layoutChanged` 订阅。坐标一律 DIP。
 *
 * 窗口 = max(模型框, 最小画布)，模型框在窗口内底边居中；多出的透明「舞台边」给气泡 / toast 容身。
 */
export const LayoutRectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});
export type LayoutRect = z.infer<typeof LayoutRectSchema>;

export const CharacterLayoutSchema = z.object({
  /** 实际生效的缩放（吸附 / 夹 maxScale 之后）。 */
  scale: z.number(),
  /** 当前显示器上的上限：min(2, 工作区 ÷ 底座)，不低于 0.5。 */
  maxScale: z.number(),
  /** 像素精灵（sprite 且 `fit: integer`）：只在设备像素整数倍的清晰档之间切换。 */
  pixelSnap: z.boolean(),
  /** 所在显示器的缩放因子（像素档位「k×」文案用）。 */
  dpr: z.number(),
  /** 菜单 / D4 档位（常规 50–200% 六档；像素 = 清晰档）；> maxScale 的由调用方置灰。 */
  presets: z.array(z.number()),
  window: z.object({ width: z.number(), height: z.number() }),
  /** 模型框在窗口内的矩形。 */
  model: LayoutRectSchema,
  screen: z.object({ workArea: LayoutRectSchema, windowBounds: LayoutRectSchema }),
});
export type CharacterLayout = z.infer<typeof CharacterLayoutSchema>;

/** 位置记录：脚底锚点相对所在显示器工作区的比例（0–1）。 */
export const PlacementPointSchema = z.object({
  rx: z.number().min(0).max(1),
  ry: z.number().min(0).max(1),
});
export type PlacementPoint = z.infer<typeof PlacementPointSchema>;

/**
 * 位置记忆（F-DT-02）：同一条记录双键写入——显示器 id 与工作区分辨率 `宽x高`（Windows 驱动更新 /
 * 重插后 id 可能变，照 Codex 按分辨率找回）；位置属于桌宠而非某个角色。
 */
export const CharacterPlacementSchema = z.object({
  lastDisplayId: z.string(),
  byDisplay: z.record(PlacementPointSchema),
  byResolution: z.record(PlacementPointSchema),
});
export type CharacterPlacement = z.infer<typeof CharacterPlacementSchema>;

export const emptyPlacement = (): CharacterPlacement => ({
  lastDisplayId: '',
  byDisplay: {},
  byResolution: {},
});
