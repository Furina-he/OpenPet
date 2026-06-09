import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm';
import Stats from 'stats.js';

const MODEL_URL = '/models/sample.vrm';
const TRANSITION_MS = 400; // 350–500ms 平滑过渡区间的中值

// 8 种情绪 → VRM expression 权重映射。
// 前 5 个是 VRM 1.0 标准 preset;后 3 个无标准 preset,用 preset 组合近似。
const EMOTIONS: Record<string, Record<string, number>> = {
  happy: { happy: 1 },
  angry: { angry: 1 },
  sad: { sad: 1 },
  relaxed: { relaxed: 1 },
  surprised: { surprised: 1 },
  // 自定义:无 preset,用组合近似
  shy: { happy: 0.45, relaxed: 0.55 },
  thinking: { relaxed: 0.35, sad: 0.15 },
  confused: { sad: 0.4, surprised: 0.35 },
};

const statusEl = document.getElementById('status') as HTMLDivElement;
const panelEl = document.getElementById('panel') as HTMLDivElement;
const canvasWrap = document.getElementById('canvas-wrap') as HTMLDivElement;
const statsWrap = document.getElementById('stats-wrap') as HTMLDivElement;

function setStatus(lines: string[]): void {
  statusEl.textContent = lines.join('\n');
}

// ---- three 场景 ----
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
canvasWrap.appendChild(renderer.domElement);

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  30,
  window.innerWidth / window.innerHeight,
  0.1,
  20,
);
camera.position.set(0, 1.3, 2.2);

const controls = new OrbitControls(camera, renderer.domElement);
controls.screenSpacePanning = true;
controls.target.set(0, 1.2, 0);
controls.update();

const light = new THREE.DirectionalLight(0xffffff, Math.PI);
light.position.set(1, 1, 1).normalize();
scene.add(light);
scene.add(new THREE.AmbientLight(0xffffff, 0.4 * Math.PI));

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---- stats.js 帧率监控 ----
const stats = new Stats();
stats.showPanel(0); // 0 = fps
stats.dom.style.position = 'static';
statsWrap.appendChild(stats.dom);

// 30s 平均 FPS 采样
let frameCount = 0;
let fpsWindowStart = performance.now();
let avgFps30s: number | null = null;
const fpsSamples: number[] = [];

// ---- 情绪过渡状态机 ----
// 在所有用到的 expression 名上做线性插值,实现 ~400ms 平滑过渡。
const allExpressionNames = [
  ...new Set(Object.values(EMOTIONS).flatMap((m) => Object.keys(m))),
];
let fromWeights: Record<string, number> = {};
let toWeights: Record<string, number> = {};
let transitionStart = 0;
let currentEmotion = 'neutral';

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function applyEmotion(name: string, vrm: VRM): void {
  if (!vrm.expressionManager) return;
  // 当前帧权重作为过渡起点(支持过渡中途打断)
  const snapshot: Record<string, number> = {};
  for (const n of allExpressionNames) {
    snapshot[n] = vrm.expressionManager.getValue(n) ?? 0;
  }
  fromWeights = snapshot;
  const target: Record<string, number> = {};
  for (const n of allExpressionNames) target[n] = 0;
  Object.assign(target, EMOTIONS[name] ?? {});
  toWeights = target;
  transitionStart = performance.now();
  currentEmotion = name;

  for (const btn of panelEl.querySelectorAll('button')) {
    btn.classList.toggle('active', btn.dataset.emotion === name);
  }
}

function updateTransition(vrm: VRM): void {
  if (!vrm.expressionManager) return;
  const t = Math.min((performance.now() - transitionStart) / TRANSITION_MS, 1);
  const k = easeInOut(t);
  for (const n of allExpressionNames) {
    const from = fromWeights[n] ?? 0;
    const to = toWeights[n] ?? 0;
    vrm.expressionManager.setValue(n, from + (to - from) * k);
  }
}

// ---- idle 动画:自动眨眼 + 轻微呼吸摆动 ----
let nextBlinkAt = 0;
let blinkPhase = -1; // -1 = 不在眨眼

