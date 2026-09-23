/**
 * ⑳ Hub 精灵缩略图纯逻辑（SpriteThumb.vue 薄渲染）：CSS 背景切帧——Hub 不载 pixi。
 * 格尺寸：custom = 作者声明；codex 未声明 = 图片天然尺寸 ÷ (8, 9)（与运行时 frameRects 同口径）。
 */
import {
  CODEX_LAYOUT,
  resolveSprite,
  type ResolvedSprite,
  type SpriteSheet,
} from '@openpet/protocol';

export interface Cell {
  width: number;
  height: number;
}

export function cellFromImage(resolved: Pick<ResolvedSprite, 'cell'>, naturalW: number, naturalH: number): Cell {
  if (resolved.cell) return { ...resolved.cell };
  return {
    width: Math.floor(naturalW / CODEX_LAYOUT.columns),
    height: Math.floor(naturalH / CODEX_LAYOUT.rows),
  };
}

/** 把一格等比放进 boxW×boxH（contain）。 */
export function thumbScale(cell: Cell, boxW: number, boxH: number): number {
  if (cell.width <= 0 || cell.height <= 0) return 1;
  return Math.min(boxW / cell.width, boxH / cell.height);
}

/** 第 frame 帧的 CSS 背景定位与尺寸（整张图按 scale 缩放后平移到该格）。 */
export function frameBackground(
  state: { row: number; col: number },
  frame: number,
  cell: Cell,
  scale: number,
  sheet: { width: number; height: number },
): { backgroundPosition: string; backgroundSize: string } {
  const x = (state.col + frame) * cell.width * scale;
  const y = state.row * cell.height * scale;
  return {
    backgroundPosition: `${-x}px ${-y}px`,
    backgroundSize: `${sheet.width * scale}px ${sheet.height * scale}px`,
  };
}

/** 安全展开（非法描述 → null，缩略图降级为占位）。 */
export function tryResolveSprite(sheet: SpriteSheet | undefined): ResolvedSprite | null {
  if (!sheet) return null;
  try {
    return resolveSprite(sheet);
  } catch {
    return null;
  }
}

/** 试播：情绪 → 预览状态（enter 优先，其次 loop）；未映射 = null（程序化，缩略图无从表现）。 */
export function emotionPreviewState(resolved: ResolvedSprite, name: string): string | null {
  const e = resolved.emotions[name];
  return e?.enter ?? e?.loop ?? null;
}

/** 试播：动作 → 映射行；未映射 = null。 */
export function actionPreviewState(resolved: ResolvedSprite, name: string): string | null {
  return resolved.actions[name] ?? null;
}
