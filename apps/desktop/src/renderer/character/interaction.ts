/**
 * Character 窗口交互（S1 验证形态）：
 *  - alpha 命中穿透：30Hz 节流 readPixels + 双阈值迟滞 + 高 DPI 像素换算
 *  - 长按 200ms 拖拽：增量经 app.window.moveBy 移动窗口
 *  - 耦合（必须保留）：拖拽期间冻结穿透切换，否则窗口中途变穿透后
 *    mouseup 落到桌面、dragging 永不复位（S1 实证）。
 * 引擎中立：只吃 HitSurface（canvas + gl + pixelRatio），three/pixi 实现各自组装。
 * 加载失败的 fallback（DOM 脸）没有 alpha buffer：传 null，仅启用拖拽、不开穿透。
 */
import type { HitSurface } from './runtime-types';
import { nextIgnore } from './hysteresis';
import {
  tapZone,
  classifyPress,
  detectStroke,
  LONG_PRESS_MS as GESTURE_LONG_PRESS_MS,
  type HoverSample,
} from './interaction-zones';
import { dragState } from './drag-state';

const ENTER = 26; // ~0.10 * 255
const EXIT = 13; // ~0.05 * 255
const MOVE_THROTTLE_MS = 33; // ~30Hz
const LONG_PRESS_MS = 200;
/** 抚摸 hover 采样节流 / 滚动窗口 / 命中后本地节流（F-IT-01）。 */
const STROKE_SAMPLE_MS = 30;
const STROKE_WINDOW_MS = 1400;
const STROKE_THROTTLE_MS = 2000;

export function setupInteraction(surface: HitSurface | null): void {
  const shared = { dragging: false };
  if (surface) setupClickThrough(surface, shared);
  setupDrag(surface?.canvas ?? document.body, shared);
  setupClicks(surface?.canvas ?? document.body);
  setupFileDrop();
}

function setupClickThrough(surface: HitSurface, shared: { dragging: boolean }): void {
  const gl = surface.gl;
  const px = new Uint8Array(4);
  let lastIgnore: boolean | null = null;
  let lastT = 0;

  function checkAlpha(clientX: number, clientY: number): void {
    // clientX/Y 是 CSS 像素，drawing buffer 是 device 像素：按 pixelRatio 换算
    // 再翻转 y 轴（GL 原点在左下）。150% 缩放下命中才正确（S1 实证）。
    const dpr = surface.pixelRatio;
    const bufW = surface.canvas.width;
    const bufH = surface.canvas.height;
    const x = Math.floor(clientX * dpr);
    const y = Math.floor(bufH - clientY * dpr);
    if (x < 0 || y < 0 || x >= bufW || y >= bufH) return;

    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const ignore = nextIgnore(px[3] ?? 0, lastIgnore, { enter: ENTER, exit: EXIT });
    if (ignore !== lastIgnore) {
      lastIgnore = ignore;
      void window.openpet.rpc('app.window.setClickThrough', { ignore });
    }
  }

  window.addEventListener('mousemove', (e: MouseEvent) => {
    if (shared.dragging) return; // 拖拽期间冻结穿透切换
    const now = performance.now();
    if (now - lastT < MOVE_THROTTLE_MS) return;
    lastT = now;
    checkAlpha(e.clientX, e.clientY);
  });

  // 鼠标进入 canvas 时立即检查一次：否则 ignore 态下静止点击会丢 mousedown。
  surface.canvas.addEventListener('mouseenter', (e: MouseEvent) => {
    checkAlpha(e.clientX, e.clientY);
  });
}

function setupDrag(target: HTMLElement, shared: { dragging: boolean }): void {
  let pressTimer: number | null = null;
  let lastX = 0;
  let lastY = 0;
  let lastT = 0;
  let dragStarted = false;

  target.addEventListener('mousedown', (e: MouseEvent) => {
    lastX = e.screenX;
    lastY = e.screenY;
    lastT = performance.now();
    pressTimer = window.setTimeout(() => {
      shared.dragging = true;
    }, LONG_PRESS_MS);
  });

  window.addEventListener('mousemove', (e: MouseEvent) => {
    if (!shared.dragging) return;
    const dx = e.screenX - lastX;
    const dy = e.screenY - lastY;
    lastX = e.screenX;
    lastY = e.screenY;
    if (dx !== 0 || dy !== 0) {
      const now = performance.now();
      const dt = Math.max(1, now - lastT);
      lastT = now;
      if (!dragStarted) {
        // 真正开始位移才算拖拽（按住不动是长按，不冲突）。
        dragStarted = true;
        dragState.active = true;
        dragState.vx = 0;
        dragState.vy = 0;
        void window.openpet.rpc('character.gesture', { zone: 'body', kind: 'dragStart' });
      }
      // 指数平滑速度（px/ms）——runtime 帧循环消费做拎起摆动。
      dragState.vx = 0.7 * dragState.vx + 0.3 * (dx / dt);
      dragState.vy = 0.7 * dragState.vy + 0.3 * (dy / dt);
      void window.openpet.rpc('app.window.moveBy', { dx, dy });
    }
  });

  window.addEventListener('mouseup', () => {
    if (pressTimer !== null) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
    if (dragStarted) {
      dragStarted = false;
      dragState.active = false; // runtime 转入 0.4s 弹性回归
      void window.openpet.rpc('character.gesture', { zone: 'body', kind: 'dragEnd' });
    }
    shared.dragging = false;
  });
}

