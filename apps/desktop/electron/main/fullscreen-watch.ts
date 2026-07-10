/**
 * 全屏检测（best-effort）。Electron 无跨平台"前台应用全屏"API：
 * probe() 由 index.ts 注入（Win 可用前台窗矩形≈屏幕；不可靠时 probe 恒 false，
 * 退化为仅手动隐藏）。**真机校准后调 isLikelyFullscreen 阈值**。
 */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function isLikelyFullscreen(win: Rect, screen: { w: number; h: number }): boolean {
  return win.x <= 0 && win.y <= 0 && win.w >= screen.w && win.h >= screen.h;
}

export interface FullscreenWatch {
  tick(): void;
  stop(): void;
}

export function createFullscreenWatch(deps: {
  probe: () => boolean;
  onChange: (fullscreen: boolean) => void;
  intervalMs?: number;
}): FullscreenWatch {
  // 基线假定"非全屏"：只在变为全屏 / 退出全屏的变化沿回调（初值 null 会误报一次 false）。
  let last = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  const tick = (): void => {
    const v = deps.probe();
    if (v !== last) {
      last = v;
      deps.onChange(v);
    }
  };
  if (deps.intervalMs) timer = setInterval(tick, deps.intervalMs);
  return {
    tick,
    stop: () => {
      if (timer) clearInterval(timer);
    },
  };
}
