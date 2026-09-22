/**
 * CharacterRuntime 的 Live2D 引擎实现（spec §2.3）。
 * 前置：window.Live2DCubismCore 已由 main.ts 的 ensureCubismCore() 注入。
 * 眨眼/呼吸/物理/Idle 组由 pixi-live2d-display + 模型原生驱动；本层只做语义映射与参数覆写。
 *
 * 参数覆写挂 internalModel 的 `beforeModelUpdate` 事件（motion/表情/物理写参之后、
 * coreModel.update() 求值之前）——挂 app.ticker 会被 idle motion 每帧清写（如 ParamAngleZ）。
 *
 * ⑱ 生命层对齐（spec §5）：复用 VRM 侧同一套纯逻辑（LifeLayer/PostureLayer/GazeMachine），
 * 只是输出映射到 Cubism 标准参数（ParamBreath / ParamAngleX/Y/Z / ParamBodyAngleX /
 * ParamEyeBallX/Y / ParamEyeLOpen/ROpen 上限），在库原生 idle/眨眼之上**叠加**（读-加-写）。
 * 表情包络/基线 = no-op（单表情无权重）；idle 组按 energy 选 Idle/IdleLow/IdleHigh。
 */
import * as PIXI from 'pixi.js';
import { Live2DModel, MotionPriority } from 'pixi-live2d-display/cubism4';
import type { CharacterManifest } from '@openpet/protocol';
import type { CharacterRuntime } from './runtime-types';
import { dragState } from './drag-state';
import { FpsMeter } from './fps-meter';
import {
  beatMotionName,
  clamp01,
  dragToParams,
  lifeToParams,
  pickIdleGroup,
  resolveEmotion,
  resolveMotion,
} from './live2d-map';
import { LifeLayer, asEnergy, nightEnergy, addOffsets, type Energy } from './life-layers';
import { PostureLayer } from './posture';
import { GazeMachine } from './gaze';
import { damp, type Normalized } from './lookat';

// pixi-live2d-display 经 window.PIXI.Ticker 驱动模型 autoUpdate。
(window as unknown as { PIXI: typeof PIXI }).PIXI = PIXI;

import { settle } from './settle';

