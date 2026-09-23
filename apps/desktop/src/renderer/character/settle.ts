/**
 * ⑱ 阻尼振荡"回归"公式（spec §2.5）——拖拽松手回弹（runtime.ts / live2d-runtime.ts）与
 * 动作余震共用同一组常数与函数，不许各写一份。
 *   settle(t)      = e^{-t/τ} · cos(ωt)   从振幅 1 起、一次过冲后收敛（松手回归）
 *   settleFromZero = e^{-t/τ} · sin(ωt)   从 0 起、一次过冲后收敛（动作余震；峰值归一到 1）
 */
export const SETTLE_TAU_MS = 130; // 0.4s ≈ 3τ → 衰至 ~5%
export const SETTLE_OMEGA = 0.016; // rad/ms：0.4s 内一次 overshoot

export function settle(tMs: number, tau = SETTLE_TAU_MS, omega = SETTLE_OMEGA): number {
  return Math.exp(-tMs / tau) * Math.cos(omega * tMs);
}

/** sin 变体的峰值（t* = atan(ωτ)/ω），用于归一。 */
const PEAK_T = Math.atan(SETTLE_OMEGA * SETTLE_TAU_MS) / SETTLE_OMEGA;
const PEAK_V = Math.exp(-PEAK_T / SETTLE_TAU_MS) * Math.sin(SETTLE_OMEGA * PEAK_T);

/** 从 0 起的阻尼振荡，峰值归一到 1（t≈98ms 处）。 */
export function settleFromZero(tMs: number): number {
  if (tMs <= 0) return 0;
  return (Math.exp(-tMs / SETTLE_TAU_MS) * Math.sin(SETTLE_OMEGA * tMs)) / PEAK_V;
}
