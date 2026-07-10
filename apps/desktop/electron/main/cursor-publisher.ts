/**
 * LookAt 光标源（tech-design §7）：Main 以 ~30Hz 轮询全局光标，值变化才推
 * `behavior.lookAt` 到 character 窗口；静止时每 2s keepalive 重发一拍——
 * renderer 崩溃自愈/启动慢会丢早先的快照，keepalive 保证它最终拿到朝向。
 *
 * 不走 NotificationQueue —— 那是 per-session 的 chat 背压队列（cancel 会
 * dropSession），光标是常驻无 session 流；直发 + 变化去重本身就是节流。
 * 依赖全注入（getCursor/send），纯定时器逻辑可 fake-timers 单测。
 */
export const CURSOR_INTERVAL_MS = 33; // ~30Hz
export const CURSOR_KEEPALIVE_MS = 2_000;

export interface CursorPublisherDeps {
  getCursor: () => { x: number; y: number };
  send: (point: { x: number; y: number }) => void;
}

export function startCursorPublisher(deps: CursorPublisherDeps): { stop: () => void } {
  let last: { x: number; y: number } | null = null;
  let lastSentAt = -Infinity;
  let elapsed = 0;

  const sample = (): void => {
    let p: { x: number; y: number };
    try {
      p = deps.getCursor();
    } catch {
      return; // screen API 偶发失败（锁屏/会话切换）：跳过本拍
    }
    const unchanged = last !== null && last.x === p.x && last.y === p.y;
    if (unchanged && elapsed - lastSentAt < CURSOR_KEEPALIVE_MS) return;
    last = { x: p.x, y: p.y };
    lastSentAt = elapsed;
    deps.send(last);
  };

  sample(); // 首拍必发：静止光标也要有初始朝向
  const timer = setInterval(() => {
    elapsed += CURSOR_INTERVAL_MS;
    sample();
  }, CURSOR_INTERVAL_MS);
  return { stop: () => clearInterval(timer) };
}