function updateIdle(vrm: VRM, now: number, delta: number): void {
  const em = vrm.expressionManager;
  if (!em) return;

  // 眨眼:每 2–6s 一次,闭合 ~120ms
  if (blinkPhase < 0 && now >= nextBlinkAt) {
    blinkPhase = 0;
  }
  if (blinkPhase >= 0) {
    blinkPhase += delta / 0.12;
    // 0→1→0 三角波
    const v = blinkPhase < 1 ? blinkPhase : 2 - blinkPhase;
    em.setValue('blink', Math.max(0, Math.min(1, v)));
    if (blinkPhase >= 2) {
      blinkPhase = -1;
      em.setValue('blink', 0);
      nextBlinkAt = now + 2000 + Math.random() * 4000;
    }
  }

  // 呼吸:上半身轻微起伏
  const chest = vrm.humanoid?.getNormalizedBoneNode('chest');
  if (chest) {
    chest.rotation.x = Math.sin(now / 1000) * 0.02;
  }
}

// ---- 加载 VRM ----
let currentVrm: VRM | null = null;
const clock = new THREE.Clock();

const loader = new GLTFLoader();
loader.register((parser) => new VRMLoaderPlugin(parser));

setStatus(['加载模型中…', MODEL_URL]);

loader.load(
  MODEL_URL,
  (gltf) => {
    const vrm = gltf.userData.vrm as VRM;
    VRMUtils.removeUnnecessaryVertices(gltf.scene);
    VRMUtils.combineSkeletons(gltf.scene);
    VRMUtils.combineMorphs(vrm);
    vrm.scene.traverse((obj) => {
      obj.frustumCulled = false;
    });
    currentVrm = vrm;
    scene.add(vrm.scene);

    buildEmotionButtons(vrm);
    nextBlinkAt = performance.now() + 1500;
    reportReady(vrm);
  },
  (progress) => {
    if (progress.total > 0) {
      const pct = ((100 * progress.loaded) / progress.total).toFixed(0);
      setStatus(['加载模型中…', `${pct}%`]);
    }
  },
  (error) => {
    setStatus([
      '模型加载失败 ✗',
      String((error as Error)?.message ?? error),
      '',
      `请把 VRM 模型放到 public/models/sample.vrm`,
    ]);
    console.error(error);
  },
);

function buildEmotionButtons(vrm: VRM): void {
  panelEl.innerHTML = '';
  const presetAvail = new Set(
    vrm.expressionManager?.expressions.map((e) => e.expressionName) ?? [],
  );
  for (const name of Object.keys(EMOTIONS)) {
    const btn = document.createElement('button');
    btn.textContent = name;
    btn.dataset.emotion = name;
    // 提示哪些底层 preset 在模型里缺失(自定义组合仍可点)
    const deps = Object.keys(EMOTIONS[name] ?? {});
    const missing = deps.filter((d) => !presetAvail.has(d));
    if (missing.length === deps.length) {
      btn.title = `模型缺少 preset: ${missing.join(', ')}`;
    }
    btn.addEventListener('click', () => applyEmotion(name, vrm));
    panelEl.appendChild(btn);
  }
  // neutral 复位
  const neutral = document.createElement('button');
  neutral.textContent = 'neutral';
  neutral.dataset.emotion = 'neutral';
  neutral.addEventListener('click', () => applyEmotion('neutral', vrm));
  panelEl.appendChild(neutral);
}

function reportReady(vrm: VRM): void {
  const names = vrm.expressionManager?.expressions.map((e) => e.expressionName) ?? [];
  setStatus([
    '模型已加载 ✓',
    `expressions: ${names.length} 个`,
    `当前情绪: ${currentEmotion}`,
    `FPS(30s 平均): 采样中…`,
  ]);
}

// ---- 主循环 ----
function animate(): void {
  requestAnimationFrame(animate);
  stats.begin();

  const delta = clock.getDelta();
  const now = performance.now();

  if (currentVrm) {
    updateIdle(currentVrm, now, delta);
    updateTransition(currentVrm);
    currentVrm.update(delta);
  }
  renderer.render(scene, camera);

  // FPS 采样
  frameCount++;
  const elapsed = now - fpsWindowStart;
  if (elapsed >= 1000) {
    fpsSamples.push((frameCount * 1000) / elapsed);
    frameCount = 0;
    fpsWindowStart = now;
    if (fpsSamples.length >= 30) {
      avgFps30s = fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length;
      fpsSamples.length = 0;
    }
    if (currentVrm) {
      const names =
        currentVrm.expressionManager?.expressions.map((e) => e.expressionName) ?? [];
      setStatus([
        '模型已加载 ✓',
        `expressions: ${names.length} 个`,
        `当前情绪: ${currentEmotion}`,
        avgFps30s
          ? `FPS(30s 平均): ${avgFps30s.toFixed(1)}`
          : `FPS(30s 平均): 采样中… (${fpsSamples.length}/30s)`,
      ]);
    }
  }

  stats.end();
}
animate();

export {};
