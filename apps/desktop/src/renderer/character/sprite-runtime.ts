/**
 * ⑳ CharacterRuntime 的 2D 帧动画引擎实现（spec §3 / §4）——pixi 6 装配层，逻辑全在纯模块里：
 *   帧通道 = sprite-player（SpriteDirector 五级裁决 → 换纹理）；
 *   程序化通道 = ⑱ 同一套纯逻辑（LifeLayer / PostureLayer / 动作包络 / IdleSequencer / 节拍门 / 拖拽 / 靠近）
 *   → sprite-transform#offsetsTo2D → 双层容器变换（内层底部中心枢轴、外层顶部中心枢轴摆动）。
 * Application 参数与 live2d-runtime 同款 → hitSurface alpha 命中穿透零改动。
 *
 * 图集加载走 fetch → blob → createImageBitmap → 2D canvas（不受跨源污染；同一 canvas 顺带取 alpha 算轮廓）。
 * pixel 模式：精灵先画进原生分辨率 RenderTexture，全部 2D 变换在低分辨率空间施加（位移取整），
 * 再整体最近邻放大——像素永远方正对齐，呼吸量化为 1 个源像素的起伏（spec §3.2）。
 */
import * as PIXI from 'pixi.js';
import {
  frameRects,
  resolveSprite,
  vocabOf,
  type CharacterManifest,
  type ResolvedSprite,
  type SpriteSheet,
} from '@openpet/protocol';
import type { CharacterRuntime } from './runtime-types';
import { dragState } from './drag-state';
import { FpsMeter } from './fps-meter';
import {
  ACTION_COMPANIONS,
  ACTION_DEFAULT_MS,
  ACTION_SCALE,
  ZERO_OFFSETS,
  actionTotalMs,
  sampleAction,
  sampleActionEnvelope,
  type BoneOffsets,
} from './actions';
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
import { damp } from './lookat';
import { settle } from './settle';
import {
  IdleSequencer,
  planNextIdle,
  selectIdleVariants,
  stepsOf,
  type IdleIntent,
  type IdleStep,
  type IdleVariant,
} from './idle-pool';
import { SpriteDirector } from './sprite-player';
import {
  FacingTracker,
  IDENTITY_2D,
  SPRITE_2D_GAIN,
  SPRITE_FLAGS,
  alphaBBox,
  contentBoxInView,
  dragPendulum,
  fitSprite,
  offsetsTo2D,
  pixelRtSize,
  unionBBox,
  type BBox,
  type SpriteFit,
} from './sprite-transform';

interface LoadedSheet {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
}

/** asset:// → 位图 → canvas（createImageBitmap 解码失败 / 尺寸为 0 → 抛，main.ts 落 fallback 脸）。 */
async function loadSheetImage(url: string): Promise<LoadedSheet> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`sprite sheet HTTP ${res.status}: ${url}`);
  const bitmap = await createImageBitmap(await res.blob());
  const { width, height } = bitmap;
  if (width === 0 || height === 0) throw new Error(`sprite sheet has zero size: ${url}`);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true }); // 轮廓逐帧 getImageData
  if (!ctx) throw new Error('2d canvas unavailable');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return { canvas, width, height };
}

interface Built {
  resolved: ResolvedSprite;
  cell: { width: number; height: number };
  baseTexture: PIXI.BaseTexture;
  textures: Record<string, PIXI.Texture[]>;
  director: SpriteDirector;
  /** idle 行各帧 alpha 包围盒并集（格内坐标）。 */
  bbox: BBox | null;
  textureBytes: number;
}

