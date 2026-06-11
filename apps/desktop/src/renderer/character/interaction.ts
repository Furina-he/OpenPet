/**
 * Character 窗口交互（S1 验证形态）：
 *  - alpha 命中穿透：30Hz 节流 readPixels + 双阈值迟滞 + 高 DPI 像素换算
 *  - 长按 200ms 拖拽：增量经 app.window.moveBy 移动窗口
 *  - 耦合（必须保留）：拖拽期间冻结穿透切换，否则窗口中途变穿透后
 *    mouseup 落到桌面、dragging 永不复位（S1 实证）。
 * VRM 加载失败的 fallback（DOM 脸）没有 alpha buffer：renderer 传 null，
 * 仅启用拖拽、不开穿透。
 */
import type * as THREE from 'three';
import { nextIgnore } from './hysteresis';

const ENTER = 26; // ~0.10 * 255
const EXIT = 13; // ~0.05 * 255
const MOVE_THROTTLE_MS = 33; // ~30Hz
const LONG_PRESS_MS = 200;

export function setupInteraction(renderer: THREE.WebGLRenderer | null): void {
  const shared = { dragging: false };
  if (renderer) setupClickThrough(renderer, shared);
  setupDrag(renderer?.domElement ?? document.body, shared);
}

function setupClickThrough(renderer: THREE.WebGLRenderer, shared: { dragging: boolean }): void {
  const gl = renderer.getContext();
  const px = new Uint8Array(4);
  let lastIgnore: boolean | null = null;
  let lastT = 0;

  function checkAlpha(clientX: number, clientY: number): void {
    // clientX/Y 是 CSS 像素，drawing buffer 是 device 像素：按 pixelRatio 换算
    // 再翻转 y 轴（GL 原点在左下）。150% 缩放下命中才正确（S1 实证）。
    const dpr = renderer.getPixelRatio();
    const bufW = renderer.domElement.width;
    const bufH = renderer.domElement.height;
    const x = Math.floor(clientX * dpr);
    const y = Math.floor(bufH - clientY * dpr);
    if (x < 0 || y < 0 || x >= bufW || y >= bufH) return;

    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const ignore = nextIgnore(px[3] ?? 0, lastIgnore, { enter: ENTER, exit: EXIT });
    if (ignore !== lastIgnore) {
      lastIgnore = ignore;
      void window.desksoul.rpc('app.window.setClickThrough', { ignore });
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
  renderer.domElement.addEventListener('mouseenter', (e: MouseEvent) => {
    checkAlpha(e.clientX, e.clientY);
  });
}

function setupDrag(target: HTMLElement, shared: { dragging: boolean }): void {
  let pressTimer: number | null = null;
  let lastX = 0;
  let lastY = 0;

  target.addEventListener('mousedown', (e: MouseEvent) => {
    lastX = e.screenX;
    lastY = e.screenY;
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
    if (dx !== 0 || dy !== 0) void window.desksoul.rpc('app.window.moveBy', { dx, dy });
  });

  window.addEventListener('mouseup', () => {
    if (pressTimer !== null) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
    shared.dragging = false;
  });
}
