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
  playAction(name: string, durMs?: number | null): void;
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
