// Character renderer — "愚蠢的播放器"：只订阅 behavior.* 并反映之，无业务状态。
// 优先 VRM（S3 形态）；模型缺失/加载失败 → DOM 情绪脸（S4 形态），行为契约不变。
import { createVrmStage, type VrmStage } from './vrm-stage';
import { mountFallbackFace, type FallbackFace } from './fallback-face';
import { setupInteraction } from './interaction';

const MODEL_URL = '/models/sample.vrm';

async function boot(): Promise<void> {
  const stageEl = document.getElementById('stage')!;
  const fallbackEl = document.getElementById('fallback')!;

  let stage: VrmStage | null = null;
  let face: FallbackFace | null = null;
  try {
    stage = await createVrmStage(stageEl, MODEL_URL);
    setupInteraction(stage.renderer);
  } catch (e) {
    console.warn('[character] VRM unavailable, using fallback face:', e);
    fallbackEl.style.display = 'flex';
    face = mountFallbackFace(fallbackEl);
    setupInteraction(null); // DOM 无 alpha buffer：只拖拽，不穿透
  }

  window.desksoul.on('behavior.applyEmotion', (payload) => {
    const { name, weight } = payload as { name: string; weight: number };
    if (stage) stage.applyEmotion(name, weight);
    else face?.apply(name);
  });

  window.desksoul.on('behavior.playAction', (payload) => {
    const { name, durationMs } = payload as { name: string; durationMs: number | null };
    // M1：VRM 动作剪辑池随 M4 落地，先记录；fallback 直接显示
    if (face) face.setAction(name, durationMs);
    else console.log(`[character] action: ${name} (${durationMs ?? '∞'}ms)`);
  });

  window.desksoul.on('behavior.setIntent', (payload) => {
    const { mood, energy } = payload as { mood: string; energy: string };
    if (face) face.setIntent(mood, energy);
    else console.log(`[character] intent: mood=${mood} energy=${energy}`);
  });

  // 回合结束 1.2s 后复位 neutral（S4 行为；neutral 不在 EMOTIONS 表 → 全零权重 = 复位）
  window.desksoul.on('chat.done', () => {
    setTimeout(() => {
      if (stage) stage.applyEmotion('neutral', 0);
      else face?.reset();
    }, 1200);
  });
}

void boot();
export {};
