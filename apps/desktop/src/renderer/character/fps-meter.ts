/**
 * FPS 监控（tech-design §7 性能预算）：每秒一桶计帧，30s 滚动平均。
 * 判据看滚动平均而非瞬时（S3 同口径）。纯逻辑、时间戳注入，可单测。
 */
export const FPS_WINDOW_MS = 30_000;

export class FpsMeter {
  /** [秒桶起点 ms, 帧数] 列表（最多 window/1000 + 1 项）。 */
  private buckets: Array<[number, number]> = [];

  tick(nowMs: number): void {
    const second = Math.floor(nowMs / 1000) * 1000;
    const lastEntry = this.buckets[this.buckets.length - 1];
    if (lastEntry && lastEntry[0] === second) {
      lastEntry[1] += 1;
    } else {
      this.buckets.push([second, 1]);
      const cutoff = second - FPS_WINDOW_MS;
      while (this.buckets.length > 0 && this.buckets[0]![0] <= cutoff) this.buckets.shift();
    }
  }

  /** 30s 窗口平均 FPS；不足 1 个完整秒桶时返回 0（当前进行中的桶不计）。 */
  average(): number {
    if (this.buckets.length <= 1) return 0;
    const complete = this.buckets.slice(0, -1); // 最后一桶未满一秒，丢弃
    const frames = complete.reduce((sum, [, n]) => sum + n, 0);
    return frames / complete.length;
  }
}
