// Character renderer — "愚蠢的播放器"：只订阅 behavior.* 并反映之，无业务状态。
// M4：模型经 character.current → asset://（不再走 vite public 路径）；
// VRM 不可用（manifest 失败/模型缺失/加载失败）→ DOM 情绪脸，行为契约不变。
import { createVrmRuntime, type CharacterRuntime } from './runtime';
import { mountFallbackFace, type FallbackFace } from './fallback-face';
import { setupInteraction } from './interaction';
import { mountBubble } from './bubble';
import { resolveMode } from './desktop-state';
import { IdleWatch, IDLE_TIMEOUT_MS } from './idle-watch';
import { mouthValue, playbackRateOf } from './mouth-drive';
import type { Prefs } from '@openpet/protocol';
import '../theme/tokens.css';
import { subscribeTheme } from '../theme/subscribe';
import { charStrings } from './strings';

// 跨 renderer 即时换肤：character 也订阅 app.prefs.changed（tokens.css 保持 body 透明）。
subscribeTheme();

const FPS_REPORT_MS = 10_000;
const IDLE_TICK_MS = 5_000;

declare global {
  interface Window {
    /** debug 表面（e2e / 手测用），不属于 openpet 协议。 */
    __charDebug?: {
      mode: 'vrm' | 'live2d' | 'fallback';
      fps: () => number;
      budget: () => unknown;
      lastLookAt: { x: number; y: number } | null;
      idleFired: number;
    };
  }
}

/** Cubism Core 动态注入（只注一次）；缺失/加载失败 → throw，由 boot 的 catch 落 fallback 脸。 */
let cubismCoreLoading: Promise<void> | null = null;
function ensureCubismCore(): Promise<void> {
  if ((window as { Live2DCubismCore?: unknown }).Live2DCubismCore) return Promise.resolve();
  cubismCoreLoading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    // 相对路径：dev(http://…/character/) 与生产(file://…/renderer/character/) 都指到
    // publicDir 拷贝目标（renderer 根）；根绝对路径在 file:// 下会指向盘符根，不可用。
    s.src = '../live2dcubismcore.min.js';
    s.onload = () => {
      if ((window as { Live2DCubismCore?: unknown }).Live2DCubismCore) resolve();
      else reject(new Error('live2dcubismcore.min.js 已加载但未暴露 Live2DCubismCore'));
    };
    s.onerror = () =>
      reject(
        new Error(
          'Live2D Cubism Core 未安装：请从官方下载 live2dcubismcore.min.js 放入 src/renderer/public/（见该目录 README.md）',
        ),
      );
    document.head.appendChild(s);
  });
  return cubismCoreLoading;
}

let bootedEngine: 'vrm' | 'live2d' = 'vrm';

async function bootRuntime(stageEl: HTMLElement): Promise<CharacterRuntime> {
  const cur = await window.openpet.rpc('character.current', {});
  const modelUrl = `asset://${cur.characterId}/${cur.manifest.model}`;
  if (cur.manifest.engine === 'live2d') {
    bootedEngine = 'live2d';
    await ensureCubismCore();
    const { createLive2dRuntime } = await import('./live2d-runtime'); // 动态 import：VRM 用户不载 pixi
    return createLive2dRuntime(stageEl, modelUrl, cur.manifest);
  }
  bootedEngine = 'vrm';
  return createVrmRuntime(stageEl, modelUrl, cur.manifest);
}

