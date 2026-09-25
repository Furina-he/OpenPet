// Character renderer — "愚蠢的播放器"：只订阅 behavior.* 并反映之，无业务状态。
// M4：模型经 character.current → asset://（不再走 vite public 路径）；
// VRM 不可用（manifest 失败/模型缺失/加载失败）→ DOM 情绪脸，行为契约不变。
import { createVrmRuntime, type CharacterRuntime } from './runtime';
import { mountFallbackFace, type FallbackFace } from './fallback-face';
import { setupInteraction, type InteractionHandle } from './interaction';
import { windowContour, type ContentBox } from './interaction-zones';
import { mountBubble, type Bubble } from './bubble';
import { resolveMode } from './desktop-state';
import { IdleWatch, IDLE_TIMEOUT_MS } from './idle-watch';
import { mouthValue, playbackRateOf } from './mouth-drive';
import {
  HUD_HOLD_MS,
  WHEEL_SETTLE_MS,
  WheelScaler,
  scaleLabel,
  stepScale,
} from './scale-wheel';
import { moodCurrent, type CharacterLayout, type Prefs } from '@openpet/protocol';
import '../theme/tokens.css';
import { subscribeTheme } from '../theme/subscribe';
import { charStrings } from './strings';
import { CUBISM_CORE_CANDIDATES, cubismCoreMissingMessage } from './cubism-core-chain';

// 跨 renderer 即时换肤：character 也订阅 app.prefs.changed（tokens.css 保持 body 透明）。
subscribeTheme();

const FPS_REPORT_MS = 10_000;
const IDLE_TICK_MS = 5_000;
/** ⑱ 心情半衰在渲染端 lazy 重算的节拍（2h 半衰，30s 一算足够平滑）。 */
const MOOD_TICK_MS = 30_000;

declare global {
  interface Window {
    /** debug 表面（e2e / 手测用），不属于 openpet 协议。 */
    __charDebug?: {
      mode: 'vrm' | 'live2d' | 'sprite' | 'fallback';
      fps: () => number;
      budget: () => unknown;
      lastLookAt: { x: number; y: number } | null;
      idleFired: number;
    };
  }
}

/** Cubism Core 动态注入（只注一次）；三级链全失败 → throw，由 boot 的 catch 落 fallback 脸。 */
let cubismCoreLoading: Promise<void> | null = null;
function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    // 一级相对路径：dev(http://…/character/) 与生产(file://…/renderer/character/) 都指到
    // publicDir 拷贝目标（renderer 根）；根绝对路径在 file:// 下会指向盘符根，不可用。
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => {
      s.remove();
      reject(new Error(`script load failed: ${src}`));
    };
    document.head.appendChild(s);
  });
}
function ensureCubismCore(): Promise<void> {
  if ((window as { Live2DCubismCore?: unknown }).Live2DCubismCore) return Promise.resolve();
  cubismCoreLoading ??= (async () => {
    for (const src of CUBISM_CORE_CANDIDATES) {
      try {
        await loadScript(src);
      } catch {
        continue; // 下一级候选（public → resources/cubism → userData/cubism）
      }
      if ((window as { Live2DCubismCore?: unknown }).Live2DCubismCore) return;
    }
    throw new Error(cubismCoreMissingMessage());
  })();
  return cubismCoreLoading;
}

let bootedEngine: 'vrm' | 'live2d' | 'sprite' = 'vrm';

