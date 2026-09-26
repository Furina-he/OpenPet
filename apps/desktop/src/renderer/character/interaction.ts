/**
 * Character 窗口交互（S1 验证形态）：
 *  - alpha 命中穿透：30Hz 节流 readPixels + 双阈值迟滞 + 高 DPI 像素换算
 *  - 长按 200ms 拖拽：增量经 app.window.moveBy 移动窗口
 *  - 耦合（必须保留）：拖拽期间冻结穿透切换，否则窗口中途变穿透后
 *    mouseup 落到桌面、dragging 永不复位（S1 实证）。
 *  - ㉓ 画布只占模型框（窗口多出透明舞台边）：client 先减画布 rect，画布外 = 透明。几何变化后按
 *    「最后已知光标 − 新窗口原点」重判（窗口原点会动、光标不动就没有 mousemove）；滚轮手势与全局
 *    穿透（A3）同拖拽一样冻结穿透切换。
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
  type ContentBox,
} from './interaction-zones';
import { dragState } from './drag-state';
import { HitGate, bufferPixel, clientFromScreen, type Point } from './hit-recheck';

const ENTER = 26; // ~0.10 * 255
const EXIT = 13; // ~0.05 * 255
const MOVE_THROTTLE_MS = 33; // ~30Hz
const LONG_PRESS_MS = 200;
/** 抚摸 hover 采样节流 / 滚动窗口 / 命中后本地节流（F-IT-01）。 */
const STROKE_SAMPLE_MS = 30;
const STROKE_WINDOW_MS = 1400;
const STROKE_THROTTLE_MS = 2000;

export interface InteractionHandle {
  /** 几何变了（缩放 / 换形象 / 换屏）：等下一帧渲染完，按最后已知光标重判穿透。 */
  recheck(): void;
  /** Ctrl+滚轮手势期间冻结穿透切换；解冻即重判。 */
  freezeWheel(on: boolean): void;
  /** 全局穿透（display.clickThrough）开着：逐像素逻辑不得把窗口改回可点；关掉后重判。 */
  setLocked(on: boolean): void;
  /** 最新光标屏幕坐标（behavior.lookAt / wheel 事件），重判用。 */
  noteCursor(x: number, y: number): void;
  /** 拖拽中（长按已生效）——滚轮手势据此忽略。 */
  dragging(): boolean;
}

/** ㉓ contour：分区轮廓（窗口坐标；精灵轮廓 + 模型框偏移 ?? 模型框）。 */
export function setupInteraction(
  surface: HitSurface | null,
  contour: () => ContentBox,
): InteractionHandle {
  const gate = new HitGate();
  const hit = surface ? setupClickThrough(surface, gate) : null;
  const recheck = (): void => hit?.recheck();
  const drag = setupDrag(surface?.canvas ?? document.body, gate, recheck);
  setupClicks(surface?.canvas ?? document.body, contour);
  setupFileDrop(contour);
  return {
    recheck,
    freezeWheel(on) {
      if (gate.set('wheel', on)) recheck();
    },
    setLocked(on) {
      if (gate.has('locked') === on) return;
      hit?.forget(); // Main 已按全局开关整窗施加过：本地记的最后状态作废，解锁后第一次判定必发
      if (gate.set('locked', on)) recheck();
    },
    noteCursor: (x, y) => hit?.noteCursor(x, y),
    dragging: drag.dragging,
  };
}