/**
 * A1/F-IT-01 点击与手势：tap（头/身）/ 长按 600ms / hover 抚摸 → character.gesture 统一上报，
 * 双击开聊天、右键弹菜单、hover>800ms 提示。
 */
function setupClicks(target: HTMLElement): void {
  let downT = 0;
  let downX = 0;
  let downY = 0;
  let moved = false;
  let pressed = false;
  let hoverTimer: number | null = null;
  let longTimer: number | null = null;
  let longConsumed = false; // 长按已上报 → 抬起不再发 tap
  let strokeSamples: HoverSample[] = [];
  let lastSampleT = 0;
  let strokeMutedUntil = 0;

  const cancelLongTimer = (): void => {
    if (longTimer !== null) {
      clearTimeout(longTimer);
      longTimer = null;
    }
  };

  target.addEventListener('mousedown', (e: MouseEvent) => {
    downT = performance.now();
    downX = e.screenX;
    downY = e.screenY;
    moved = false;
    pressed = true;
    longConsumed = false;
    strokeSamples = []; // 按压期间不算抚摸
    const zone = tapZone(e.clientY, window.innerHeight);
    cancelLongTimer();
    // 长按：≥600ms 未移动未抬起（移动/抬起取消）。与拖拽不冲突——拖拽=按住移动。
    longTimer = window.setTimeout(() => {
      longTimer = null;
      if (!moved) {
        longConsumed = true;
        void window.openpet.rpc('character.gesture', { zone, kind: 'long' });
      }
    }, GESTURE_LONG_PRESS_MS);
  });
  window.addEventListener('mousemove', (e: MouseEvent) => {
    if (Math.abs(e.screenX - downX) > 3 || Math.abs(e.screenY - downY) > 3) moved = true;
    if (pressed && moved) cancelLongTimer();
  });
  target.addEventListener('mouseup', (e: MouseEvent) => {
    pressed = false;
    cancelLongTimer();
    if (longConsumed) return;
    if (classifyPress({ downT, upT: performance.now(), moved }, LONG_PRESS_MS) !== 'tap') return;
    const zone = tapZone(e.clientY, window.innerHeight);
    // 只上报 Main，由其经 InteractionService 查 cue 表广播（character 保持哑播放器）。
    void window.openpet.rpc('character.gesture', { zone, kind: 'tap' });
  });
  target.addEventListener('dblclick', () => {
    void window.openpet.rpc('app.window.showChat', {});
  });
  target.addEventListener('contextmenu', (e: MouseEvent) => {
    e.preventDefault();
    void window.openpet.rpc('app.window.popCharacterMenu', {});
  });

  // hover>800ms 悬浮提示（character 窗内 DOM #tooltip）+ 抚摸轨迹采样（不按键）。
  target.addEventListener('mousemove', (e: MouseEvent) => {
    if (hoverTimer !== null) clearTimeout(hoverTimer);
    hoverTimer = window.setTimeout(showTooltip, 800);

    if (pressed) return; // 按压/拖拽期间不算抚摸
    const now = performance.now();
    if (now - lastSampleT < STROKE_SAMPLE_MS) return;
    lastSampleT = now;
    strokeSamples.push({
      x: e.clientX,
      t: now,
      head: tapZone(e.clientY, window.innerHeight) === 'head',
    });
    while (strokeSamples.length > 0 && now - strokeSamples[0]!.t > STROKE_WINDOW_MS) {
      strokeSamples.shift();
    }
    if (now >= strokeMutedUntil && detectStroke(strokeSamples)) {
      strokeSamples = [];
      strokeMutedUntil = now + STROKE_THROTTLE_MS;
      void window.openpet.rpc('character.gesture', { zone: 'head', kind: 'stroke' });
    }
  });
  target.addEventListener('mouseleave', () => {
    if (hoverTimer !== null) {
      clearTimeout(hoverTimer);
      hoverTimer = null;
    }
    strokeSamples = [];
    hideTooltip();
  });
}

/** F-IT-06 文件拖到角色：阻止默认（不打开文件），上报 fileDrop（真处理留后续 Agent 能力）。 */
function setupFileDrop(): void {
  window.addEventListener('dragover', (e: DragEvent) => e.preventDefault());
  window.addEventListener('drop', (e: DragEvent) => {
    e.preventDefault();
    void window.openpet.rpc('character.gesture', {
      zone: tapZone(e.clientY, window.innerHeight),
      kind: 'fileDrop',
    });
  });
}

function showTooltip(): void {
  document.getElementById('tooltip')?.classList.add('tooltip-show');
}
function hideTooltip(): void {
  document.getElementById('tooltip')?.classList.remove('tooltip-show');
}
