/**
 * 90s 空闲监视（tech-design §7「主动行为」的渲染端半边）：
 * 活动源（behavior.* 与 chat.done 通知、窗口 pointerdown）调 activity()；
 * tick() 由低频定时器驱动（5s 粒度足够，不追求精确到帧）。
 * 触发后解除武装、等下次活动重武装 —— 不连发。时钟注入，纯逻辑可单测。
 */
export const IDLE_TIMEOUT_MS = 90_000;

export class IdleWatch {
  private lastActivity: number | null = null;
  private armed = false;

  constructor(
    private readonly timeoutMs: number,
    private readonly onIdle: (idleMs: number) => void,
  ) {}

  activity(nowMs: number): void {
    this.lastActivity = nowMs;
    this.armed = true;
  }

  tick(nowMs: number): void {
    if (!this.armed || this.lastActivity === null) return;
    const idleMs = nowMs - this.lastActivity;
    if (idleMs >= this.timeoutMs) {
      this.armed = false;
      this.onIdle(idleMs);
    }
  }
}
