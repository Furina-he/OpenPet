/** Live2D 语义映射纯函数（spec §2.3）；live2d-runtime 调用，此处可 Vitest。 */
import type { CharacterManifest } from '@openpet/protocol';

/** 情绪 → 表情名。null=清表情(neutral)；undefined=词表无此情绪(no-op+warn)。 */
export function resolveEmotion(m: CharacterManifest, name: string): string | null | undefined {
  if (name === 'neutral') return null;
  return m.live2dEmotions?.[name];
}

/** 动作 → motion 组；无表项时兜底同名组（模型里没有该组则库层自然 no-op）。 */
export function resolveMotion(
  m: CharacterManifest,
  name: string,
): { group: string; index?: number } {
  const hit = m.live2dMotions?.[name];
  if (hit) {
    return hit.index !== undefined ? { group: hit.group, index: hit.index } : { group: hit.group };
  }
  return { group: name };
}

/** 拖拽速度 → Live2D 参数（度）；手感常数与 VRM 侧同源换算（rad→deg）。 */
const ANGLE_Z_PER_PXMS = 0.35 * (180 / Math.PI); // ≈20 deg per px/ms
const ANGLE_Z_MAX = 30;
const BODY_X_PER_PXMS = 4;
const BODY_X_MAX = 8;
const clampAbs = (v: number, max: number): number => Math.max(-max, Math.min(max, v));

export function dragToParams(vx: number, _vy: number): { angleZ: number; bodyAngleX: number } {
  return {
    angleZ: clampAbs(vx * ANGLE_Z_PER_PXMS, ANGLE_Z_MAX),
    bodyAngleX: clampAbs(Math.abs(vx) * BODY_X_PER_PXMS, BODY_X_MAX),
  };
}

export const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
