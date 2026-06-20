// Character renderer — "愚蠢的播放器"：只订阅 behavior.* 并反映之，无业务状态。
// M4：模型经 character.current → asset://（不再走 vite public 路径）；
// VRM 不可用（manifest 失败/模型缺失/加载失败）→ DOM 情绪脸，行为契约不变。
import { createVrmRuntime, type CharacterRuntime } from './runtime';
import { mountFallbackFace, type FallbackFace } from './fallback-face';
import { setupInteraction } from './interaction';
import { mountBubble } from './bubble';
import { IdleWatch, IDLE_TIMEOUT_MS } from './idle-watch';
import type { Prefs } from '@desksoul/protocol';
import '../theme/tokens.css';
import { subscribeTheme } from '../theme/subscribe';

// 跨 renderer 即时换肤：character 也订阅 app.prefs.changed（tokens.css 保持 body 透明）。
subscribeTheme();

const FPS_REPORT_MS = 10_000;
const IDLE_TICK_MS = 5_000;

declare global {
  interface Window {
    /** debug 表面（e2e / 手测用），不属于 desksoul 协议。 */
    __charDebug?: {
      mode: 'vrm' | 'fallback';
      fps: () => number;
      budget: () => unknown;
      lastLookAt: { x: number; y: number } | null;
      idleFired: number;
    };
  }
}

async function bootRuntime(stageEl: HTMLElement): Promise<CharacterRuntime> {
  const cur = await window.desksoul.rpc('character.current', {});
  const modelUrl = `asset://${cur.characterId}/${cur.manifest.model}`;
  return createVrmRuntime(stageEl, modelUrl, cur.manifest);
}

/** A3 穿透切换反馈：扩散涟漪（穿透=青/恢复=暖）+ 顶部 toast 文案（character 窗内 DOM）。 */
function showClickThroughFx(ignore: boolean): void {
  const ripple = document.getElementById('ripple');
  if (ripple) {
    ripple.style.background = ignore ? 'rgba(111, 168, 255, 0.5)' : 'rgba(255, 143, 171, 0.5)';
    ripple.classList.remove('ripple-play');
    requestAnimationFrame(() => ripple.classList.add('ripple-play')); // 下一帧重启动画
  }
  const toast = document.getElementById('toast');
  if (toast) {
    toast.textContent = ignore ? '🔇 鼠标穿透已开启' : '✋ 已恢复互动';
    toast.classList.add('toast-show');
    setTimeout(() => toast.classList.remove('toast-show'), 1600);
  }
}

async function boot(): Promise<void> {
  const stageEl = document.getElementById('stage')!;
  const fallbackEl = document.getElementById('fallback')!;

  let runtime: CharacterRuntime | null = null;
  let face: FallbackFace | null = null;
  try {
    runtime = await bootRuntime(stageEl);
    setupInteraction(runtime.renderer);
  } catch (e) {
    console.warn('[character] VRM unavailable, using fallback face:', e);
    fallbackEl.style.display = 'flex';
    face = mountFallbackFace(fallbackEl);
    setupInteraction(null); // DOM 无 alpha buffer：只拖拽，不穿透
  }

  const debug: NonNullable<Window['__charDebug']> = {
    mode: runtime ? 'vrm' : 'fallback',
    fps: () => runtime?.getStats().fps ?? 0,
    budget: () => (runtime ? runtime.getStats() : null),
    lastLookAt: null,
    idleFired: 0,
  };
  window.__charDebug = debug;

  // ---- 90s 主动行为：通知/指针活动重置，超时上报 Main ----
  const idleWatch = new IdleWatch(IDLE_TIMEOUT_MS, (idleMs) => {
    debug.idleFired += 1;
    void window.desksoul.rpc('character.idleTimeout', { idleMs: Math.round(idleMs) });
  });
  const markActivity = (): void => idleWatch.activity(performance.now());
  markActivity(); // 启动基线：开机静置 90s 也算一次完整空闲期
  window.addEventListener('pointerdown', markActivity);
  setInterval(() => idleWatch.tick(performance.now()), IDLE_TICK_MS);

  // ---- behavior.* 订阅（M1 契约不变，M4 全部接到 runtime）----
  window.desksoul.on('behavior.applyEmotion', ({ name, weight }) => {
    markActivity();
    if (runtime) runtime.applyEmotion(name, weight);
    else face?.apply(name);
  });

  window.desksoul.on('behavior.playAction', ({ name, durationMs }) => {
    markActivity();
    if (runtime) runtime.playAction(name, durationMs);
    else face?.setAction(name, durationMs);
  });

  window.desksoul.on('behavior.setIntent', ({ mood, energy }) => {
    markActivity();
    if (runtime) runtime.setIdle({ mood, energy });
    else face?.setIntent(mood, energy);
  });

  window.desksoul.on('behavior.lookAt', ({ x, y }) => {
    debug.lastLookAt = { x, y };
    runtime?.setLookAt(x, y); // 不算 activity：光标常动，算了 90s 永不触发
  });

  // ---- A2 桌面气泡：流式文本逐字 + 按 pref 自动消失（character 仍只反映 chat，无业务）----
  const bubble = mountBubble(document.getElementById('bubble')!);
  window.desksoul.on('chat.stream', ({ text }) => {
    markActivity();
    bubble.appendStream(text);
  });
  window.desksoul.on('app.prefs.changed', (p) => {
    const c = p as { key?: string; value?: unknown };
    if (c.key === 'display.bubbleDuration') {
      bubble.setDuration(c.value as Prefs['display.bubbleDuration']);
    } else if (c.key === 'display.clickThrough') {
      showClickThroughFx(c.value === true); // A3：穿透切换涟漪 + toast
    }
  });
  // 非阻塞读初始时长（默认 '5' 已在 mountBubble 内置，await 慢也不漏早到的 stream）。
  void window.desksoul
    .rpc('app.prefs.getAll', {})
    .then((prefs) => bubble.setDuration((prefs as Prefs)['display.bubbleDuration']))
    .catch(() => {});

  // 回合结束 1.2s 后复位 neutral（S4 行为；neutral 不在情绪表 → 全零权重 = 复位）
  window.desksoul.on('chat.done', () => {
    markActivity();
    bubble.endStream();
    setTimeout(() => {
      if (runtime) runtime.applyEmotion('neutral', 0);
      else face?.reset();
    }, 1200);
  });

  // ---- FPS 周期上报：console 口径，HUD 是 M7/M8 的事 ----
  if (runtime) {
    const rt = runtime;
    setInterval(() => {
      const { fps } = rt.getStats();
      if (fps === 0) return; // 窗口未满一秒
      if (fps < 30) console.warn(`[character] FPS(30s avg) ${fps.toFixed(1)} < 30`);
      else console.info(`[character] FPS(30s avg) ${fps.toFixed(1)}`);
    }, FPS_REPORT_MS);
  }
}

void boot();
export {};
