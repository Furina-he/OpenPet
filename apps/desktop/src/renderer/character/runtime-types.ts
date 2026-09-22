/** 引擎中立的运行时契约（tech-design §7）：VRM(three) 与 Live2D(pixi) 各自实现。 */
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
  listEmotions(): string[];
  listActions(): string[];
  getStats(): { fps: number; budget: SceneBudget; budgetWarnings: string[] };
  dispose(): void;
}
