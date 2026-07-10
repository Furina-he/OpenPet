/**
 * 嘴型/播放速率纯函数（⑩.6 T5）——character 窗声画驱动的可测内核。
 * RMS 地板 0.02、增益 ×8 沿批次② 现值；strength = prefs voice.mouthStrength（0–2）。
 */
export function mouthValue(rms: number, strength: number): number {
  return Math.max(0, Math.min(1, (rms - 0.02) * 8 * strength));
}

/** voice.audio 广播的 rate → playbackRate（缺省/非法回 1；clamp 0.5–2 防御越界）。 */
export function playbackRateOf(rate: number | undefined): number {
  if (typeof rate !== 'number' || !Number.isFinite(rate)) return 1;
  return Math.max(0.5, Math.min(2, rate));
}
