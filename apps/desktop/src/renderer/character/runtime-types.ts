/** 引擎中立的运行时契约（tech-design §7）：VRM(three) / Live2D(pixi) / ⑳ sprite(pixi) 各自实现。 */
import type { SpriteSheet } from '@openpet/protocol';
import type { SceneBudget } from './perf-budget';

/** alpha 命中穿透所需的最小渲染面（interaction.ts readPixels 用）。 */
export interface HitSurface {
  canvas: HTMLCanvasElement;
  gl: WebGLRenderingContext | WebGL2RenderingContext;
  pixelRatio: number;
}

export interface CharacterRuntime {
  /** null = 无 alpha buffer（如 DOM fallback），interaction 只拖拽不穿透。 */
  readonly hitSurface: HitSurface | null;
  applyEmotion(name: string, weight?: number): void;
  /** ⑱ 情绪退到心情基线（取代硬复位 neutral）；Live2D = 回默认脸。 */
  releaseEmotion(): void;
  /** ⑱ 心情 [-1,1] → 表情基线 / 呼吸 / 姿态；Live2D 表情层 no-op（spec §5）。 */
  setMood(mood: number): void;
  /** ⑱ 总闸 pet.lifeLayers：false = 底噪/姿态/视线状态机/节拍全关（回本批前表现）。 */
  setLifeLayers(enabled: boolean): void;
  /** ⑱ chat.stream 活跃（说话中）：呼吸幅度 ×0.6、视线切 speaking。 */
  setStreaming(active: boolean): void;
  /** ⑱ 接通 display.lookAt / display.lookAtStrength（false = 不追鼠标只游移；0–100 → 幅度 0.3–1.2）。 */
  setLookAtPrefs(enabled: boolean, strength: number): void;
  playAction(name: string, durMs?: number | null): void;
  /** ⑱ 节拍手势（behavior.beat）：门内才播，返回是否播放；Live2D 映射 live2dMotions.nod/tilt。 */
  playBeat(kind: 'question' | 'exclaim' | 'period'): boolean;
  /** ⑱ voice.autoSpeak 开着 → idle 池排除 hum（不与 TTS 抢嘴）。 */
  setAutoSpeak(on: boolean): void;
  /** 屏幕坐标（DIP；Main 的 behavior.lookAt 直传）。 */
  setLookAt(x: number, y: number): void;
  /** F-VC 嘴型：RMS 包络 0–1 → 引擎各自的张嘴通道。 */
  setMouth(v: number): void;
  /** V1+ 语音嘴型；接口占位。 */
  setLipsync(visemes: unknown | null): void;
  setIdle(intent: { mood: string; energy: string }): void;
  /** ⑱ T9（VRM 专有，可选）：把 url 指向的 .vrma 装为某动作的片段；失败回 false（曲线兜底）。 */
  loadActionClip?: ((name: string, url: string) => Promise<boolean>) | undefined;
  /**
   * ⑳（可选，sprite 实现）：角色可见轮廓在窗口内的上下沿（CSS px）——命中分区与气泡贴轮廓用。
   * VRM / Live2D 不实现 = 按整窗口口径（行为不变）。
   */
  contentBox?: (() => { top: number; bottom: number } | null) | undefined;
  /** ⑳（可选，仅 harness）：热换图集（可同时换布局描述）；失败抛出，旧图集保持。 */
  loadSheet?: ((url: string, sprite?: SpriteSheet) => Promise<void>) | undefined;
  /** ⑳（可选，仅 harness）：点播某帧状态一轮；返回状态名列表的 listStates 同理。 */
  playState?: ((state: string) => boolean) | undefined;
  listStates?: (() => string[]) | undefined;
  listEmotions(): string[];
  listActions(): string[];
  getStats(): { fps: number; budget: SceneBudget; budgetWarnings: string[] };
  dispose(): void;
}
