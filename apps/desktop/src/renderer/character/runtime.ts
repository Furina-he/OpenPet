/**
 * CharacterRuntime —— tech-design §7 统一抽象的 VRM 引擎实现（S3 spike 形态的
 * 完整生产化，吸收并取代 vrm-stage.ts）。
 *
 * 职责（仍是"愚蠢播放器"）：
 *   - load：GLTFLoader + VRMLoaderPlugin、性能三件套、预算测量
 *   - applyEmotion：manifest 词表（缺省内置表）→ expression 权重组合，⑱ 包络（快起慢退到心情基线）
 *   - playAction：程序化动作库单活动作播放（新顶旧、完毕回 idle）
 *   - setLookAt：屏幕坐标 → ⑱ 视线状态机（track/wander/thinking/speaking/sleepy）→ 阻尼 → vrm.lookAt target
 *   - setIdle：intent → idle 变体子集（眨眼/呼吸常驻）
 *   - setLipsync：V1+ stub（§7 接口完整性）
 * 业务状态（说什么/何时说）一概不持有。
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm';
import {
  VRMAnimationLoaderPlugin,
  VRMLookAtQuaternionProxy,
  createVRMAnimationClip,
  type VRMAnimation,
} from '@pixiv/three-vrm-animation';
import { ActionClipRegistry, applyPoseTo, resolveClipEntries } from './action-clips';
import type { CharacterManifest } from '@openpet/protocol';
import {
  sampleAction,
  sampleActionEnvelope,
  actionTotalMs,
  ACTION_COMPANIONS,
  ACTION_DEFAULT_MS,
  ACTION_SCALE,
  ZERO_OFFSETS,
  type BoneOffsets,
} from './actions';
import { dragState } from './drag-state';
import { normalizedFromScreen, lookAtWorldTarget, damp, type Normalized } from './lookat';
import {
  selectIdleVariants,
  planNextIdle,
  stepsOf,
  IdleSequencer,
  type IdleIntent,
  type IdleStep,
  type IdleVariant,
} from './idle-pool';
import { measureSceneBudget, checkBudget } from './perf-budget';
import { FpsMeter } from './fps-meter';
import { EmotionEnvelope, baselineForMood } from './emotion-envelope';
import {
  LIFE_FLAGS,
  LifeLayer,
  PROXIMITY_PX,
  addOffsets,
  asEnergy,
  nightEnergy,
  proximityOffsets,
  type Energy,
} from './life-layers';
import { PostureLayer } from './posture';
import { GazeMachine } from './gaze';
import { BlinkScheduler } from './blink';
import { settle } from './settle';
import type { CharacterRuntime } from './runtime-types';

export type { CharacterRuntime, HitSurface } from './runtime-types';

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

export interface VrmRuntimeOptions {
  /** `asset://<characterId>/`——manifest.actionClips 相对路径的根（缺省不加载片段）。 */
  assetBase?: string | undefined;
}