/** 切帧 + 轮廓 + 导演（纯逻辑在 protocol / sprite-player，这里只把矩形变成 pixi 纹理）。 */
function buildSheet(sheet: LoadedSheet, resolved: ResolvedSprite, now: number): Built {
  const frames = frameRects(resolved, sheet.width, sheet.height);
  for (const w of frames.warnings) console.warn(`[sprite] ${w}`);
  const baseTexture = PIXI.BaseTexture.from(sheet.canvas, {
    scaleMode: resolved.smoothing === 'pixel' ? PIXI.SCALE_MODES.NEAREST : PIXI.SCALE_MODES.LINEAR,
  });
  const textures: Record<string, PIXI.Texture[]> = {};
  for (const [name, s] of Object.entries(frames.states)) {
    textures[name] = s.rects.map((r) => new PIXI.Texture(baseTexture, new PIXI.Rectangle(r.x, r.y, r.w, r.h)));
  }
  const director = new SpriteDirector(
    { states: frames.states, emotions: resolved.emotions, actions: resolved.actions, slots: resolved.slots },
    now,
  );
  // 可见轮廓：idle 行各帧 alpha 包围盒并集（一次性）
  const ctx = sheet.canvas.getContext('2d');
  const idleRects = frames.states[resolved.slots.idle]?.rects ?? [];
  const bbox = ctx
    ? unionBBox(
        idleRects.map((r) => {
          const img = ctx.getImageData(r.x, r.y, r.w, r.h);
          return alphaBBox(img.data, r.w, r.h);
        }),
      )
    : null;
  return {
    resolved,
    cell: frames.cell,
    baseTexture,
    textures,
    director,
    bbox,
    textureBytes: sheet.width * sheet.height * 4,
  };
}