export async function createLive2dRuntime(
  container: HTMLElement,
  modelUrl: string,
  manifest: CharacterManifest,
): Promise<CharacterRuntime> {
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

  // asset:// 经 supportFetchAPI+CORS 放行，XHR 直载即可；若自定义 scheme 下 XHR
  // 行为异常，改用 from(settings) 重载：先 fetch(modelUrl) 拿 settings JSON、
  // 注入 url 字段后传入（两条路径见 spec §2.3 注）。
  const model = await Live2DModel.from(modelUrl, { autoInteract: false });
  app.stage.addChild(model);

  // 适配窗口：等比缩放到高度占满、底边对齐、水平居中。
  const fit = (): void => {
    const w = container.clientWidth || width;
    const h = container.clientHeight || height;
    app.renderer.resize(w, h);
    const scale = h / model.internalModel.originalHeight;
    model.scale.set(scale);
    model.x = (w - model.internalModel.originalWidth * scale) / 2;
    model.y = 0;
  };
  fit();
  const resizeObserver = new ResizeObserver(fit);
  resizeObserver.observe(container);

  const core = model.internalModel.coreModel as {
    setParameterValueById: (id: string, v: number) => void;
    getParameterValueById: (id: string) => number;
  };
  const addParam = (id: string, delta: number): void => {
    if (delta === 0) return;
    let cur = 0;
    try {
      cur = core.getParameterValueById(id);
    } catch {
      /* 模型无该参数：按 0 起 */
    }
    core.setParameterValueById(id, (Number.isFinite(cur) ? cur : 0) + delta);
  };

  // ---- ⑱ 生命层（与 VRM 侧同一套纯逻辑）----
  let lifeLayers = true;
  let energy: Energy = 'mid';
  let moodValue = 0;
  let speaking = false;
  let currentEmotion = 'neutral';
  const life = new LifeLayer(performance.now());
  const posture = new PostureLayer();
  const gaze = new GazeMachine(performance.now());
  const smoothN: Normalized = { nx: 0, ny: 0 };
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
  const motionManager = model.internalModel.motionManager as unknown as {
    definitions: Partial<Record<string, unknown[]>>;
    groups: { idle: string };
  };
  const defaultIdleGroup = motionManager.groups.idle;
  const applyIdleGroup = (): void => {
    const available = Object.keys(motionManager.definitions);
    motionManager.groups.idle = lifeLayers
      ? pickIdleGroup(available, energy, defaultIdleGroup)
      : defaultIdleGroup;
  };

  // ---- 每帧参数覆写：嘴型 + 拖拽物理 ----
  let mouth = 0;
  let physZ = 0;
  let physX = 0;
  let releaseT = -1; // <0 = 非回归期
  let releaseAmpZ = 0;
  let releaseAmpX = 0;
  let lastNow = performance.now();
  const fps = new FpsMeter();
  const beforeModelUpdate = (): void => {
    const now = performance.now();
    const dtMs = Math.min(100, now - lastNow); // 后台节流恢复时防大步长爆冲
    lastNow = now;
    fps.tick(now);
    if (dragState.active) {
      const target = dragToParams(dragState.vx, dragState.vy);
      const k = Math.min(1, dtMs / 60);
      physZ += (target.angleZ - physZ) * k;
      physX += (target.bodyAngleX - physX) * k;
      releaseT = -1;
    } else if (physZ !== 0 || physX !== 0) {
      if (releaseT < 0) {
        releaseT = 0; // 松手瞬间：以当前偏移为振幅进入回归
        releaseAmpZ = physZ;
        releaseAmpX = physX;
      }
      releaseT += dtMs;
      const env = settle(releaseT); // ⑱ 与 VRM 侧/动作余震同源
      physZ = releaseAmpZ * env;
      physX = releaseAmpX * env;
      if (Math.abs(physZ) < 0.05 && Math.abs(physX) < 0.05) {
        physZ = 0;
        physX = 0;
        releaseT = -1;
      }
    }
    if (physZ !== 0) core.setParameterValueById('ParamAngleZ', physZ);
    if (physX !== 0) core.setParameterValueById('ParamBodyAngleX', physX);
    if (mouth > 0.001) core.setParameterValueById('ParamMouthOpenY', mouth);
    // ⑱ 生命层叠加（拖拽期间头部角度已被物理接管，只叠呼吸/眼球）
    if (lifeLayers) {
      const ctx = {
        energy: nightEnergy(localHour(now), energy),
        mood: moodValue,
        speaking,
        emotion: currentEmotion,
      };
      const off = addOffsets(life.sample(now, ctx), posture.sample(now));
      const g = gaze.target(now);
      const dt = dtMs / 1000;
      const lambda = g.saccade ? 30 : 8;
      smoothN.nx = damp(smoothN.nx, g.nx, lambda, dt);
      smoothN.ny = damp(smoothN.ny, g.ny, lambda, dt);
      const p = lifeToParams(off, smoothN);
      addParam('ParamBreath', p.ParamBreath);
      addParam('ParamEyeBallX', p.ParamEyeBallX);
      addParam('ParamEyeBallY', p.ParamEyeBallY);
      if (!dragState.active && physZ === 0 && physX === 0) {
        addParam('ParamAngleX', p.ParamAngleX);
        addParam('ParamAngleY', p.ParamAngleY);
        addParam('ParamAngleZ', p.ParamAngleZ);
        addParam('ParamBodyAngleX', p.ParamBodyAngleX);
      }
      const floor = gaze.eyelidFloor(now);
      if (floor > 0) {
        for (const id of ['ParamEyeLOpen', 'ParamEyeROpen']) {
          let cur = 1;
          try {
            cur = core.getParameterValueById(id);
          } catch {
            /* 无该参数 */
          }
          core.setParameterValueById(id, Math.min(cur, 1 - floor)); // sleepy 半闭上限 0.6
        }
      }
    }
  };
  model.internalModel.on('beforeModelUpdate', beforeModelUpdate);

  const view = app.view;
  const gl = (app.renderer as PIXI.Renderer).gl;

  return {
    hitSurface: { canvas: view, gl, pixelRatio: app.renderer.resolution },
    applyEmotion(name, weight = 1) {
      currentEmotion = weight > 0 && name !== 'neutral' ? name : 'neutral';
      posture.set(currentEmotion, moodValue, performance.now());
      gaze.emotionChanged(currentEmotion);
      const expr = resolveEmotion(manifest, name);
      if (expr === undefined) {
        console.warn(`[live2d] unknown emotion "${name}" (live2dEmotions 未映射)`);
        return;
      }
      // null=清表情回默认脸（expression() 无参是"随机表情"，不可用）；string=按名设置
      if (expr === null) model.internalModel.motionManager.expressionManager?.resetExpression();
      else void model.expression(expr);
    },
    releaseEmotion() {
      // ⑱ 单表情无权重、无基线可退（spec §5）：回默认脸；姿态/视线回 neutral。
      currentEmotion = 'neutral';
      posture.set('neutral', moodValue, performance.now());
      gaze.emotionChanged('neutral');
      model.internalModel.motionManager.expressionManager?.resetExpression();
    },
    setMood(mood) {
      // ⑱ Live2D 表情层不吃 mood（spec §5 如实记录）；只进呼吸/姿态。
      moodValue = mood;
      posture.set(currentEmotion, moodValue, performance.now());
    },
    setLifeLayers(enabled) {
      lifeLayers = enabled;
      applyIdleGroup();
    },
    setStreaming(active) {
      speaking = active;
      gaze.streamActive(active);
    },
    setLookAtPrefs(enabled, strength) {
      gaze.setLookAtPrefs(enabled, strength);
    },
    playBeat(kind) {
      // ⑱ 节拍 → live2dMotions.nod/tilt（缺则 no-op）；period 20%。
      if (!lifeLayers) return false;
      if (kind === 'period' && Math.random() >= 0.2) return false;
      const name = beatMotionName(kind);
      const hit = manifest.live2dMotions?.[name];
      if (!hit) return false;
      void model.motion(hit.group, hit.index, MotionPriority.NORMAL);
      return true;
    },
    setAutoSpeak(_on) {
      // Live2D 无 hum 伪动作
    },
    playAction(name) {
      // dur 由 motion 自带时长决定（durMs 参数忽略）
      const { group, index } = resolveMotion(manifest, name);
      void model.motion(group, index, MotionPriority.FORCE);
    },
    setLookAt(x, y) {
      // ⑱ 总闸开：视线状态机驱动（track/wander/…）；关：库原生 focus 直追鼠标（本批前表现）。
      gaze.cursor(x, y, performance.now(), windowRect());
      if (!lifeLayers) model.focus(x - window.screenX, y - window.screenY);
    },
    setMouth(v) {
      mouth = clamp01(v);
    },
    setLipsync(_visemes) {
      // V1+ 音素级嘴型；接口占位
    },
    setIdle(intent) {
      // ⑱ intent.energy 偏置 idle 组（Idle/IdleLow/IdleHigh，缺回默认）；眨眼仍库原生。
      energy = asEnergy(intent.energy);
      applyIdleGroup();
    },
    listEmotions: () => Object.keys(manifest.live2dEmotions ?? {}),
    listActions: () => Object.keys(manifest.live2dMotions ?? {}),
    getStats: () => ({
      fps: fps.average(),
      budget: { triangles: 0, textureBytes: 0 }, // three 侧口径不适用（F-CH-02）
      budgetWarnings: [],
    }),
    dispose() {
      model.internalModel.off('beforeModelUpdate', beforeModelUpdate);
      resizeObserver.disconnect();
      model.destroy();
      app.destroy(true, { children: true, texture: true, baseTexture: true });
      view.remove();
    },
  };
}
