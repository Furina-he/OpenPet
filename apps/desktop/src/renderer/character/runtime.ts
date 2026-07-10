/**
 * CharacterRuntime —— tech-design §7 统一抽象的 VRM 引擎实现（S3 spike 形态的
 * 完整生产化，吸收并取代 vrm-stage.ts）。
 *
 * 职责（仍是"愚蠢播放器"）：
 *   - load：GLTFLoader + VRMLoaderPlugin、性能三件套、预算测量
 *   - applyEmotion：manifest 词表（缺省内置表）→ expression 权重组合，400ms 缓动
 *   - playAction：程序化动作库单活动作播放（新顶旧、完毕回 idle）
 *   - setLookAt：屏幕坐标 → 阻尼平滑 → vrm.lookAt target
 *   - setIdle：intent → idle 变体子集（眨眼/呼吸常驻）
 *   - setLipsync：V1+ stub（§7 接口完整性）
 * 业务状态（说什么/何时说）一概不持有。
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm';
import type { CharacterManifest } from '@openpet/protocol';
import { sampleAction, ACTION_DEFAULT_MS, ZERO_OFFSETS, type BoneOffsets } from './actions';
import { dragState } from './drag-state';
import { normalizedFromScreen, lookAtWorldTarget, damp, type Normalized } from './lookat';
import { selectIdleVariants, planNextIdle, type IdleVariant } from './idle-pool';
import { measureSceneBudget, checkBudget } from './perf-budget';
import { FpsMeter } from './fps-meter';
import type { CharacterRuntime } from './runtime-types';

export type { CharacterRuntime, HitSurface } from './runtime-types';

const TRANSITION_MS = 400; // 350–500ms 平滑区间中值（S3 实测）

/** 内置情绪表：S3 的 8 个 + persona 词表的 curious/sleepy（消除模板↔运行时漂移）。 */
export const BUILTIN_EMOTIONS: Record<string, Record<string, number>> = {
  happy: { happy: 1 },
  angry: { angry: 1 },
  sad: { sad: 1 },
  relaxed: { relaxed: 1 },
  surprised: { surprised: 1 },
  shy: { happy: 0.45, relaxed: 0.55 },
  thinking: { relaxed: 0.35, sad: 0.15 },
  confused: { sad: 0.4, surprised: 0.35 },
  curious: { surprised: 0.35, happy: 0.25 },
  sleepy: { relaxed: 0.85 },
};

/** 手臂自然下垂的 rest pose（VRM 默认 T-pose）；符号经手测校准（M4 Task 17）。 */
const ARM_REST_Z = 1.15;

