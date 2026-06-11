/**
 * VRM 舞台 — Character 窗口的渲染引擎封装（S3 验证形态的生产化）。
 * 职责：加载 VRM → 性能优化三件套 → 渲染循环（idle 眨眼/呼吸 + 情绪过渡插值）。
 * 不持有业务状态：情绪指令由外部（behavior.* 订阅者）调 applyEmotion 注入。
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm';

const TRANSITION_MS = 400; // 350–500ms 平滑区间中值（S3 实测）

// 8 种情绪 → VRM expression 权重映射；前 5 个是 VRM 1.0 标准 preset，
// 后 3 个无标准 preset 用组合近似（S3 验证）。
export const EMOTIONS: Record<string, Record<string, number>> = {
  happy: { happy: 1 },
  angry: { angry: 1 },
  sad: { sad: 1 },
  relaxed: { relaxed: 1 },
  surprised: { surprised: 1 },
  shy: { happy: 0.45, relaxed: 0.55 },
  thinking: { relaxed: 0.35, sad: 0.15 },
  confused: { sad: 0.4, surprised: 0.35 },
};

export interface VrmStage {
  /** interaction 需要拿 renderer 做 readPixels 命中检测。 */
  readonly renderer: THREE.WebGLRenderer;
  applyEmotion(name: string, weight?: number): void;
  dispose(): void;
}

export async function createVrmStage(container: HTMLElement, modelUrl: string): Promise<VrmStage> {
  const width = container.clientWidth || 320;
  const height = container.clientHeight || 480;

  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true, // 事件回调里 readPixels 需保留 buffer（S1）
  });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, width / height, 0.1, 20);
  camera.position.set(0, 1.3, 2.2);
  camera.lookAt(0, 1.2, 0);

  const light = new THREE.DirectionalLight(0xffffff, Math.PI);
  light.position.set(1, 1, 1).normalize();
  scene.add(light);
  scene.add(new THREE.AmbientLight(0xffffff, 0.4 * Math.PI));

  // ---- 加载 VRM + 性能三件套（S3 实证 ≥30 FPS 的前提）----
  const vrm = await new Promise<VRM>((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    loader.load(
      modelUrl,
      (gltf) => {
        const v = gltf.userData.vrm as VRM | undefined;
        if (!v) {
          reject(new Error('file loaded but contains no VRM'));
          return;
        }
        VRMUtils.removeUnnecessaryVertices(gltf.scene);
        VRMUtils.combineSkeletons(gltf.scene);
        VRMUtils.combineMorphs(v);
        v.scene.traverse((obj) => {
          obj.frustumCulled = false;
        });
        resolve(v);
      },
      undefined,
      (err) => reject(err instanceof Error ? err : new Error(String(err))),
    );
  });
  scene.add(vrm.scene);

  // ---- 情绪过渡（支持中途打断：以当前帧权重为新起点）----
  const allExpressionNames = [...new Set(Object.values(EMOTIONS).flatMap((m) => Object.keys(m)))];
  let fromWeights: Record<string, number> = {};
  let toWeights: Record<string, number> = {};
  let transitionStart = 0;

  const easeInOut = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

  function applyEmotion(name: string, weight = 1): void {
    const em = vrm.expressionManager;
    if (!em) return;
    const snapshot: Record<string, number> = {};
    for (const n of allExpressionNames) snapshot[n] = em.getValue(n) ?? 0;
    fromWeights = snapshot;
    const target: Record<string, number> = {};
    for (const n of allExpressionNames) target[n] = 0;
    for (const [n, w] of Object.entries(EMOTIONS[name] ?? {})) target[n] = w * weight;
    toWeights = target;
    transitionStart = performance.now();
  }

  function updateTransition(): void {
    const em = vrm.expressionManager;
    if (!em) return;
    const t = Math.min((performance.now() - transitionStart) / TRANSITION_MS, 1);
    const k = easeInOut(t);
    for (const n of allExpressionNames) {
      const from = fromWeights[n] ?? 0;
      const to = toWeights[n] ?? 0;
      em.setValue(n, from + (to - from) * k);
    }
  }

  // ---- idle：自动眨眼 + 呼吸（S3）----
  let nextBlinkAt = performance.now() + 1500;
  let blinkPhase = -1;

  function updateIdle(now: number, delta: number): void {
    const em = vrm.expressionManager;
    if (!em) return;
    if (blinkPhase < 0 && now >= nextBlinkAt) blinkPhase = 0;
    if (blinkPhase >= 0) {
      blinkPhase += delta / 0.12;
      const v = blinkPhase < 1 ? blinkPhase : 2 - blinkPhase;
      em.setValue('blink', Math.max(0, Math.min(1, v)));
      if (blinkPhase >= 2) {
        blinkPhase = -1;
        em.setValue('blink', 0);
        nextBlinkAt = now + 2000 + Math.random() * 4000;
      }
    }
    const chest = vrm.humanoid?.getNormalizedBoneNode('chest');
    if (chest) chest.rotation.x = Math.sin(now / 1000) * 0.02;
  }

  // ---- 渲染循环 ----
  const clock = new THREE.Clock();
  let raf = 0;
  let disposed = false;

  function loop(): void {
    if (disposed) return;
    raf = requestAnimationFrame(loop);
    const delta = clock.getDelta();
    const now = performance.now();
    updateIdle(now, delta);
    updateTransition();
    vrm.update(delta);
    renderer.render(scene, camera);
  }
  loop();

  return {
    renderer,
    applyEmotion,
    dispose(): void {
      disposed = true;
      cancelAnimationFrame(raf);
      VRMUtils.deepDispose(vrm.scene);
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
