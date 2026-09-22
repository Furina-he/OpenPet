/**
 * ⑱ 视线状态机（spec §2.3）——眼睛从"追鼠标、鼠标不动即定住"改为五态：
 *   track（鼠标 3s 内动过且在角色窗 ±R 内）/ wander（其余空闲：随机扫视 + 保持 + 微抖）/
 *   thinking（thinking 情绪：左上保持偶发下瞥）/ speaking（chat.stream 活跃：看用户，15% 瞥开）/
 *   sleepy（向下 + 眼睑地板）。优先级 sleepy > speaking > thinking > track > wander。
 * 输出归一化注视点（±1 ≈ 窗口边缘），runtime 再做阻尼 + 世界坐标。纯逻辑，now/rand 注入。
 * 接通 prefs：display.lookAt=false → 无 track 只留 wander；display.lookAtStrength → 幅度 0.3–1.2。
 */
import { normalizedFromScreen, type Normalized } from './lookat';

export type GazeState = 'track' | 'wander' | 'thinking' | 'speaking' | 'sleepy';

export const GAZE: {
  trackIdleMs: number;
  trackRadiusFactor: number;
  saccadeMs: number;
  wanderRange: number;
  wanderHoldMinMs: number;
  wanderHoldMaxMs: number;
  wanderJitter: number;
  readonly thinking: { nx: number; ny: number };
  readonly thinkingGlanceDown: { nx: number; ny: number };
  speakingGlanceRatio: number;
  speakingGlanceMs: number;
  readonly sleepy: { nx: number; ny: number };
  sleepyEyelidFloor: number;
} = {
  /** 鼠标静止超过此时长 → 离开 track。 */
  trackIdleMs: 3000,
  /** track 半径 = 窗宽 × 此倍数。 */
  trackRadiusFactor: 1.5,
  /** 扫视跳变时长。 */
  saccadeMs: 80,
  wanderRange: 0.3,
  wanderHoldMinMs: 1000,
  wanderHoldMaxMs: 4000,
  wanderJitter: 0.02,
  thinking: { nx: -0.25, ny: 0.2 },
  thinkingGlanceDown: { nx: -0.1, ny: -0.15 },
  speakingGlanceRatio: 0.15,
  speakingGlanceMs: 600,
  sleepy: { nx: 0, ny: -0.2 },
  sleepyEyelidFloor: 0.4,
};

/** display.lookAtStrength 0–100 → 幅度 0.3–1.2。 */
export function strengthFromPref(v: number): number {
  const k = Math.max(0, Math.min(100, v)) / 100;
  return 0.3 + k * 0.9;
}

export interface GazeTarget extends Normalized {
  /** 本帧处于扫视跳变期（runtime 用更紧的阻尼；blink 30% 伴随）。 */
  saccade: boolean;
}

export type GazeNudge = 'down' | 'user' | 'scanLR' | 'suppressWander';

interface WindowRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class GazeMachine {
  private readonly rand: () => number;
  private lookAtEnabled = true;
  private strength = 1;
  // cursor
  private cursorN: Normalized = { nx: 0, ny: 0 };
  private cursorMovedAt = -Infinity;
  private cursorInRadius = false;
  private lastCursor: { x: number; y: number } | null = null;
  // signals
  private emotion = 'neutral';
  private streaming = false;
  // wander
  private wanderTarget: Normalized = { nx: 0, ny: 0 };
  private wanderNextAt: number;
  private saccadeAt = -Infinity;
  private wanderSuppressedUntil = -Infinity;
  // thinking glance
  private glanceNextAt: number;
  private glanceUntil = -Infinity;
  // speaking glance-away
  private speakGlanceUntil = -Infinity;
  private speakGlanceTarget: Normalized = { nx: 0, ny: 0 };
  private speakNextCheckAt = -Infinity;
  // nudges（动作协同）
  private nudgeUntil = -Infinity;
  private nudgeKind: GazeNudge | null = null;
  private nudgeStart = -Infinity;
  private lastState: GazeState = 'wander';
  /** 上次 target() 调用产出的 saccade 起点（供伴随眨眼查询）。 */
  private saccadeCount = 0;

  constructor(now: number, rand: () => number = Math.random) {
    this.rand = rand;
    this.wanderNextAt = now; // 首次进入 wander 立即选目标
    this.glanceNextAt = now + 3000 + this.rand() * 3000;
  }

  private hold(): number {
    return GAZE.wanderHoldMinMs + this.rand() * (GAZE.wanderHoldMaxMs - GAZE.wanderHoldMinMs);
  }

  setLookAtPrefs(enabled: boolean, strengthPref: number): void {
    this.lookAtEnabled = enabled;
    this.strength = strengthFromPref(strengthPref);
  }

  /** Main 30Hz 光标坐标（DIP）。 */
  cursor(x: number, y: number, now: number, win: WindowRect): void {
    if (!this.lastCursor || this.lastCursor.x !== x || this.lastCursor.y !== y) {
      this.cursorMovedAt = now;
    }
    this.lastCursor = { x, y };
    this.cursorN = normalizedFromScreen(x, y, win);
    const cx = win.x + win.width / 2;
    const cy = win.y + win.height / 2;
    const r = win.width * GAZE.trackRadiusFactor;
    this.cursorInRadius = Math.hypot(x - cx, y - cy) <= r;
  }

