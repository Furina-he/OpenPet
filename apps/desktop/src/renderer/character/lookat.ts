/**
 * LookAt 数学（tech-design §7「LookAt / 鼠标追踪」）—— 纯函数三件套：
 *   屏幕坐标 → 窗口归一化（clamp ±2，窗外仍可远望）
 *   归一化 → 头前方目标平面的世界坐标（three-vrm lookAt target 用）
 *   指数阻尼（帧率无关）做平滑插值，消除 30Hz 输入的抖动
 * Main 侧 30Hz 节流见 cursor-publisher.ts；这里只做渲染端那一半。
 */
export interface Normalized {
  nx: number;
  ny: number;
}

const NORM_CLAMP = 2;

export function normalizedFromScreen(
  screenX: number,
  screenY: number,
  win: { x: number; y: number; width: number; height: number },
): Normalized {
  const clamp = (v: number): number => Math.min(NORM_CLAMP, Math.max(-NORM_CLAMP, v));
  const nx = clamp((screenX - win.x - win.width / 2) / (win.width / 2));
  // 屏幕 y 向下增长；ny 取「向上为正」符合世界坐标直觉
  const ny = clamp(-(screenY - win.y - win.height / 2) / (win.height / 2));
  return { nx, ny };
}

/** 目标平面参数：头前方 1.4m，横向/纵向各 ±0.6/±0.45m 摆幅（n=±1 时）。 */
const PLANE_DIST = 1.4;
const SPREAD_X = 0.6;
const SPREAD_Y = 0.45;

/**
 * 归一化注视点 → 世界坐标。相机在 +z 看向 -z（S3 布局：camera.position.z=2.2），
 * 角色面朝 +z；用户从屏幕看是镜像 —— 光标在屏幕右（nx>0），角色应看向自己的
 * 左侧（世界 -x）才显得"看着光标"。
 */
export function lookAtWorldTarget(
  head: { x: number; y: number; z: number },
  n: Normalized,
): { x: number; y: number; z: number } {
  return {
    x: head.x - n.nx * SPREAD_X,
    y: head.y + n.ny * SPREAD_Y,
    z: head.z + PLANE_DIST,
  };
}

/** 帧率无关的指数阻尼：lambda 越大跟随越紧（8 ≈ 100ms 走完 55%）。 */
export function damp(current: number, target: number, lambda: number, dtSec: number): number {
  return target + (current - target) * Math.exp(-lambda * dtSec);
}
