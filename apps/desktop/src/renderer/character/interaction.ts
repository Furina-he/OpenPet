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
import { tapZone, classifyPress } from './interaction-zones';

const ENTER = 26; // ~0.10 * 255
const EXIT = 13; // ~0.05 * 255
const MOVE_THROTTLE_MS = 33; // ~30Hz
const LONG_PRESS_MS = 200;

export function setupInteraction(renderer: THREE.WebGLRenderer | null): void {
  const shared = { dragging: false };
  if (renderer) setupClickThrough(renderer, shared);
  setupDrag(renderer?.domElement ?? document.body, shared);
  setupClicks(renderer?.domElement ?? document.body);
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

/** A1 点击交互：轻点（头/身）上报 character.tap、双击开聊天、右键弹菜单、hover>800ms 提示。 */
function setupClicks(target: HTMLElement): void {
  let downT = 0;
  let downX = 0;
  let downY = 0;
  let moved = false;
  let hoverTimer: number | null = null;

  target.addEventListener('mousedown', (e: MouseEvent) => {
    downT = performance.now();
    downX = e.screenX;
    downY = e.screenY;
    moved = false;
  });
  window.addEventListener('mousemove', (e: MouseEvent) => {
    if (Math.abs(e.screenX - downX) > 3 || Math.abs(e.screenY - downY) > 3) moved = true;
  });
  target.addEventListener('mouseup', (e: MouseEvent) => {
    if (classifyPress({ downT, upT: performance.now(), moved }, LONG_PRESS_MS) !== 'tap') return;
    const zone = tapZone(e.clientY, window.innerHeight);
    // 只上报 Main，由其广播 behavior（character 保持哑播放器，不自行决策动作）。
    void window.desksoul.rpc('character.tap', { zone });
  });
  target.addEventListener('dblclick', () => {
    void window.desksoul.rpc('app.window.showChat', {});
  });
  target.addEventListener('contextmenu', (e: MouseEvent) => {
    e.preventDefault();
    void window.desksoul.rpc('app.window.popCharacterMenu', {});
  });

  // hover>800ms 悬浮提示（character 窗内 DOM #tooltip）。
  target.addEventListener('mousemove', () => {
    if (hoverTimer !== null) clearTimeout(hoverTimer);
    hoverTimer = window.setTimeout(showTooltip, 800);
  });
  target.addEventListener('mouseleave', () => {
    if (hoverTimer !== null) {
      clearTimeout(hoverTimer);
      hoverTimer = null;
    }
    hideTooltip();
  });
}

function showTooltip(): void {
  document.getElementById('tooltip')?.classList.add('tooltip-show');
}
function hideTooltip(): void {
  document.getElementById('tooltip')?.classList.remove('tooltip-show');
}