function setupClickThrough(
  surface: HitSurface,
  gate: HitGate,
): { recheck(): void; noteCursor(x: number, y: number): void; forget(): void } {
  const gl = surface.gl;
  const px = new Uint8Array(4);
  let lastIgnore: boolean | null = null;
  let lastT = 0;
  let cursor: Point | null = null;
  let pending = 0;

  function checkAlpha(clientX: number, clientY: number): void {
    if (gate.frozen) return;
    // CSS 像素 → 画布局部 → ×pixelRatio → 翻 y（GL 原点在左下）；150% 缩放下命中才正确（S1 实证）。
    const p = bufferPixel(
      { x: clientX, y: clientY },
      surface.canvas.getBoundingClientRect(),
      surface.pixelRatio,
      surface.canvas,
    );
    let alpha = 0; // 画布外（透明舞台边）= 透明
    if (p) {
      gl.readPixels(p.x, p.y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      alpha = px[3] ?? 0;
    }
    const ignore = nextIgnore(alpha, lastIgnore, { enter: ENTER, exit: EXIT });
    if (ignore !== lastIgnore) {
      lastIgnore = ignore;
      void window.openpet.rpc('app.window.setClickThrough', { ignore });
    }
  }

  /** 等下一帧渲染完再读（resize 会清空 drawing buffer；窗口原点也要等新的 screenX/Y 到位）。 */
  function recheck(): void {
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(() => {
      pending = requestAnimationFrame(() => {
        pending = 0;
        if (!cursor) return;
        const c = clientFromScreen(cursor, { x: window.screenX, y: window.screenY });
        checkAlpha(c.x, c.y);
      });
    });
  }

  window.addEventListener('mousemove', (e: MouseEvent) => {
    cursor = { x: e.screenX, y: e.screenY };
    if (gate.frozen) return; // 拖拽 / 滚轮手势期间冻结穿透切换
    const now = performance.now();
    if (now - lastT < MOVE_THROTTLE_MS) return;
    lastT = now;
    checkAlpha(e.clientX, e.clientY);
  });

  // 鼠标进入 canvas 时立即检查一次：否则 ignore 态下静止点击会丢 mousedown。
  surface.canvas.addEventListener('mouseenter', (e: MouseEvent) => {
    cursor = { x: e.screenX, y: e.screenY };
    checkAlpha(e.clientX, e.clientY);
  });

  return {
    recheck,
    noteCursor(x, y) {
      cursor = { x, y };
      // 首判：reload（切角色 / 换形象）后窗口还挂着上一页的穿透态，光标静止时没有 mousemove。
      const inside =
        x >= window.screenX &&
        y >= window.screenY &&
        x < window.screenX + window.innerWidth &&
        y < window.screenY + window.innerHeight;
      if (lastIgnore === null && pending === 0 && inside) recheck();
    },
    forget() {
      lastIgnore = null;
    },
  };
}

function setupDrag(
  target: HTMLElement,
  gate: HitGate,
  recheck: () => void,
): { dragging: () => boolean } {
  let pressTimer: number | null = null;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let lastT = 0;
  let dragStarted = false;

  target.addEventListener('mousedown', (e: MouseEvent) => {
    lastX = e.screenX;
    lastY = e.screenY;
    lastT = performance.now();
    pressTimer = window.setTimeout(() => {
      dragging = true;
      gate.set('drag', true);
    }, LONG_PRESS_MS);
  });

  window.addEventListener('mousemove', (e: MouseEvent) => {
    if (!dragging) return;
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
    dragging = false;
    if (gate.set('drag', false)) recheck();
  });

  return { dragging: () => dragging };
}

/**
 * A1/F-IT-01 点击与手势：tap（头/身）/ 长按 600ms / hover 抚摸 → character.gesture 统一上报，
 * 双击开聊天、右键弹菜单、hover>800ms 提示。
 */
function setupClicks(target: HTMLElement, contour: () => ContentBox): void {
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
    const zone = tapZone(e.clientY, window.innerHeight, contour());
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
    const zone = tapZone(e.clientY, window.innerHeight, contour());
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
      head: tapZone(e.clientY, window.innerHeight, contour()) === 'head',
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
function setupFileDrop(contour: () => ContentBox): void {
  window.addEventListener('dragover', (e: DragEvent) => e.preventDefault());
  window.addEventListener('drop', (e: DragEvent) => {
    e.preventDefault();
    void window.openpet.rpc('character.gesture', {
      zone: tapZone(e.clientY, window.innerHeight, contour()),
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
