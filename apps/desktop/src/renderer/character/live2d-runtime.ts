/**
 * CharacterRuntime 的 Live2D 引擎实现（spec §2.3）。
 * 前置：window.Live2DCubismCore 已由 main.ts 的 ensureCubismCore() 注入。
 * 眨眼/呼吸/物理/Idle 组由 pixi-live2d-display + 模型原生驱动；本层只做语义映射与参数覆写。
 *
 * 参数覆写挂 internalModel 的 `beforeModelUpdate` 事件（motion/表情/物理写参之后、
 * coreModel.update() 求值之前）——挂 app.ticker 会被 idle motion 每帧清写（如 ParamAngleZ）。
 */
import * as PIXI from 'pixi.js';
import { Live2DModel, MotionPriority } from 'pixi-live2d-display/cubism4';
import type { CharacterManifest } from '@openpet/protocol';
import type { CharacterRuntime } from './runtime-types';
import { dragState } from './drag-state';
import { FpsMeter } from './fps-meter';
import { clamp01, dragToParams, resolveEmotion, resolveMotion } from './live2d-map';

// pixi-live2d-display 经 window.PIXI.Ticker 驱动模型 autoUpdate。
(window as unknown as { PIXI: typeof PIXI }).PIXI = PIXI;

// 松手弹性回归包络（与 VRM 侧 runtime.ts 同手感常数）。
const RELEASE_TAU_MS = 130;
const RELEASE_OMEGA = 0.016;

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
      const env = Math.exp(-releaseT / RELEASE_TAU_MS) * Math.cos(RELEASE_OMEGA * releaseT);
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
  };
  model.internalModel.on('beforeModelUpdate', beforeModelUpdate);

  const view = app.view;
  const gl = (app.renderer as PIXI.Renderer).gl;

  return {
    hitSurface: { canvas: view, gl, pixelRatio: app.renderer.resolution },
    applyEmotion(name) {
      const expr = resolveEmotion(manifest, name);
      if (expr === undefined) {
        console.warn(`[live2d] unknown emotion "${name}" (live2dEmotions 未映射)`);
        return;
      }
      // null=清表情回默认脸（expression() 无参是"随机表情"，不可用）；string=按名设置
      if (expr === null) model.internalModel.motionManager.expressionManager?.resetExpression();
      else void model.expression(expr);
    },
    playAction(name) {
      // dur 由 motion 自带时长决定（durMs 参数忽略）
      const { group, index } = resolveMotion(manifest, name);
      void model.motion(group, index, MotionPriority.FORCE);
    },
    setLookAt(x, y) {
      // 屏幕坐标(DIP) → 窗口内坐标；无框窗下 client 原点即 screenX/Y
      model.focus(x - window.screenX, y - window.screenY);
    },
    setMouth(v) {
      mouth = clamp01(v);
    },
    setLipsync(_visemes) {
      // V1+ 音素级嘴型；接口占位
    },
    setIdle(_intent) {
      // 库原生自动播 Idle 组 + 自动眨眼；intent 偏置 idle 组是 follow-up
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
