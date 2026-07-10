import * as THREE from 'three';

// preload 经 contextBridge 暴露的能力。
declare global {
  interface Window {
    spike: {
      setClickThrough: (ignore: boolean) => Promise<void>;
      moveBy: (dx: number, dy: number) => Promise<void>;
    };
  }
}

const WIDTH = 320;
const HEIGHT = 480;

// 迟滞阈值(0–255):进入实心区要 alpha ≥ ENTER,退出要 alpha < EXIT。
// 两个阈值拉开,避免光标停在 cube 边缘时穿透状态反复抖动。
const ENTER = 26; // ~0.10 * 255
const EXIT = 13; // ~0.05 * 255
const MOVE_THROTTLE_MS = 33; // ~30Hz
const LONG_PRESS_MS = 200;

export function mountCube(container: HTMLElement): void {
  // 检查 preload 是否暴露了 API
  if (!window.spike) {
    container.innerHTML = '<div style="color:red;padding:20px;font-family:monospace;">ERROR: window.spike is undefined<br>preload script did not load</div>';
    console.error('[S1] window.spike is undefined — preload script failed');
    return;
  }

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, WIDTH / HEIGHT, 0.1, 1000);
  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true, // readPixels 在事件回调里读,需保留 buffer
  });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(WIDTH, HEIGHT);
  container.appendChild(renderer.domElement);

  const cube = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 0.6, 0.6),
    new THREE.MeshBasicMaterial({ color: 0xff8fab }),
  );
  scene.add(cube);
  camera.position.z = 3;

  function loop(): void {
    cube.rotation.x += 0.01;
    cube.rotation.y += 0.01;
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  }
  loop();

  // 拖拽与穿透检测共享:拖拽期间冻结穿透切换,否则窗口若中途被切到 ignore,
  // mouseup 会落到下层,本窗口收不到、dragging 永远复位不了。
  const shared = { dragging: false };
  setupClickThrough(renderer, shared);
  setupDrag(renderer, shared);
}

// ---- S1.4: alpha 命中穿透 + 迟滞 ----
function setupClickThrough(
  renderer: THREE.WebGLRenderer,
  shared: { dragging: boolean },
): void {
  const gl = renderer.getContext();
  const px = new Uint8Array(4);
  let lastIgnore: boolean | null = null;
  let lastT = 0;

  function checkAlpha(clientX: number, clientY: number): void {
    const dpr = renderer.getPixelRatio();
    const bufW = renderer.domElement.width;
    const bufH = renderer.domElement.height;
    const x = Math.floor(clientX * dpr);
    const y = Math.floor(bufH - clientY * dpr);
    if (x < 0 || y < 0 || x >= bufW || y >= bufH) return;

    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const alpha = px[3] ?? 0;
    const ignore = lastIgnore === false ? alpha < EXIT : alpha < ENTER;
    if (ignore !== lastIgnore) {
      lastIgnore = ignore;
      void window.spike.setClickThrough(ignore);
    }
  }

  window.addEventListener('mousemove', (e: MouseEvent) => {
    if (shared.dragging) return; // 拖拽期间不切穿透,保证 mouseup 能被收到
    const now = performance.now();
    if (now - lastT < MOVE_THROTTLE_MS) return;
    lastT = now;

    // clientX/Y 是 CSS 像素;drawing buffer 是 device 像素,按 pixelRatio 换算,
    // 并把 y 轴翻转(GL 原点在左下)。高 DPI(150% 缩放)下也命中正确。
    checkAlpha(e.clientX, e.clientY);
  });

  // 鼠标进入 canvas 时强制检查一次 alpha,立即切回 non-ignore(如果在实心区)。
  // 否则若窗口处于 ignore 状态、鼠标移到 cube 上静止不动就按下,mousedown 不触发。
  renderer.domElement.addEventListener('mouseenter', (e: MouseEvent) => {
    checkAlpha(e.clientX, e.clientY);
  });
}

// ---- S1.5: 长按 200ms 拖拽 ----
function setupDrag(
  renderer: THREE.WebGLRenderer,
  shared: { dragging: boolean },
): void {
  let pressTimer: number | null = null;
  let lastX = 0;
  let lastY = 0;

  // mousedown 监听 canvas(只在 cube 上长按触发拖拽),但长按期间鼠标可能滑出,
  // 所以 mousemove/mouseup 挂 window 保证拖拽中全局生效。
  renderer.domElement.addEventListener('mousedown', (e: MouseEvent) => {
    lastX = e.screenX;
    lastY = e.screenY;
    pressTimer = window.setTimeout(() => {
      shared.dragging = true;
      console.log('[S1] dragging started');
    }, LONG_PRESS_MS);
  });

  window.addEventListener('mousemove', (e: MouseEvent) => {
    if (!shared.dragging) return;
    const dx = e.screenX - lastX;
    const dy = e.screenY - lastY;
    lastX = e.screenX;
    lastY = e.screenY;
    if (dx !== 0 || dy !== 0) void window.spike.moveBy(dx, dy);
  });

  window.addEventListener('mouseup', () => {
    if (pressTimer !== null) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
    if (shared.dragging) console.log('[S1] dragging stopped');
    shared.dragging = false;
  });
}