export async function createVrmRuntime(
  container: HTMLElement,
  modelUrl: string,
  manifest: CharacterManifest,
  options: VrmRuntimeOptions = {},
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
  // ⑱ 基线用到的 happy/relaxed/sad 也纳入通道集合：模型无该 expression 时 setValue 是 no-op。
  const allExpressionNames = [
    ...new Set([
      ...Object.values(emotions).flatMap((m) => Object.keys(m)),
      'happy',
      'relaxed',
      'sad',
    ]),
  ];
  // ⑱ 表情包络 + 心情基线（spec §2.1）：快起（180ms 过冲 8%）慢退（1200ms）到 baseline(mood)。
  const envelope = new EmotionEnvelope(allExpressionNames);
  let lifeLayers = true;
  let moodValue = 0;
  /** 当前情绪名（姿态层 / 呼吸 sleepy / 视线用；neutral = 无）。 */
  let currentEmotion = 'neutral';
  let energy: Energy = 'mid';
  let speaking = false;
  envelope.setBaseline(baselineForMood(0), performance.now());

  // ⑱ 底噪层 + 姿态层（spec §2.2 / §2.4）+ 视线状态机 + 眨眼调度（§2.3）：纯逻辑模块，这里只装配。
  const life = new LifeLayer(performance.now());
  const posture = new PostureLayer();
  const gaze = new GazeMachine(performance.now());
  const blink = new BlinkScheduler(performance.now());

  /** 非说话期触发的表情（如轮末表情兜底分类晚于 chat.done 到达）没有后续 done 来复位 → 定时退基线。 */
  const EMOTION_HOLD_MS = 4000;
  let holdTimer: ReturnType<typeof setTimeout> | null = null;
  function applyEmotion(name: string, weight = 1): void {
    const now = performance.now();
    if (holdTimer) clearTimeout(holdTimer);
    holdTimer = speaking ? null : setTimeout(releaseEmotion, EMOTION_HOLD_MS);
    const target: Record<string, number> = {};
    for (const [n, w] of Object.entries(emotions[name] ?? {})) target[n] = w * weight;
    envelope.trigger(target, now);
    currentEmotion = emotions[name] && weight > 0 ? name : 'neutral';
    posture.set(currentEmotion, moodValue, now);
    gaze.emotionChanged(currentEmotion);
    blink.setEmotion(currentEmotion);
  }

  function releaseEmotion(): void {
    const now = performance.now();
    if (holdTimer) clearTimeout(holdTimer);
    holdTimer = null;
    envelope.release(now);
    currentEmotion = 'neutral';
    posture.set('neutral', moodValue, now);
    gaze.emotionChanged('neutral');
    blink.setEmotion('neutral');
  }

  function refreshBaseline(): void {
    const now = performance.now();
    envelope.setBaseline(lifeLayers ? baselineForMood(moodValue) : {}, now);
    posture.set(currentEmotion, moodValue, now);
  }

  /** 本地小时（夜间降档用），每秒刷新一次足够。 */
  let hourCache = { at: -Infinity, hour: new Date().getHours() };
  function localHour(now: number): number {
    if (now - hourCache.at > 1000) hourCache = { at: now, hour: new Date().getHours() };
    return hourCache.hour;
  }

  function updateTransition(now: number): void {
    const em = vrm.expressionManager;
    if (!em) return;
    const w = envelope.sample(now);
    for (const n of allExpressionNames) em.setValue(n, w[n] ?? 0);
  }

  // ---- 动作：单活动作播放器（⑱ 三段包络 + 协同分发；总闸关 = 旧 bump 曲线）----
  const actionVocab = manifest.actions ?? Object.keys(ACTION_DEFAULT_MS);
  let activeAction: {
    name: string;
    start: number;
    durMs: number;
    scale: number;
    total: number;
    restorePosture: boolean;
  } | null = null;
  let lastActionEnd = -Infinity;
  /** 协同：嘴微张窗口（sigh/stretch）与 hum 伪动作窗口。 */
  let mouthCompanion: { level: number; until: number } | null = null;
  let hum: { start: number; until: number } | null = null;

  /** 协同表分发（spec §2.5）：节拍档（|scale|<0.5）不触发，避免点缀动作抢戏。 */
  function dispatchCompanions(name: string, durMs: number, scale: number, now: number): boolean {
    if (!lifeLayers || !LIFE_FLAGS.companions || Math.abs(scale) < 0.5) return false;
    const c = ACTION_COMPANIONS[name as keyof typeof ACTION_COMPANIONS];
    if (!c) return false;
    if (c.gaze) gaze.nudge(c.gaze, now, c.gazeMs ?? durMs);
    if (c.blink) blink.nudge(c.blink, now, durMs, c.blinkLevel);
    if (c.mouth !== undefined) mouthCompanion = { level: c.mouth, until: now + durMs };
    if (c.breath) life.nudgeBreath(c.breath, now);
    if (c.posture) {
      posture.override(c.posture, now);
      return true;
    }
    return false;
  }

  function playActionScaled(name: string, durMs: number | null | undefined, scale: number): void {
    if (!actionVocab.includes(name)) {
      console.warn(`[runtime] unknown action "${name}" (vocab: ${actionVocab.join(',')})`);
      return;
    }
    const now = performance.now();
    const fallback = (ACTION_DEFAULT_MS as Record<string, number>)[name] ?? 1500;
    const dur = durMs ?? fallback;
    const restorePosture = dispatchCompanions(name, dur, scale, now);
    // ⑱ T9：显式动作命中 VRMA 片段 → mixer 播放（幅度档不适用于片段：idle/节拍仍走曲线）
    if (scale === ACTION_SCALE.explicit && playClip(name, now)) return;
    activeAction = {
      name,
      start: now,
      durMs: dur,
      scale,
      total: lifeLayers ? actionTotalMs(name, dur) : dur,
      restorePosture,
    };
  }

  function endAction(now: number): void {
    if (activeAction?.restorePosture) posture.set(currentEmotion, moodValue, now);
    activeAction = null;
    lastActionEnd = now;
  }

  function currentOffsets(now: number): BoneOffsets {
    if (!activeAction) return ZERO_OFFSETS;
    const t = now - activeAction.start;
    if (t >= activeAction.total) {
      endAction(now);
      return ZERO_OFFSETS;
    }
    const raw = lifeLayers
      ? sampleActionEnvelope(activeAction.name, t, activeAction.durMs)
      : sampleAction(activeAction.name, t / activeAction.durMs);
    if (activeAction.scale === 1) return raw;
    const scaled = { ...raw };
    for (const k of Object.keys(scaled) as Array<keyof BoneOffsets>) {
      scaled[k] = raw[k] * activeAction.scale;
    }
    return scaled;
  }

  /** ⑱ 节拍手势门（spec §2.7）：无活动作且距上次动作 ≥1.5s 才播，否则丢弃（永不排队）。 */
  const BEAT_GATE_MS = 1500;
  function playBeat(name: string, scale: number, now: number): boolean {
    if (activeAction || activeClip || now - lastActionEnd < BEAT_GATE_MS) return false;
    playActionScaled(name, null, scale);
    return true;
  }

  // ---- 拖拽物理（F-IT-04）：速度→拎起摆动，松手 0.4s 弹性回归。与动作曲线同一 BoneOffsets 叠加口。
  const DRAG_ROLL_PER_PXMS = 0.35; // headRoll(rad) per px/ms；系数按真窗手感微调
  const DRAG_ROLL_MAX = 0.25;
  const DRAG_PITCH_PER_PXMS = 0.12; // spinePitch 微量（速度绝对值）
  const DRAG_PITCH_MAX = 0.08;
  // 回归包络 = settle.ts（⑱ 与动作余震同源）
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
    const env = settle(releaseT);
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
  const hipsRestX = hips?.position.x ?? 0;

  const poseTargets = { head, spine, chest, hips, upperArmL, upperArmR };
  const poseRest = { armRestZ: ARM_REST_Z, hipsRestX, hipsRestY };

  /** 无片段：rest + offsets 赋值（幂等）；片段播放中：在 mixer 写出的姿态上累加（⑱ T9）。 */
  function applyPose(now: number, offsets: BoneOffsets, mode: 'absolute' | 'additive'): void {
    // 呼吸：⑱ 底噪层写 chestPitch；总闸关时回 S3 固定正弦（本批前表现）。
    const chestPitch = lifeLayers ? offsets.chestPitch : Math.sin(now / 1000) * 0.02;
    applyPoseTo(poseTargets, { ...offsets, chestPitch }, mode, poseRest);
  }

  // ---- ⑱ T9 VRMA 片段通道：manifest.actionClips → AnimationMixer；命中走片段，否则程序化曲线 ----
  const clips = new ActionClipRegistry<THREE.AnimationClip>();
  const mixer = new THREE.AnimationMixer(vrm.scene);
  let activeClip: {
    action: THREE.AnimationAction;
    until: number;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  const CLIP_FADE_IN_S = 0.15;
  const CLIP_FADE_OUT_S = 0.25;
  if (vrm.lookAt) {
    // 片段里的 lookAt 轨道需要这个代理节点才能绑定（否则 mixer 报 no target）。
    const proxy = new VRMLookAtQuaternionProxy(vrm.lookAt);
    proxy.name = 'VRMLookAtQuaternionProxy';
    vrm.scene.add(proxy);
  }
  // mixer 的"原始状态"快照在首次绑定时抓取：先摆到 rest（手臂下垂），避免淡入淡出时向 T-pose 混合。
  applyPose(0, ZERO_OFFSETS, 'absolute');

  async function loadClipFromUrl(url: string): Promise<THREE.AnimationClip> {
    const gltf = await new Promise<{ userData: { vrmAnimations?: VRMAnimation[] } }>(
      (resolve, reject) => {
        const loader = new GLTFLoader();
        loader.register((parser) => new VRMAnimationLoaderPlugin(parser));
        loader.load(url, resolve, undefined, (e) =>
          reject(e instanceof Error ? e : new Error(String(e))),
        );
      },
    );
    const anim = gltf.userData.vrmAnimations?.[0];
    if (!anim) throw new Error('file contains no VRM animation');
    return createVRMAnimationClip(anim, vrm);
  }

  async function loadActionClip(name: string, url: string): Promise<boolean> {
    const r = await clips.loadAll([{ name, url }], loadClipFromUrl);
    return r.loaded.length === 1;
  }

  const clipEntries = resolveClipEntries(manifest.actionClips, options.assetBase ?? '');
  if (options.assetBase && clipEntries.length > 0) {
    void clips.loadAll(clipEntries, loadClipFromUrl).then((r) => {
      if (r.loaded.length > 0) console.info(`[runtime] actionClips loaded: ${r.loaded.join(',')}`);
    });
  }

  function stopClip(): void {
    if (!activeClip) return;
    clearTimeout(activeClip.timer);
    activeClip.action.fadeOut(CLIP_FADE_OUT_S);
    activeClip = null;
  }

  /** 命中片段则播放（LoopOnce，fadeIn 150ms / fadeOut 250ms），返回 true；未命中 false（走曲线）。 */
  function playClip(name: string, now: number): boolean {
    const clip = clips.get(name);
    if (!clip) return false;
    stopClip();
    const action = mixer.clipAction(clip);
    action.reset();
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.fadeIn(CLIP_FADE_IN_S);
    action.play();
    const durMs = clip.duration * 1000;
    const timer = setTimeout(
      () => {
        action.fadeOut(CLIP_FADE_OUT_S);
        setTimeout(() => {
          if (activeClip?.action === action) {
            activeClip = null;
            lastActionEnd = performance.now();
          }
        }, CLIP_FADE_OUT_S * 1000);
      },
      Math.max(0, durMs - CLIP_FADE_OUT_S * 1000),
    );
    activeClip = { action, until: now + durMs, timer };
    activeAction = null; // 片段接管：程序化动作层停
    return true;
  }

  /** ⑱ 鼠标靠近程度（阻尼标量：进 ~0.3s、离开 ~1s 复位）。 */
  let proximity = 0;
  function updateProximity(dtSec: number): void {
    const near =
      gaze.state(performance.now()) === 'track' && gaze.cursorDistance(windowRect()) < PROXIMITY_PX;
    proximity = damp(proximity, near ? 1 : 0, near ? 10 : 3, dtSec);
    if (proximity < 1e-3) proximity = 0;
  }

  /** ⑱ 合成顺序固定：life（底噪）+ 靠近朝向 + posture（姿态）+ action（动作）+ drag（拖拽物理）。 */
  function composePose(now: number): BoneOffsets {
    const action = currentOffsets(now);
    if (!lifeLayers) return withDragPhysics(action);
    const ctx = {
      energy: nightEnergy(localHour(now), energy),
      mood: moodValue,
      speaking,
      emotion: currentEmotion,
    };
    const post = posture.sample(now); // 始终采样保持缓动连续
    return withDragPhysics(
      addOffsets(
        life.sample(now, ctx),
        LIFE_FLAGS.proximity ? proximityOffsets(gaze.cursorNx(), proximity) : {},
        LIFE_FLAGS.posture ? post : {},
        action,
      ),
    );
  }

  // ---- 嘴型（F-VC）：播放侧 RMS 包络 → 'aa'。'aa' 是 VRM lipSync preset，
  // 不在情绪词表 allExpressionNames 里 → 与 updateTransition 通道天然无冲突。
  let mouthTarget = 0;
  let mouthCurrent = 0;

  function updateMouth(now: number): void {
    const em = vrm.expressionManager;
    if (!em) return;
    let target = mouthTarget;
    // ⑱ 协同微张（sigh/stretch）与 hum 伪动作（嘴 2.2Hz 微开合）：取 max，TTS 嘴型永远优先。
    if (mouthCompanion) {
      if (now < mouthCompanion.until) target = Math.max(target, mouthCompanion.level);
      else mouthCompanion = null;
    }
    if (hum) {
      if (now < hum.until) {
        const t = (now - hum.start) / 1000;
        target = Math.max(target, 0.12 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 2.2 * t)));
      } else hum = null;
    }
    mouthCurrent += (target - mouthCurrent) * 0.15;
    if (target === 0 && mouthCurrent < 1e-3) mouthCurrent = 0;
    em.setValue('aa', mouthCurrent);
  }

  // ---- idle：眨眼常驻（⑱ BlinkScheduler：间隔随情绪/双眨/扫视伴随/sleepy 地板）+ 变体池调度 ----
  function updateBlink(now: number): void {
    const em = vrm.expressionManager;
    if (!em) return;
    if (lifeLayers) {
      for (let i = gaze.takeSaccades(); i > 0; i--) blink.onSaccade(now);
    }
    em.setValue('blink', blink.sample(now, lifeLayers ? gaze.eyelidFloor(now) : 0));
  }

  let idleIntent: IdleIntent = { mood: 'neutral', energy: 'mid' };
  let autoSpeak = false;
  let idleSubset: IdleVariant[] = selectIdleVariants(idleIntent);
  let nextIdle = planNextIdle(performance.now(), idleSubset);
  const sequencer = new IdleSequencer();

  function refreshIdle(): void {
    idleSubset = selectIdleVariants(idleIntent, { moodValue, autoSpeak });
    nextIdle = planNextIdle(performance.now(), idleSubset, Math.random, energy);
  }

  function playIdleStep(step: IdleStep, now: number): void {
    if (step.action === 'hum') {
      hum = { start: now, until: now + step.durationMs };
      return;
    }
    playActionScaled(step.action, step.durationMs, step.scale);
  }

  function updateIdleVariants(now: number): void {
    // ⑱ 序列步进：gap 内不被 idle 抢占；显式动作到来即中止（见 playAction）。
    if (sequencer.active) {
      const busy =
        activeAction !== null || activeClip !== null || (hum !== null && now < hum.until);
      const step = sequencer.next(now, busy);
      if (step) playIdleStep(step, now);
      return;
    }
    if (now < nextIdle.at) return;
    if (!activeAction && !activeClip) {
      const v = nextIdle.variant;
      if (lifeLayers) sequencer.start(stepsOf(v), now);
      else playActionScaled(v.action, v.durationMs, v.scale);
    }
    nextIdle = planNextIdle(now, idleSubset, Math.random, lifeLayers ? energy : 'mid'); // 被占用时顺延
  }

  // ---- LookAt：⑱ 视线状态机 → 阻尼平滑 + vrm.lookAt target（总闸关 = 旧的直追鼠标）----
  const lookAtTarget = new THREE.Object3D();
  scene.add(lookAtTarget);
  if (vrm.lookAt) vrm.lookAt.target = lookAtTarget;
  let rawN: Normalized = { nx: 0, ny: 0 };
  const smoothN: Normalized = { nx: 0, ny: 0 };
  const headWorld = new THREE.Vector3(0, 1.35, 0);
  head?.getWorldPosition(headWorld);
  const windowRect = () => ({
    x: window.screenX,
    y: window.screenY,
    width: window.innerWidth,
    height: window.innerHeight,
  });

  function setLookAt(x: number, y: number): void {
    const win = windowRect();
    rawN = normalizedFromScreen(x, y, win);
    gaze.cursor(x, y, performance.now(), win);
  }

  function updateLookAt(now: number, dt: number): void {
    let target: Normalized = rawN;
    let lambda = 8;
    if (lifeLayers && LIFE_FLAGS.gaze) {
      const g = gaze.target(now);
      target = g;
      if (g.saccade) lambda = 30; // 扫视：80ms 内基本到位
    }
    smoothN.nx = damp(smoothN.nx, target.nx, lambda, dt);
    smoothN.ny = damp(smoothN.ny, target.ny, lambda, dt);
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
    updateBlink(now);
    updateIdleVariants(now);
    updateTransition(now);
    updateMouth(now);
    updateLookAt(now, delta);
    if (lifeLayers) updateProximity(delta);
    updateDragPhysics(delta * 1000);
    const pose = composePose(now);
    if (activeClip) {
      mixer.update(delta);
      applyPose(now, pose, 'additive'); // 底噪/姿态/拖拽叠在片段之上（normalized rig）
    } else {
      applyPose(now, pose, 'absolute');
    }
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
    releaseEmotion,
    setMood(mood) {
      const band = (v: number) => (v < -0.3 ? -1 : v > 0.4 ? 1 : 0);
      const changed = band(mood) !== band(moodValue);
      moodValue = mood;
      refreshBaseline();
      if (changed) refreshIdle();
    },
    setLifeLayers(enabled) {
      lifeLayers = enabled;
      refreshBaseline();
    },
    setStreaming(active) {
      speaking = active;
      gaze.streamActive(active);
    },
    setLookAtPrefs(enabled, strength) {
      gaze.setLookAtPrefs(enabled, strength);
    },
    playAction(name, durMs) {
      sequencer.abort(); // 显式动作到来即中止 idle 序列
      hum = null;
      playActionScaled(name, durMs ?? null, ACTION_SCALE.explicit);
    },
    playBeat(kind) {
      // ⑱ 节拍手势（spec §2.7）：question → tilt .25 / exclaim → nod .3 + happy 闪 / period → 20% nod .2
      if (!lifeLayers || !LIFE_FLAGS.beat) return false;
      const now = performance.now();
      if (kind === 'question') return playBeat('tilt', 0.25, now);
      if (kind === 'exclaim') {
        const ok = playBeat('nod', ACTION_SCALE.beat, now);
        if (ok) {
          envelope.trigger({ happy: 0.1 }, now);
          setTimeout(() => envelope.release(performance.now()), 200);
        }
        return ok;
      }
      return Math.random() < 0.2 ? playBeat('nod', 0.2, now) : false;
    },
    setAutoSpeak(on) {
      autoSpeak = on;
      refreshIdle();
    },
    setLookAt,
    setMouth(v) {
      mouthTarget = Math.max(0, Math.min(1, v));
    },
    setLipsync(_visemes) {
      // V1+ 语音嘴型（tech-design §7 接口占位）；M4 显式 no-op
    },
    setIdle(intent) {
      energy = asEnergy(intent.energy);
      idleIntent = intent;
      refreshIdle();
    },
    loadActionClip,
    listEmotions: () => Object.keys(emotions),
    listActions: () => [...actionVocab],
    getStats: () => ({ fps: fps.average(), budget, budgetWarnings }),
    dispose(): void {
      disposed = true;
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      stopClip();
      mixer.stopAllAction();
      VRMUtils.deepDispose(vrm.scene);
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