export async function createSpriteRuntime(
  container: HTMLElement,
  sheetUrl: string,
  manifest: CharacterManifest,
): Promise<CharacterRuntime> {
  if (!manifest.sprite) throw new Error('sprite engine requires manifest.sprite');
  let resolved = resolveSprite(manifest.sprite);
  const sheet = await loadSheetImage(sheetUrl);

  const width = container.clientWidth || 320;
  const height = container.clientHeight || 480;
  const app = new PIXI.Application({
    width,
    height,
    backgroundAlpha: 0,
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio, 2),
    preserveDrawingBuffer: true, // interaction readPixels 需要
  });
  container.appendChild(app.view);
  const renderer = app.renderer as PIXI.Renderer;

  let built = buildSheet(sheet, resolved, performance.now());

  // ---- 场景：swing（外层，格顶部中心枢轴：拖拽摆动）→ frameSprite（内层，底部中心枢轴）----
  // smooth：swing 直接挂 stage（显示坐标）；pixel：swing 挂离屏 rtStage（原生分辨率），stage 只放放大后的 RT 精灵。
  const swing = new PIXI.Container();
  const frameSprite = new PIXI.Sprite(built.textures[resolved.slots.idle]![0]!);
  frameSprite.anchor.set(0.5, 1); // 内层底部中心枢轴：挤压 / 跳跃以脚为支点
  swing.addChild(frameSprite);
  let rt: PIXI.RenderTexture | null = null;
  let rtSprite: PIXI.Sprite | null = null;
  const rtStage = new PIXI.Container();

  function setupMode(): void {
    app.stage.removeChildren();
    rtStage.removeChildren();
    rtSprite?.destroy();
    rt?.destroy(true);
    rt = null;
    rtSprite = null;
    if (built.resolved.smoothing === 'pixel') {
      const size = pixelRtSize(built.cell);
      rt = PIXI.RenderTexture.create({
        width: size.w,
        height: size.h,
        scaleMode: PIXI.SCALE_MODES.NEAREST,
        resolution: 1,
      });
      rtStage.addChild(swing);
      rtSprite = new PIXI.Sprite(rt);
      rtSprite.anchor.set(0.5, 1); // RT 底边 = 格底边
      app.stage.addChild(rtSprite);
    } else {
      app.stage.addChild(swing);
    }
  }
  setupMode();

  // ---- 适配 + 轮廓 ----
  let fit: SpriteFit = fitSprite(width, height, built.cell.width, built.cell.height, built.resolved.fit);
  let box: { top: number; bottom: number } | null = null;
  /** 帧精灵底部中心锚点（swing 局部坐标 = 所在空间坐标）。 */
  const base = { x: 0, y: 0 };
  const layout = (): void => {
    const w = container.clientWidth || width;
    const h = container.clientHeight || height;
    renderer.resize(w, h);
    fit = fitSprite(w, h, built.cell.width, built.cell.height, built.resolved.fit);
    box = built.bbox ? contentBoxInView(built.bbox, fit) : null;
    if (rt && rtSprite) {
      // 原生分辨率空间：RT 底边中心 = 格底边中心；枢轴 = 格顶部中心
      base.x = rt.width / 2;
      base.y = rt.height;
      rtSprite.position.set(fit.x + fit.w / 2, fit.y + fit.h);
      rtSprite.scale.set(fit.scale);
      swing.pivot.set(base.x, rt.height - built.cell.height);
    } else {
      base.x = fit.x + fit.w / 2;
      base.y = fit.y + fit.h;
      swing.pivot.set(base.x, fit.y);
    }
    swing.position.copyFrom(swing.pivot);
  };
  layout();
  const resizeObserver = new ResizeObserver(layout);
  resizeObserver.observe(container);

  // ---- ⑱ 程序化通道（与 VRM / Live2D 同一套纯逻辑）----
  let lifeLayers = true;
  let energy: Energy = 'mid';
  let moodValue = 0;
  let speaking = false;
  let currentEmotion = 'neutral';
  const life = new LifeLayer(performance.now());
  const posture = new PostureLayer();
  const gaze = new GazeMachine(performance.now()); // 只用于光标追踪（靠近 / 翻转）；精灵无眼球
  let lookAtEnabled = true;
  let facing = built.resolved.facing !== 'front' ? new FacingTracker(built.resolved.facing) : null;
  let cursorX: number | null = null;
  let hourCache = { at: -Infinity, hour: new Date().getHours() };
  const localHour = (now: number): number => {
    if (now - hourCache.at > 1000) hourCache = { at: now, hour: new Date().getHours() };
    return hourCache.hour;
  };
  const windowRect = () => ({
    x: window.screenX,
    y: window.screenY,
    width: window.innerWidth,
    height: window.innerHeight,
  });

  // 情绪保持：非说话期触发的情绪（如轮末表情兜底）没有后续 chat.done 来复位 → 定时退基线（同 VRM）
  const EMOTION_HOLD_MS = 4000;
  let holdTimer: ReturnType<typeof setTimeout> | null = null;

  // 程序化动作：单活动作（映射到行的动作不走这里，防双重动作）
  let activeAction: {
    name: string;
    start: number;
    durMs: number;
    scale: number;
    total: number;
    restorePosture: boolean;
  } | null = null;
  let lastActionEnd = -Infinity;
  let rowWasActive = false;

  /** 协同表：精灵只保留呼吸拍与临时姿态（视线 / 眨眼 / 嘴类 companion no-op，spec §2.3）。 */
  function dispatchCompanions(name: string, scale: number, now: number): boolean {
    if (!lifeLayers || !LIFE_FLAGS.companions || Math.abs(scale) < 0.5) return false;
    const c = ACTION_COMPANIONS[name as keyof typeof ACTION_COMPANIONS];
    if (!c) return false;
    if (c.breath) life.nudgeBreath(c.breath, now);
    if (c.posture) {
      posture.override(c.posture, now);
      return true;
    }
    return false;
  }

  function playProcedural(name: string, durMs: number | null | undefined, scale: number): void {
    const known = (ACTION_DEFAULT_MS as Record<string, number>)[name];
    if (known === undefined) {
      console.warn(`[sprite] action "${name}" 既无映射行也无程序化曲线`);
      return;
    }
    const now = performance.now();
    const dur = durMs ?? known;
    activeAction = {
      name,
      start: now,
      durMs: dur,
      scale,
      total: lifeLayers ? actionTotalMs(name, dur) : dur,
      restorePosture: dispatchCompanions(name, scale, now),
    };
  }

  function endAction(now: number): void {
    if (activeAction?.restorePosture) posture.set(currentEmotion, moodValue, now);
    activeAction = null;
    lastActionEnd = now;
  }

  function actionOffsets(now: number): BoneOffsets {
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
    const out = { ...raw };
    for (const k of Object.keys(out) as Array<keyof BoneOffsets>) out[k] = raw[k] * activeAction.scale;
    return out;
  }

  const busy = (): boolean => activeAction !== null || built.director.oneShotActive();

  /** 节拍门（同 VRM）：无活动作（曲线或行）且距上次动作 ≥1.5s 才播，否则丢弃。 */
  const BEAT_GATE_MS = 1500;
  function beat(name: string, scale: number, now: number): boolean {
    if (busy() || now - lastActionEnd < BEAT_GATE_MS) return false;
    playProcedural(name, null, scale);
    return true;
  }

  // ---- idle 变体（程序化小动作，节奏同 ⑱；映射行的动作在 idle 里也走曲线，幅度 ≤0.7）----
  let idleIntent: IdleIntent = { mood: 'neutral', energy: 'mid' };
  let autoSpeak = false;
  let idleSubset: IdleVariant[] = selectIdleVariants(idleIntent);
  let nextIdle = planNextIdle(performance.now(), idleSubset);
  const sequencer = new IdleSequencer();
  function refreshIdle(): void {
    idleSubset = selectIdleVariants(idleIntent, { moodValue, autoSpeak });
    nextIdle = planNextIdle(performance.now(), idleSubset, Math.random, energy);
  }
  function playIdleStep(step: IdleStep): void {
    if (step.action === 'hum') return; // 嘴部伪动作对精灵 no-op
    playProcedural(step.action, step.durationMs, step.scale);
  }
  function updateIdleVariants(now: number): void {
    if (!lifeLayers) return; // 总闸关：只剩帧动画（spec §8.8）
    if (sequencer.active) {
      const step = sequencer.next(now, busy());
      if (step) playIdleStep(step);
      return;
    }
    if (now < nextIdle.at) return;
    if (!busy()) sequencer.start(stepsOf(nextIdle.variant), now);
    nextIdle = planNextIdle(now, idleSubset, Math.random, energy);
  }

  // ---- 拖拽摆动（外层顶部枢轴）：跟随 → 松手 settle 过冲回正（与 VRM / Live2D 同源）----
  let swingAngle = 0;
  let releaseT = -1;
  let releaseAmp = 0;
  function updateSwing(dtMs: number): void {
    if (dragState.active) {
      swingAngle += (dragPendulum(dragState.vx) - swingAngle) * Math.min(1, dtMs / 60);
      releaseT = -1;
      return;
    }
    if (swingAngle === 0) return;
    if (releaseT < 0) {
      releaseT = 0;
      releaseAmp = swingAngle;
    }
    releaseT += dtMs;
    swingAngle = releaseAmp * settle(releaseT);
    if (Math.abs(swingAngle) < 1e-3) {
      swingAngle = 0;
      releaseT = -1;
    }
  }

  // ---- 嘴型 / 靠近 ----
  let mouthTarget = 0;
  let mouthCurrent = 0;
  let proximity = 0;

  const fps = new FpsMeter();
  let lastNow = performance.now();
  function update(): void {
    const now = performance.now();
    const dtMs = Math.min(100, now - lastNow);
    lastNow = now;
    fps.tick(now);
    const b = built;
    const e = lifeLayers ? nightEnergy(localHour(now), energy) : energy;
    b.director.setEnergy(e);

    // 帧通道
    const f = b.director.tick(now, { active: dragState.active, vx: dragState.vx });
    const tex = SPRITE_FLAGS.frames
      ? b.textures[f.state]?.[f.frame]
      : b.textures[b.resolved.slots.idle]?.[0]; // harness A/B：定格 idle 第 0 帧
    if (tex && frameSprite.texture !== tex) frameSprite.texture = tex;
    const rowActive = b.director.oneShotActive();
    if (rowWasActive && !rowActive) lastActionEnd = now;
    rowWasActive = rowActive;

    // 程序化通道
    updateIdleVariants(now);
    mouthCurrent += (mouthTarget - mouthCurrent) * 0.15;
    if (mouthTarget === 0 && mouthCurrent < 1e-3) mouthCurrent = 0;
    const layers: Array<Partial<BoneOffsets>> = [actionOffsets(now)];
    if (lifeLayers) {
      const ctx = { energy: e, mood: moodValue, speaking, emotion: currentEmotion };
      const post = posture.sample(now); // 始终采样保持缓动连续
      if (b.resolved.proceduralLife) layers.push(life.sample(now, ctx));
      if (LIFE_FLAGS.posture) layers.push(post);
      const near =
        lookAtEnabled &&
        gaze.state(now) === 'track' &&
        gaze.cursorDistance(windowRect()) < PROXIMITY_PX;
      proximity = damp(proximity, near ? 1 : 0, near ? 10 : 3, dtMs / 1000);
      if (proximity < 1e-3) proximity = 0;
      if (LIFE_FLAGS.proximity && proximity > 0) layers.push(proximityOffsets(gaze.cursorNx(), proximity));
    }
    const t = SPRITE_FLAGS.procedural
      ? offsetsTo2D(addOffsets(...layers), b.cell.height, SPRITE_2D_GAIN)
      : { ...IDENTITY_2D };
    if (SPRITE_FLAGS.procedural && !b.resolved.slots.talk) t.sy += mouthCurrent * SPRITE_2D_GAIN.mouth; // 无 talk 行：说话轻微起伏
    let flip = 1;
    if (facing && b.resolved.flipToCursor && lookAtEnabled && cursorX !== null) {
      flip = facing.update(cursorX - (window.screenX + window.innerWidth / 2), now);
    }
    updateSwing(dtMs);

    // 呈现（pixel：变换在原生分辨率空间，位移取整——像素永远方正对齐）
    const pixel = rt !== null;
    const k = pixel ? 1 : fit.scale;
    const x = base.x + t.dx * k;
    const y = base.y + t.dy * k;
    frameSprite.position.set(pixel ? Math.round(x) : x, pixel ? Math.round(y) : y);
    frameSprite.scale.set(k * t.sx * flip, k * t.sy);
    frameSprite.rotation = t.rot;
    frameSprite.skew.x = t.skewX;
    swing.rotation = swingAngle;
    if (rt) renderer.render(rtStage, { renderTexture: rt, clear: true });
  }
  app.ticker.add(update);

  // 窗口隐藏时暂停（rAF 本就节流；显式停掉省电）
  const onVisibility = (): void => {
    if (document.hidden) app.ticker.stop();
    else {
      lastNow = performance.now();
      app.ticker.start();
    }
  };
  document.addEventListener('visibilitychange', onVisibility);

  function applyEmotion(name: string, weight = 1): void {
    const now = performance.now();
    if (holdTimer) clearTimeout(holdTimer);
    holdTimer = speaking ? null : setTimeout(releaseEmotion, EMOTION_HOLD_MS);
    currentEmotion = weight > 0 && name !== 'neutral' ? name : 'neutral';
    posture.set(currentEmotion, moodValue, now);
    built.director.applyEmotion(name, weight, now);
  }

  function releaseEmotion(): void {
    if (holdTimer) clearTimeout(holdTimer);
    holdTimer = null;
    currentEmotion = 'neutral';
    posture.set('neutral', moodValue, performance.now());
    built.director.releaseEmotion();
  }

  const vocab = vocabOf(manifest);

  return {
    hitSurface: { canvas: app.view, gl: renderer.gl, pixelRatio: renderer.resolution },
    applyEmotion,
    releaseEmotion,
    setMood(mood) {
      const band = (v: number) => (v < -0.3 ? -1 : v > 0.4 ? 1 : 0);
      const changed = band(mood) !== band(moodValue);
      moodValue = mood;
      posture.set(currentEmotion, moodValue, performance.now());
      if (changed) refreshIdle();
    },
    setLifeLayers(enabled) {
      lifeLayers = enabled;
      if (!enabled) sequencer.abort();
    },
    setStreaming(active) {
      speaking = active;
      built.director.setTalking(active);
    },
    setLookAtPrefs(enabled, strength) {
      lookAtEnabled = enabled;
      gaze.setLookAtPrefs(enabled, strength);
    },
    playAction(name, durMs) {
      sequencer.abort(); // 显式动作到来即中止 idle 序列
      const now = performance.now();
      const route = built.director.playAction(name, durMs ?? null, now);
      if (route.kind === 'row') {
        activeAction = null; // 映射到行：不叠曲线（防双重动作），协同只留呼吸 / 姿态
        dispatchCompanions(name, ACTION_SCALE.explicit, now);
        return;
      }
      playProcedural(name, durMs ?? null, ACTION_SCALE.explicit);
    },
    playBeat(kind) {
      // 同 VRM：question → tilt .25 / exclaim → nod .3 / period → 20% nod .2（精灵无表情闪）
      if (!lifeLayers || !LIFE_FLAGS.beat) return false;
      const now = performance.now();
      if (kind === 'question') return beat('tilt', 0.25, now);
      if (kind === 'exclaim') return beat('nod', ACTION_SCALE.beat, now);
      return Math.random() < 0.2 ? beat('nod', 0.2, now) : false;
    },
    setAutoSpeak(on) {
      autoSpeak = on; // hum 对精灵本就 no-op；只影响 idle 池抽样
      refreshIdle();
    },
    setLookAt(x, y) {
      cursorX = x;
      gaze.cursor(x, y, performance.now(), windowRect());
    },
    setMouth(v) {
      mouthTarget = Math.max(0, Math.min(1, v));
      built.director.setMouth(mouthTarget);
    },
    setLipsync(_visemes) {
      // V1+ 音素级嘴型；接口占位
    },
    setIdle(intent) {
      energy = asEnergy(intent.energy);
      idleIntent = intent;
      refreshIdle();
    },
    listEmotions: () => [...vocab.emotions],
    listActions: () => [...vocab.actions],
    getStats: () => ({
      fps: fps.average(),
      budget: {
        triangles: 0,
        textureBytes: built.textureBytes + (rt ? rt.width * rt.height * 4 : 0),
      },
      budgetWarnings: [],
    }),
    contentBox: () => box,
    playState: (state) => built.director.playState(state, null, performance.now()),
    listStates: () => Object.keys(built.resolved.states),
    async loadSheet(url, sprite?: SpriteSheet) {
      // harness：热换图集（可同时换布局）；失败抛出，旧图集保持
      const next = sprite ? resolveSprite(sprite) : resolved;
      const img = await loadSheetImage(url);
      const nb = buildSheet(img, next, performance.now());
      const old = built;
      built = nb;
      resolved = next;
      facing = next.facing !== 'front' ? new FacingTracker(next.facing) : null;
      frameSprite.texture = nb.textures[next.slots.idle]![0]!;
      setupMode();
      layout();
      for (const list of Object.values(old.textures)) for (const tx of list) tx.destroy(false);
      old.baseTexture.destroy();
    },
    dispose() {
      if (holdTimer) clearTimeout(holdTimer);
      document.removeEventListener('visibilitychange', onVisibility);
      app.ticker.remove(update);
      resizeObserver.disconnect();
      rtStage.destroy({ children: true }); // pixel 模式下帧精灵挂在离屏 stage 上
      app.destroy(true, { children: true, texture: true, baseTexture: true });
      if (!built.baseTexture.destroyed) built.baseTexture.destroy();
    },
  };
}