async function bootRuntime(stageEl: HTMLElement): Promise<CharacterRuntime> {
  const cur = await window.openpet.rpc('character.current', {});
  const modelUrl = `asset://${cur.characterId}/${cur.manifest.model}`;
  if (cur.manifest.engine === 'live2d') {
    bootedEngine = 'live2d';
    await ensureCubismCore();
    const { createLive2dRuntime } = await import('./live2d-runtime'); // 动态 import：VRM 用户不载 pixi
    return createLive2dRuntime(stageEl, modelUrl, cur.manifest);
  }
  if (cur.manifest.engine === 'sprite') {
    bootedEngine = 'sprite';
    const { createSpriteRuntime } = await import('./sprite-runtime'); // ⑳ 同样动态 import
    return createSpriteRuntime(stageEl, modelUrl, cur.manifest);
  }
  bootedEngine = 'vrm';
  // ⑱ T9：assetBase 供 manifest.actionClips（.vrma）解析成 asset:// URL
  return createVrmRuntime(stageEl, modelUrl, cur.manifest, {
    assetBase: `asset://${cur.characterId}/`,
  });
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
  const modelBoxEl = document.getElementById('model-box')!;

  let runtime: CharacterRuntime | null = null;
  let face: FallbackFace | null = null;
  let interaction: InteractionHandle | null = null;
  let bubble: Bubble | null = null;

  // ---- ㉓ 几何：模型框 + 舞台边（Main character-stage 真源）----
  let layout: CharacterLayout | null = null;
  let pendingLayout: CharacterLayout | null = null;
  let pendingTimer = 0;
  const commitLayout = (l: CharacterLayout): void => {
    pendingLayout = null;
    clearTimeout(pendingTimer);
    layout = l;
    Object.assign(modelBoxEl.style, {
      left: `${l.model.x}px`,
      top: `${l.model.y}px`,
      width: `${l.model.width}px`,
      height: `${l.model.height}px`,
    });
    bubble?.relayout();
    interaction?.recheck(); // §R：几何变了立即重判穿透（窗口原点动了、光标没动就没有 mousemove）
  };
  const viewportMatches = (l: CharacterLayout): boolean =>
    Math.abs(window.innerWidth - l.window.width) <= 1 &&
    Math.abs(window.innerHeight - l.window.height) <= 1;
  let layoutFromEvent = false;
  window.openpet.on('character.layoutChanged', (l) => {
    layoutFromEvent = true;
    // 窗口尺寸也变了：等视口真变过来再摆模型框（否则模型框先缩、窗口后动，中间闪一帧错位）；150ms 兜底
    if (viewportMatches(l)) {
      commitLayout(l);
      return;
    }
    pendingLayout = l;
    clearTimeout(pendingTimer);
    pendingTimer = window.setTimeout(() => {
      if (pendingLayout) commitLayout(pendingLayout);
    }, 150);
  });
  window.addEventListener('resize', () => {
    if (pendingLayout && viewportMatches(pendingLayout)) commitLayout(pendingLayout);
  });
  // 先摆好模型框、再建 runtime：runtime 构造时读容器尺寸，顺序反了会先按整窗兜底再跳一下
  try {
    const initial = await window.openpet.rpc('character.layout', {});
    if (!layoutFromEvent) commitLayout(initial);
  } catch (e) {
    console.warn('[character] layout unavailable, model box = whole window:', e);
  }

  // 轮廓（窗口坐标）：精灵可见轮廓 + 模型框偏移 ?? 模型框——分区与气泡共用
  const contour = (): ContentBox =>
    windowContour(
      layout?.model ?? { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight },
      runtime?.contentBox?.() ?? null,
    );
  // ⑱ dev harness：`?harness=life`（Main 经 OPENPET_HARNESS=life 追加）。面板是 DOM，
  // alpha 穿透会把面板区域判成透明 → 跳过穿透只留拖拽。
  const harness = new URLSearchParams(location.search).get('harness');
  try {
    runtime = await bootRuntime(stageEl);
    interaction = setupInteraction(harness ? null : runtime.hitSurface, contour);
    if (harness === 'life') {
      const rt = runtime;
      const { mountLifeHarness } = await import('../dev/life-harness');
      mountLifeHarness(document.body, rt, {
        simulateStream: () => {
          rt.setStreaming(true);
          rt.applyEmotion('happy', 0.8);
          const kinds = ['exclaim', 'question', 'period'] as const;
          kinds.forEach((k, i) => setTimeout(() => rt.playBeat(k), 400 + i * 1800));
          setTimeout(() => {
            rt.setStreaming(false);
            rt.releaseEmotion();
          }, 6000);
        },
        loadClip: rt.loadActionClip
          ? (name, file) => rt.loadActionClip!(name, URL.createObjectURL(file))
          : undefined,
        loadSheet: rt.loadSheet
          ? (file, sprite) => rt.loadSheet!(URL.createObjectURL(file), sprite)
          : undefined,
      });
    }
  } catch (e) {
    console.warn('[character] runtime unavailable, using fallback face:', e);
    fallbackEl.style.display = 'flex';
    face = mountFallbackFace(fallbackEl);
    interaction = setupInteraction(null, contour); // DOM 无 alpha buffer：只拖拽，不穿透
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

  // ⑱ 节拍手势：Main 每发一段来一拍；渲染端按 pet.beatGestures 门 + runtime 内部门（无活动作/≥1.5s）。
  let beatGestures = true;
  // 桌面会话 = 非 IM（会话管理批次起 id 不再固定为 'default'；按 'default' 判会漏掉新建会话 → 表情永不复位）。
  const isDesktopSession = (id: string): boolean => !id.startsWith('im:');
  window.openpet.on('behavior.beat', ({ sessionId, kind }) => {
    if (!isDesktopSession(sessionId) || !beatGestures) return;
    runtime?.playBeat(kind);
  });

  window.openpet.on('behavior.lookAt', ({ x, y }) => {
    debug.lastLookAt = { x, y };
    interaction?.noteCursor(x, y); // ㉓ 命中重判用最新光标（光标静止时没有 mousemove）
    runtime?.setLookAt(x, y); // 不算 activity：光标常动，算了 90s 永不触发
  });

  // ---- A2 桌面气泡：流式文本逐字 + 按 pref 自动消失（character 仍只反映 chat，无业务）----
  // 线 B-1：只反映桌面会话（Main 已 tee 掉 im: 会话，此处双保险防未来新通道漏网）。
  const bubbleView = mountBubble(
    document.getElementById('bubble')!,
    contour,
    () => layout?.screen.workArea ?? null,
  );
  bubble = bubbleView;
  window.openpet.on('chat.stream', (p) => {
    if (!isDesktopSession(p.sessionId)) return;
    markActivity();
    runtime?.setStreaming(true); // ⑱ 说话中：呼吸收窄 + 视线看用户（chat.done 复位）
    bubbleView.appendStream(p.text);
  });

  // ---- 线 B-1 IM 到桌轻提示（F-IM-04：只报「谁在找」，正文/TTS 不进桌面）----
  window.openpet.on('im.activity', (p) => {
    markActivity();
    bubbleView.say(`💬 ${p.senderName}: ${p.text}`);
  });

  // ---- F-IT 主动台词（pet.say → 桌面气泡，不入会话流）----
  window.openpet.on('pet.say', ({ text }) => {
    markActivity();
    bubbleView.say(text);
  });

  // ---- ㉓ Ctrl+滚轮缩放（光标在角色不透明处；透明处的滚轮本就随穿透落到下层窗口）----
  // 精密触控板双指捏合同样产生 ctrl+wheel。手势期间冻结穿透（缩小后光标可能落到透明像素上，
  // 切成穿透会让后续滚轮漏给下层窗口），停手 500ms 持久化并解冻重判。
  const scaleHud = document.getElementById('scale-hud')!;
  let hudTimer = 0;
  const showScaleHud = (s: number): void => {
    scaleHud.textContent = scaleLabel(s, layout?.pixelSnap ?? false, layout?.dpr ?? 1);
    scaleHud.classList.add('scale-hud-show');
    clearTimeout(hudTimer);
    hudTimer = window.setTimeout(() => scaleHud.classList.remove('scale-hud-show'), HUD_HOLD_MS);
  };
  const wheelScaler = new WheelScaler();
  let gesture: { start: number; target: number } | null = null;
  let gestureTimer = 0;
  // 预览合批：上一次 setScale 未返回时只记最新目标（不排队）
  let previewInFlight = false;
  let previewQueued: number | null = null;
  const previewScale = (s: number): void => {
    if (previewInFlight) {
      previewQueued = s;
      return;
    }
    previewInFlight = true;
    window.openpet
      .rpc('character.setScale', { scale: s })
      .catch(() => {})
      .finally(() => {
        previewInFlight = false;
        const next = previewQueued;
        previewQueued = null;
        if (next !== null) previewScale(next);
      });
  };
  const endScaleGesture = (): void => {
    const g = gesture;
    gesture = null;
    wheelScaler.reset();
    if (g && g.target !== g.start) {
      previewQueued = null; // 持久化调用本身带着最终目标
      void window.openpet.rpc('character.setScale', { scale: g.target, persist: true });
    }
    interaction?.freezeWheel(false);
  };
  window.addEventListener(
    'wheel',
    (e: WheelEvent) => {
      if (!e.ctrlKey) return; // 普通滚轮不缩放（防误触）
      e.preventDefault(); // 独占（Electron 默认只发 zoom-changed，不改页面缩放）
      if (!layout || interaction?.dragging()) return; // 拖拽中忽略
      interaction?.noteCursor(e.screenX, e.screenY);
      if (!gesture) {
        gesture = { start: layout.scale, target: layout.scale };
        interaction?.freezeWheel(true);
      }
      const steps = wheelScaler.feed(e.deltaY, e.deltaMode);
      if (steps !== 0) {
        const next = stepScale(gesture.target, steps, layout);
        if (next !== gesture.target) {
          gesture.target = next;
          previewScale(next);
        }
        showScaleHud(gesture.target); // 到头了也给反馈
      }
      clearTimeout(gestureTimer);
      gestureTimer = window.setTimeout(endScaleGesture, WHEEL_SETTLE_MS);
    },
    { passive: false },
  );

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

  // ---- ⑱ 心情 → 渲染端（表情基线/呼吸/姿态）：pet.mood 经 app.prefs.changed 推送 + 本地半衰重算 ----
  let moodPref = { value: 0, updatedAt: 0 };
  const lookAtPrefs = { enabled: true, strength: 50 };
  const pushMood = (): void => {
    runtime?.setMood(moodCurrent(moodPref.value, moodPref.updatedAt, Date.now()));
  };
  setInterval(pushMood, MOOD_TICK_MS);

  window.openpet.on('app.prefs.changed', (p) => {
    const c = p as { key?: string; value?: unknown };
    if (c.key === 'pet.mood') {
      const v = c.value as { value?: unknown; updatedAt?: unknown } | undefined;
      if (v && typeof v.value === 'number' && typeof v.updatedAt === 'number') {
        moodPref = { value: v.value, updatedAt: v.updatedAt };
        pushMood();
      }
    } else if (c.key === 'pet.lifeLayers') {
      runtime?.setLifeLayers(c.value !== false);
    } else if (c.key === 'pet.beatGestures') {
      beatGestures = c.value !== false;
    } else if (c.key === 'display.lookAt' || c.key === 'display.lookAtStrength') {
      // ⑱ 偿"存而不接"债：两键任一变更即整体重推
      if (c.key === 'display.lookAt') lookAtPrefs.enabled = c.value !== false;
      else if (typeof c.value === 'number') lookAtPrefs.strength = c.value;
      runtime?.setLookAtPrefs(lookAtPrefs.enabled, lookAtPrefs.strength);
    } else if (c.key === 'general.language') {
      if (typeof c.value === 'string') locale = c.value;
    } else if (c.key === 'display.bubbleDuration') {
      bubbleView.setDuration(c.value as Prefs['display.bubbleDuration']);
    } else if (c.key === 'display.clickThrough') {
      showClickThroughFx(c.value === true); // A3：穿透切换涟漪 + toast
      interaction?.setLocked(c.value === true); // ㉓ 整窗穿透期间逐像素逻辑不改窗口；关掉后重判
    } else if (c.key === 'display.dndManual') {
      dnd = c.value === true;
      applyMode();
    } else if (c.key === 'display.focusMode') {
      focus = c.value === true;
      applyMode();
    } else if (c.key === 'voice.autoSpeak') {
      runtime?.setAutoSpeak(c.value === true);
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
      bubbleView.setDuration(pf['display.bubbleDuration']);
      interaction?.setLocked(pf['display.clickThrough']);
      locale = String(pf['general.language'] ?? 'zh-CN');
      dnd = pf['display.dndManual'];
      focus = pf['display.focusMode'];
      mouthSync = pf['voice.mouthSync'];
      mouthStrength = pf['voice.mouthStrength'];
      moodPref = pf['pet.mood'];
      runtime?.setLifeLayers(pf['pet.lifeLayers']);
      beatGestures = pf['pet.beatGestures'];
      lookAtPrefs.enabled = pf['display.lookAt'];
      lookAtPrefs.strength = pf['display.lookAtStrength'];
      runtime?.setLookAtPrefs(lookAtPrefs.enabled, lookAtPrefs.strength);
      runtime?.setAutoSpeak(pf['voice.autoSpeak']);
      pushMood();
      applyMode();
    })
    .catch(() => {});

  // 回合结束 1.2s 后情绪退到心情基线（⑱ releaseEmotion 取代硬复位 neutral；fallback 脸仍 reset）
  window.openpet.on('chat.done', (p) => {
    if (!isDesktopSession(p.sessionId)) return;
    markActivity();
    bubbleView.endStream();
    runtime?.setStreaming(false);
    setTimeout(() => {
      if (runtime) runtime.releaseEmotion();
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
