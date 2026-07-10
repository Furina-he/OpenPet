/** 启动/内存性能埋点（PRD §7 预算：冷启动 <3s / 空闲内存 <400MB）。注入时钟/日志，纯逻辑可测。 */
export class PerfMarks {
  private marks = new Map<string, number>();
  constructor(private deps: { now?: () => number; log?: (msg: string) => void } = {}) {}
  private now(): number {
    return (this.deps.now ?? Date.now)();
  }
  mark(name: string): void {
    this.marks.set(name, this.now());
  }
  measure(from: string, label: string): void {
    const t0 = this.marks.get(from);
    if (t0 === undefined) return;
    (this.deps.log ?? console.info)(`[perf] ${label} ${this.now() - t0}ms`);
  }
}
