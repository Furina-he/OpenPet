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

// ---- ⑱ 生命层 → Cubism 标准参数（spec §5）：纯映射，runtime 在 beforeModelUpdate 叠加写入 ----
const RAD2DEG = 180 / Math.PI;
const clampAbsN = (v: number, max: number): number => Math.max(-max, Math.min(max, v));

export interface LifeParamDeltas {
  /** 呼吸 0–1（叠加值，围绕 0）。 */
  ParamBreath: number;
  ParamAngleX: number;
  ParamAngleY: number;
  ParamAngleZ: number;
  ParamBodyAngleX: number;
  ParamEyeBallX: number;
  ParamEyeBallY: number;
}

/**
 * BoneOffsets（rad/m）+ 视线归一化 → Cubism 参数增量（度 / 归一化）。
 * 头部角度 ±30、身体 ±10、眼球 ±1 夹紧；视线同时带一点头部朝向（EyeBall 单独太"斗鸡眼"）。
 * AngleY：VRM headPitch 正 = 低头；Cubism AngleY 正 = 抬头 → 取反。
 */
export function lifeToParams(
  off: { headYaw: number; headPitch: number; headRoll: number; spineYaw: number; spineRoll: number; chestPitch: number },
  gaze: { nx: number; ny: number },
): LifeParamDeltas {
  const breathAmpMax = 0.03 * 1.3; // BREATH_AMP.high × sleepy 放大
  return {
    ParamBreath: clampAbsN(off.chestPitch / breathAmpMax, 1) * 0.5,
    ParamAngleX: clampAbsN(off.headYaw * RAD2DEG + gaze.nx * 12, 30),
    ParamAngleY: clampAbsN(-off.headPitch * RAD2DEG + gaze.ny * 8, 30),
    ParamAngleZ: clampAbsN(off.headRoll * RAD2DEG, 30),
    ParamBodyAngleX: clampAbsN((off.spineYaw + off.spineRoll) * RAD2DEG, 10),
    ParamEyeBallX: clampAbsN(gaze.nx, 1),
    ParamEyeBallY: clampAbsN(gaze.ny, 1),
  };
}

/** ⑱ energy → idle 组：IdleLow/IdleHigh 存在则用，否则回 Idle（模型没有该组 = 保持库默认）。 */
export function pickIdleGroup(available: readonly string[], energy: string, fallback = 'Idle'): string {
  const want = energy === 'low' ? 'IdleLow' : energy === 'high' ? 'IdleHigh' : fallback;
  if (available.includes(want)) return want;
  return available.includes(fallback) ? fallback : (available[0] ?? fallback);
}

/** ⑱ 节拍 → 动作名（live2dMotions 里查；缺则 no-op）。period 由调用方按 20% 掷骰。 */
export function beatMotionName(kind: 'question' | 'exclaim' | 'period'): 'tilt' | 'nod' {
  return kind === 'question' ? 'tilt' : 'nod';
}
