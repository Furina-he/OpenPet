/** Key 遮罩：>8 留首尾各 4，其余全 •（§7.3「默认遮罩，点眼睛显示 5s」）。 */
export function maskKey(key: string, revealed: boolean): string {
  if (revealed) return key;
  if (key.length <= 8) return '•'.repeat(key.length);
  return key.slice(0, 4) + '•'.repeat(key.length - 8) + key.slice(-4);
}

interface TimerLike {
  set: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clear: (h: ReturnType<typeof setTimeout>) => void;
}

/** 显示 Key 后 holdMs 自动遮回；timer 可注入便于测。 */
export class KeyReveal {
  revealed = false;
  private h: ReturnType<typeof setTimeout> | null = null;
  constructor(
    private readonly holdMs = 5000,
    private readonly timer: TimerLike = { set: setTimeout, clear: clearTimeout },
  ) {}
  reveal(): void {
    if (this.h) this.timer.clear(this.h);
    this.revealed = true;
    this.h = this.timer.set(() => {
      this.revealed = false;
      this.h = null;
    }, this.holdMs);
  }
  hideNow(): void {
    if (this.h) this.timer.clear(this.h);
    this.revealed = false;
    this.h = null;
  }
}