export async function createVrmRuntime(
  container: HTMLElement,
  modelUrl: string,
  manifest: CharacterManifest,
): Promise<CharacterRuntime> {
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

  // ---- load：VRM + 性能三件套（S3 实证 ≥30 FPS 的前提）----
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
        VRMUtils.rotateVRM0(v); // VRM 0.x 模型面朝 +Z：转 180° 面向相机（VRM 1.0 是 no-op）
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

  // ---- 性能预算：加载即测，超标告警 ----
  const budget = measureSceneBudget(vrm.scene);
  const budgetWarnings = checkBudget(budget);
  for (const w of budgetWarnings) console.warn(`[runtime] budget: ${w}`);

  // ---- 情绪：manifest 词表优先，缺省内置表 ----
  const emotions: Record<string, Record<string, number>> = manifest.emotions ?? BUILTIN_EMOTIONS;
  const allExpressionNames = [...new Set(Object.values(emotions).flatMap((m) => Object.keys(m)))];
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
    for (const [n, w] of Object.entries(emotions[name] ?? {})) target[n] = w * weight;
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

  // ---- 动作：单活动作播放器 ----
  const actionVocab = manifest.actions ?? Object.keys(ACTION_DEFAULT_MS);
  let activeAction: { name: string; start: number; durMs: number; scale: number } | null = null;

  function playActionScaled(name: string, durMs: number | null | undefined, scale: number): void {
    if (!actionVocab.includes(name)) {
      console.warn(`[runtime] unknown action "${name}" (vocab: ${actionVocab.join(',')})`);
      return;
    }
    const fallback = (ACTION_DEFAULT_MS as Record<string, number>)[name] ?? 1500;
    activeAction = { name, start: performance.now(), durMs: durMs ?? fallback, scale };
  }

  function currentOffsets(now: number): BoneOffsets {
    if (!activeAction) return ZERO_OFFSETS;
    const phase = (now - activeAction.start) / activeAction.durMs;
    if (phase >= 1) {
      activeAction = null;
      return ZERO_OFFSETS;
    }
    const raw = sampleAction(activeAction.name, phase);
    if (activeAction.scale === 1) return raw;
    const scaled = { ...raw };
    for (const k of Object.keys(scaled) as Array<keyof BoneOffsets>) {
      scaled[k] = raw[k] * activeAction.scale;
    }
    return scaled;
  }

  // ---- 拖拽物理（F-IT-04）：速度→拎起摆动，松手 0.4s 弹性回归。与动作曲线同一 BoneOffsets 叠加口。
  const DRAG_ROLL_PER_PXMS = 0.35; // headRoll(rad) per px/ms；系数按真窗手感微调
  const DRAG_ROLL_MAX = 0.25;
  const DRAG_PITCH_PER_PXMS = 0.12; // spinePitch 微量（速度绝对值）
  const DRAG_PITCH_MAX = 0.08;
  const RELEASE_TAU_MS = 130; // e^{-t/τ}：0.4s ≈ 3τ → 衰至 ~5%
  const RELEASE_OMEGA = 0.016; // rad/ms：cos(ωt) 在 0.4s 内一次 overshoot 变体
  const clampAbs = (v: number, max: number): number => Math.max(-max, Math.min(max, v));
  let physRoll = 0;
  let physPitch = 0;
  let releaseT = -1; // <0 = 非回归期
  let releaseAmpRoll = 0;
  let releaseAmpPitch = 0;

  function updateDragPhysics(dtMs: number): void {
    if (dragState.active) {
      const k = Math.min(1, dtMs / 60); // 朝目标平滑，避免速度抖动直传骨骼
      physRoll += (clampAbs(dragState.vx * DRAG_ROLL_PER_PXMS, DRAG_ROLL_MAX) - physRoll) * k;
      physPitch +=
        (clampAbs(Math.abs(dragState.vx) * DRAG_PITCH_PER_PXMS, DRAG_PITCH_MAX) - physPitch) * k;
      releaseT = -1;
      return;
    }
    if (releaseT < 0) {
      if (physRoll === 0 && physPitch === 0) return;
      releaseT = 0; // 松手瞬间：以当前偏移为振幅进入回归
      releaseAmpRoll = physRoll;
      releaseAmpPitch = physPitch;
    }
    releaseT += dtMs;
    const env = Math.exp(-releaseT / RELEASE_TAU_MS) * Math.cos(RELEASE_OMEGA * releaseT);
    physRoll = releaseAmpRoll * env;
    physPitch = releaseAmpPitch * env;
    if (Math.abs(physRoll) < 1e-3 && Math.abs(physPitch) < 1e-3) {
      physRoll = 0;
      physPitch = 0;
      releaseT = -1;
    }
  }

  function withDragPhysics(off: BoneOffsets): BoneOffsets {
    if (physRoll === 0 && physPitch === 0) return off;
    return { ...off, headRoll: off.headRoll + physRoll, spinePitch: off.spinePitch + physPitch };
  }

  // ---- 骨骼应用：rest pose + 动作偏移（每帧覆写，幂等）----
  const humanoid = vrm.humanoid;
  const hips = humanoid?.getNormalizedBoneNode('hips') ?? null;
  const spine = humanoid?.getNormalizedBoneNode('spine') ?? null;
  const chest = humanoid?.getNormalizedBoneNode('chest') ?? null;
  const head = humanoid?.getNormalizedBoneNode('head') ?? null;
  const upperArmL = humanoid?.getNormalizedBoneNode('leftUpperArm') ?? null;
  const upperArmR = humanoid?.getNormalizedBoneNode('rightUpperArm') ?? null;
  const hipsRestY = hips?.position.y ?? 0;

  function applyPose(now: number, offsets: BoneOffsets): void {
    if (upperArmL) upperArmL.rotation.z = ARM_REST_Z - offsets.armRaiseL;
    if (upperArmR) upperArmR.rotation.z = -(ARM_REST_Z - offsets.armRaiseR);
    if (head) {
      head.rotation.x = offsets.headPitch;
      head.rotation.y = offsets.headYaw;
      head.rotation.z = offsets.headRoll;
    }
    if (spine) {
      spine.rotation.x = offsets.spinePitch;
      spine.rotation.y = offsets.spineYaw;
    }
    if (hips) hips.position.y = hipsRestY + offsets.hipsY;
    if (chest) chest.rotation.x = Math.sin(now / 1000) * 0.02; // 呼吸常驻（S3）
  }

  // ---- 嘴型（F-VC）：播放侧 RMS 包络 → 'aa'。'aa' 是 VRM lipSync preset，
  // 不在情绪词表 allExpressionNames 里 → 与 updateTransition 通道天然无冲突。
  let mouthTarget = 0;
  let mouthCurrent = 0;

  function updateMouth(): void {
    const em = vrm.expressionManager;
    if (!em) return;
    mouthCurrent += (mouthTarget - mouthCurrent) * 0.15;
    if (mouthTarget === 0 && mouthCurrent < 1e-3) mouthCurrent = 0;
    em.setValue('aa', mouthCurrent);
  }

  // ---- idle：眨眼常驻 + 变体池调度 ----
  let nextBlinkAt = performance.now() + 1500;
  let blinkPhase = -1;

  function updateBlink(now: number, delta: number): void {
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
  }

  let idleSubset: IdleVariant[] = selectIdleVariants({ mood: 'neutral', energy: 'mid' });
  let nextIdle = planNextIdle(performance.now(), idleSubset);

  function updateIdleVariants(now: number): void {
    if (now < nextIdle.at) return;
    if (!activeAction) {
      const v = nextIdle.variant;
      playActionScaled(v.action, v.durationMs, v.scale);
    }
    nextIdle = planNextIdle(now, idleSubset); // 被显式动作占用时顺延到下个窗口
  }

  // ---- LookAt：阻尼平滑 + vrm.lookAt target ----
  const lookAtTarget = new THREE.Object3D();
  scene.add(lookAtTarget);
  if (vrm.lookAt) vrm.lookAt.target = lookAtTarget;
  let rawN: Normalized = { nx: 0, ny: 0 };
  const smoothN: Normalized = { nx: 0, ny: 0 };
  const headWorld = new THREE.Vector3(0, 1.35, 0);
  head?.getWorldPosition(headWorld);

  function setLookAt(x: number, y: number): void {
    rawN = normalizedFromScreen(x, y, {
      x: window.screenX,
      y: window.screenY,
      width: window.innerWidth,
      height: window.innerHeight,
    });
  }

  function updateLookAt(dt: number): void {
    smoothN.nx = damp(smoothN.nx, rawN.nx, 8, dt);
    smoothN.ny = damp(smoothN.ny, rawN.ny, 8, dt);
    const t = lookAtWorldTarget(headWorld, smoothN);
    lookAtTarget.position.set(t.x, t.y, t.z);
  }

  // ---- 窗口缩放自适应（D4 缩放 → Main 改 bounds → 这里跟随）----
  const resizeObserver = new ResizeObserver(() => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  });
  resizeObserver.observe(container);

  // ---- 渲染循环 ----
  const fps = new FpsMeter();
  const clock = new THREE.Clock();
  let raf = 0;
  let disposed = false;

  function loop(): void {
    if (disposed) return;
    raf = requestAnimationFrame(loop);
    const delta = clock.getDelta();
    const now = performance.now();
    fps.tick(now);
    updateBlink(now, delta);
    updateIdleVariants(now);
    updateTransition();
    updateMouth();
    updateLookAt(delta);
    updateDragPhysics(delta * 1000);
    applyPose(now, withDragPhysics(currentOffsets(now)));
    vrm.update(delta);
    renderer.render(scene, camera);
  }
  loop();

  return {
    hitSurface: {
      canvas: renderer.domElement,
      gl: renderer.getContext(),
      pixelRatio: renderer.getPixelRatio(),
    },
    applyEmotion,
    playAction(name, durMs) {
      playActionScaled(name, durMs ?? null, 1);
    },
    setLookAt,
    setMouth(v) {
      mouthTarget = Math.max(0, Math.min(1, v));
    },
    setLipsync(_visemes) {
      // V1+ 语音嘴型（tech-design §7 接口占位）；M4 显式 no-op
    },
    setIdle(intent) {
      idleSubset = selectIdleVariants(intent);
      nextIdle = planNextIdle(performance.now(), idleSubset);
    },
    listEmotions: () => Object.keys(emotions),
    listActions: () => [...actionVocab],
    getStats: () => ({ fps: fps.average(), budget, budgetWarnings }),
    dispose(): void {
      disposed = true;
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      VRMUtils.deepDispose(vrm.scene);
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