  /** 与鼠标的距离（px，最近一次 cursor 调用）；无光标数据 = Infinity。 */
  cursorDistance(win: WindowRect): number {
    if (!this.lastCursor) return Infinity;
    return Math.hypot(this.lastCursor.x - (win.x + win.width / 2), this.lastCursor.y - (win.y + win.height / 2));
  }

  /** 最近光标归一化横坐标（靠近朝向用）。 */
  cursorNx(): number {
    return this.cursorN.nx;
  }

  emotionChanged(name: string): void {
    this.emotion = name;
  }

  streamActive(active: boolean): void {
    this.streaming = active;
  }

  /** 动作协同（spec §2.5）：nod 压视线 / wave 看用户 / searching 左右扫 / tilt 抑制 wander 2s。 */
  nudge(kind: GazeNudge, now: number, durMs: number): void {
    if (kind === 'suppressWander') {
      this.wanderSuppressedUntil = now + durMs;
      return;
    }
    this.nudgeKind = kind;
    this.nudgeStart = now;
    this.nudgeUntil = now + durMs;
  }

  state(now: number): GazeState {
    if (this.emotion === 'sleepy') return 'sleepy';
    if (this.streaming) return 'speaking';
    if (this.emotion === 'thinking') return 'thinking';
    if (this.lookAtEnabled && this.cursorInRadius && now - this.cursorMovedAt <= GAZE.trackIdleMs) {
      return 'track';
    }
    return 'wander';
  }

  /** sleepy 眼睑地板（blink 权重下限）；其余 0。 */
  eyelidFloor(now: number): number {
    return this.state(now) === 'sleepy' ? GAZE.sleepyEyelidFloor : 0;
  }

  /** 自上次调用以来是否发生过扫视跳变（blink 伴随用；读后清零）。 */
  takeSaccades(): number {
    const n = this.saccadeCount;
    this.saccadeCount = 0;
    return n;
  }

  target(now: number): GazeTarget {
    const st = this.state(now);
    if (st !== this.lastState) {
      // 进入 wander 立即选一个新目标（不等旧保持期）
      if (st === 'wander') this.wanderNextAt = now;
      this.lastState = st;
    }
    let base: Normalized;
    switch (st) {
      case 'sleepy':
        base = { ...GAZE.sleepy };
        break;
      case 'speaking':
        base = this.speakingTarget(now);
        break;
      case 'thinking':
        base = this.thinkingTarget(now);
        break;
      case 'track':
        base = this.cursorN;
        break;
      default:
        base = this.wanderTarget_(now);
    }
    // 协同 nudge 覆盖（点头压视线 / 看用户 / 左右扫）
    if (this.nudgeKind && now < this.nudgeUntil) {
      base = this.applyNudge(base, now);
    } else {
      this.nudgeKind = null;
    }
    const saccade = now - this.saccadeAt < GAZE.saccadeMs;
    return { nx: base.nx * this.strength, ny: base.ny * this.strength, saccade };
  }

  private applyNudge(base: Normalized, now: number): Normalized {
    const t = (now - this.nudgeStart) / Math.max(1, this.nudgeUntil - this.nudgeStart);
    switch (this.nudgeKind) {
      case 'down':
        return { nx: base.nx * 0.5, ny: base.ny * 0.5 - 0.25 * Math.sin(Math.PI * t) };
      case 'user':
        return { nx: 0, ny: 0 };
      case 'scanLR':
        return { nx: 0.35 * Math.sin(2 * Math.PI * t), ny: base.ny * 0.5 };
      default:
        return base;
    }
  }

  private wanderTarget_(now: number): Normalized {
    if (now >= this.wanderNextAt && now >= this.wanderSuppressedUntil) {
      this.wanderTarget = {
        nx: (this.rand() * 2 - 1) * GAZE.wanderRange,
        ny: (this.rand() * 2 - 1) * GAZE.wanderRange,
      };
      this.saccadeAt = now;
      this.saccadeCount += 1;
      this.wanderNextAt = now + this.hold();
    }
    // 保持期微抖 ±0.02（两个互质频率）
    const j = GAZE.wanderJitter;
    return {
      nx: this.wanderTarget.nx + j * Math.sin(now / 530),
      ny: this.wanderTarget.ny + j * Math.sin(now / 770 + 1.3),
    };
  }

  private thinkingTarget(now: number): Normalized {
    if (now >= this.glanceNextAt) {
      this.glanceUntil = now + 500;
      this.glanceNextAt = now + 3000 + this.rand() * 3000;
      this.saccadeAt = now;
      this.saccadeCount += 1;
    }
    return now < this.glanceUntil ? { ...GAZE.thinkingGlanceDown } : { ...GAZE.thinking };
  }

  private speakingTarget(now: number): Normalized {
    if (now < this.speakGlanceUntil) return this.speakGlanceTarget;
    if (now >= this.speakNextCheckAt) {
      // 每 ~1s 掷一次：15% 时间瞥开 0.6s（按占空比折算概率）
      this.speakNextCheckAt = now + 1000;
      const p = GAZE.speakingGlanceRatio * (1000 / GAZE.speakingGlanceMs);
      if (this.rand() < p) {
        this.speakGlanceUntil = now + GAZE.speakingGlanceMs;
        this.speakGlanceTarget = {
          nx: (this.rand() * 2 - 1) * 0.35,
          ny: (this.rand() * 2 - 1) * 0.15,
        };
        this.saccadeAt = now;
        this.saccadeCount += 1;
        return this.speakGlanceTarget;
      }
    }
    return { nx: 0, ny: 0 }; // 看"用户"：屏幕中心/相机方向
  }
}