// i18n：character 窗仅两条 toast 文案走微型字典；locale 随 prefs 初读与变更同步。
let locale = 'zh-CN';

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
    const str = charStrings(locale);
    toast.textContent = ignore ? str.clickThroughOn : str.clickThroughOff;
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
    setupInteraction(runtime.hitSurface);
  } catch (e) {
    console.warn('[character] runtime unavailable, using fallback face:', e);
    fallbackEl.style.display = 'flex';
    face = mountFallbackFace(fallbackEl);
    setupInteraction(null); // DOM 无 alpha buffer：只拖拽，不穿透
  }

  const debug: NonNullable<Window['__charDebug']> = {
    mode: runtime ? bootedEngine : 'fallback',
    fps: () => runtime?.getStats().fps ?? 0,
    budget: () => (runtime ? runtime.getStats() : null),
    lastLookAt: null,
    idleFired: 0,
  };
  window.__charDebug = debug;

  // ---- 90s 主动行为：通知/指针活动重置，超时上报 Main ----
  const idleWatch = new IdleWatch(IDLE_TIMEOUT_MS, (idleMs) => {
    debug.idleFired += 1;
    void window.openpet.rpc('character.idleTimeout', { idleMs: Math.round(idleMs) });
  });
  const markActivity = (): void => idleWatch.activity(performance.now());
  markActivity(); // 启动基线：开机静置 90s 也算一次完整空闲期
  window.addEventListener('pointerdown', markActivity);
  setInterval(() => idleWatch.tick(performance.now()), IDLE_TICK_MS);

  // 批次④ 热切换：整页重载重走 boot（新 manifest/模型/词表）。
  window.openpet.on('character.changed', () => {
    location.reload();
  });

  // ---- behavior.* 订阅（M1 契约不变，M4 全部接到 runtime）----
  window.openpet.on('behavior.applyEmotion', ({ name, weight }) => {
    markActivity();
    if (runtime) runtime.applyEmotion(name, weight);
    else face?.apply(name);
  });

  window.openpet.on('behavior.playAction', ({ name, durationMs }) => {
    markActivity();
    if (runtime) runtime.playAction(name, durationMs);
    else face?.setAction(name, durationMs);
  });

  window.openpet.on('behavior.setIntent', ({ mood, energy }) => {
    markActivity();
    if (runtime) runtime.setIdle({ mood, energy });
    else face?.setIntent(mood, energy);
  });

  window.openpet.on('behavior.lookAt', ({ x, y }) => {
    debug.lastLookAt = { x, y };
    runtime?.setLookAt(x, y); // 不算 activity：光标常动，算了 90s 永不触发
  });

  // ---- A2 桌面气泡：流式文本逐字 + 按 pref 自动消失（character 仍只反映 chat，无业务）----
  // 线 B-1：只反映桌面会话（Main 已 tee 掉 im: 会话，此处双保险防未来新通道漏网）。
  const bubble = mountBubble(document.getElementById('bubble')!);
  window.openpet.on('chat.stream', (p) => {
    if (p.sessionId !== 'default') return;
    markActivity();
    bubble.appendStream(p.text);
  });

  // ---- 线 B-1 IM 到桌轻提示（F-IM-04：只报「谁在找」，正文/TTS 不进桌面）----
  window.openpet.on('im.activity', (p) => {
    markActivity();
    bubble.say(`💬 ${p.senderName}: ${p.text}`);
  });

  // ---- F-IT 主动台词（pet.say → 桌面气泡，不入会话流）----
  window.openpet.on('pet.say', ({ text }) => {
    markActivity();
    bubble.say(text);
  });

  // ---- F-VC 语音：TTS 音频播放 + RMS 包络驱动嘴型（声画同源，桌宠自己开口）----
  let audioCtx: AudioContext | null = null;
  let activeVoice: AudioBufferSourceNode | null = null;
  let mouthRaf = 0;
  // ⑩.6：嘴型开关/强度实时跟 prefs（推送即时生效，无需重播）
  let mouthSync = true;
  let mouthStrength = 1;

  async function playVoice(dataBase64: string, rate?: number): Promise<void> {
    audioCtx ??= new AudioContext();
    const bin = atob(dataBase64);
    const buf = new ArrayBuffer(bin.length);
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const audio = await audioCtx.decodeAudioData(buf);
    activeVoice?.stop(); // 同一时刻只播一条：解码成功才打断旧的（失败则旧的继续播完）
    const source = audioCtx.createBufferSource();
    source.buffer = audio;
    // 播放端兜底变速（引擎已服务端应用语速的广播 rate=1）；嘴型随播放速率天然同步
    source.playbackRate.value = playbackRateOf(rate);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    analyser.connect(audioCtx.destination);
    activeVoice = source;
    const samples = new Uint8Array(analyser.fftSize);
    cancelAnimationFrame(mouthRaf);
    const tick = (): void => {
      if (activeVoice !== source) return; // 已被打断/结束：新一条自起循环
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const s of samples) {
        const d = (s - 128) / 128;
        sum += d * d;
      }
      const rms = Math.sqrt(sum / samples.length);
      runtime?.setMouth(mouthSync ? mouthValue(rms, mouthStrength) : 0);
      mouthRaf = requestAnimationFrame(tick);
    };
    mouthRaf = requestAnimationFrame(tick);
    source.onended = () => {
      if (activeVoice !== source) return;
      activeVoice = null;
      cancelAnimationFrame(mouthRaf);
      runtime?.setMouth(0);
    };
    source.start();
  }

  window.openpet.on('voice.audio', ({ dataBase64, rate }) => {
    markActivity();
    playVoice(dataBase64, rate).catch((e) => {
      console.warn('[character] voice playback failed:', e);
      runtime?.setMouth(0);
    });
  });

  // bargeIn：录音端经 voice.stopPlayback 广播 → 停当前播放（onended 复位口型）
  window.openpet.on('voice.stop', () => {
    activeVoice?.stop();
  });

  // ---- A4 存在感模式：全屏检测（Main best-effort）+ 手动 DND/专注 → 淡出 / 月牙徽标 ----
  let fullscreenHidden = false;
  let dnd = false;
  let focus = false;
  const applyMode = (): void => {
    const mode = resolveMode({ fullscreenHidden, focus, dnd });
    const opacity = mode === 'hidden' ? '0' : mode === 'focus' ? '0.3' : '1';
    stageEl.style.opacity = opacity;
    fallbackEl.style.opacity = opacity;
    document.getElementById('badge')?.classList.toggle('badge-show', mode === 'dnd');
  };
  window.openpet.on('app.desktopState', (p) => {
    fullscreenHidden = (p as { fullscreen: boolean }).fullscreen;
    applyMode();
  });

  window.openpet.on('app.prefs.changed', (p) => {
    const c = p as { key?: string; value?: unknown };
    if (c.key === 'general.language') {
      if (typeof c.value === 'string') locale = c.value;
    } else if (c.key === 'display.bubbleDuration') {
      bubble.setDuration(c.value as Prefs['display.bubbleDuration']);
    } else if (c.key === 'display.clickThrough') {
      showClickThroughFx(c.value === true); // A3：穿透切换涟漪 + toast
    } else if (c.key === 'display.dndManual') {
      dnd = c.value === true;
      applyMode();
    } else if (c.key === 'display.focusMode') {
      focus = c.value === true;
      applyMode();
    } else if (c.key === 'voice.mouthSync') {
      mouthSync = c.value === true;
    } else if (c.key === 'voice.mouthStrength') {
      if (typeof c.value === 'number') mouthStrength = c.value;
    }
  });
  // 非阻塞读初值（默认 '5' 已在 mountBubble 内置，await 慢也不漏早到的 stream）。
  void window.openpet
    .rpc('app.prefs.getAll', {})
    .then((prefs) => {
      const pf = prefs as Prefs;
      bubble.setDuration(pf['display.bubbleDuration']);
      locale = String(pf['general.language'] ?? 'zh-CN');
      dnd = pf['display.dndManual'];
      focus = pf['display.focusMode'];
      mouthSync = pf['voice.mouthSync'];
      mouthStrength = pf['voice.mouthStrength'];
      applyMode();
    })
    .catch(() => {});

  // 回合结束 1.2s 后复位 neutral（S4 行为；neutral 不在情绪表 → 全零权重 = 复位）
  window.openpet.on('chat.done', (p) => {
    if (p.sessionId !== 'default') return;
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
