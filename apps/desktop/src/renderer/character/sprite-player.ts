/**
 * ⑳ 帧通道纯逻辑（spec §2.1）——`SpritePlayer` 按逐帧时长 × speed 推进一个状态行；
 * `SpriteDirector` 按五级优先级裁决「此刻播哪一行」：拖拽 > 一次性行 > 情绪持续行 > 说话 > 空闲。
 * 无 DOM、无 pixi：sprite-runtime 每帧 `tick(now)` 取 {state, frame} 换纹理即可。
 */
import type { ResolvedEmotionMap, ResolvedSprite } from '@openpet/protocol';
import { ACTION_DEFAULT_MS } from './actions';
import type { Energy } from './life-layers';

/** 播放模式：loop = 无限循环；once = 播一轮停在末帧；forMs = 循环到累计时长（loop 行被动作借用）。 */
export type PlayMode = { kind: 'loop' } | { kind: 'once' } | { kind: 'forMs'; ms: number };

/** 纯函数：累计播放时间 t（ms）落在第几帧；once 模式超出总长停在末帧。 */
export function frameAt(durations: readonly number[], t: number, loop: boolean): number {
  const n = durations.length;
  if (n <= 1) return 0;
  const total = durations.reduce((s, d) => s + d, 0);
  if (total <= 0) return 0;
  if (!loop && t >= total) return n - 1;
  let tt = ((t % total) + total) % total;
  for (let i = 0; i < n; i++) {
    tt -= durations[i]!;
    if (tt < 0) return i;
  }
  return n - 1;
}

export class SpritePlayer {
  state = '';
  speed = 1;
  private durations: readonly number[] = [100];
  private total = 100;
  private mode: PlayMode = { kind: 'loop' };
  private t = 0;
  private last = 0;

  /** 从第 0 帧开始播放某状态（重置累计时间）。 */
  play(state: string, durations: readonly number[], mode: PlayMode, now: number, speed = 1): void {
    this.state = state;
    this.durations = durations.length > 0 ? durations : [100];
    this.total = this.durations.reduce((s, d) => s + d, 0);
    this.mode = mode;
    this.speed = speed;
    this.t = 0;
    this.last = now;
  }

  /** 推进到 now：返回当前帧；once 播完一轮 / forMs 到点 → finished。speed 变化不跳相（累计时间）。 */
  tick(now: number): { frame: number; finished: boolean } {
    const dt = Math.max(0, Math.min(200, now - this.last)); // 后台节流恢复时防大步长
    this.last = now;
    this.t += dt * this.speed;
    const m = this.mode;
    if (m.kind === 'once') {
      return { frame: frameAt(this.durations, this.t, false), finished: this.t >= this.total };
    }
    return {
      frame: frameAt(this.durations, this.t, true),
      finished: m.kind === 'forMs' && this.t >= m.ms,
    };
  }

  /** 当前累计播放时间（测试 / harness 用）。 */
  elapsed(): number {
    return this.t;
  }
}

// ---- 裁决 ----

/** 拖拽行门槛（px/ms）与低于门槛的回落保持时长。 */
export const SPRITE_DRAG = { vxMin: 0.05, holdMs: 300 };
/** 情绪权重低于此值不换行（只走程序化姿态：`<emo:happy w=0.3/>` = 含蓄）。 */
export const SPRITE_EMOTION_MIN_WEIGHT = 0.35;
/** 说话行速度 = 基础 + 嘴型值；嘴型高于此值视为「在说话」。 */
export const SPRITE_TALK = { baseSpeed: 0.6, mouthActive: 0.02 };
/** 无 idleLow / idleHigh 槽位时 idle 行按 energy 调速。 */
export const SPRITE_IDLE_SPEED: Record<Energy, number> = { low: 0.8, mid: 1, high: 1.2 };

export type SpriteLevel = 'drag' | 'oneShot' | 'emotion' | 'talk' | 'idle';

export interface DirectorStates {
  [state: string]: { durationsMs: readonly number[]; loop: boolean };
}

export interface DirectorConfig {
  /** 帧已切好的状态（越界帧已丢弃；0 帧的状态视为不存在）。 */
  states: DirectorStates;
  emotions: Record<string, ResolvedEmotionMap>;
  actions: Record<string, string>;
  slots: ResolvedSprite['slots'];
}

export type ActionRoute = { kind: 'row'; state: string } | { kind: 'procedural' };

export interface DirectorFrame {
  state: string;
  frame: number;
  level: SpriteLevel;
}

interface OneShot {
  state: string;
  mode: PlayMode;
  speed: number;
}

export class SpriteDirector {
  private readonly player = new SpritePlayer();
  private oneShot: OneShot | null = null;
  /** 一次性行刚被设置、尚未交给 player（强制从第 0 帧起播）。 */
  private oneShotPending = false;
  private emotionLoop: { state: string; speed: number } | null = null;
  private talking = false;
  private mouth = 0;
  private energy: Energy = 'mid';
  private drag: { state: string; lowSince: number | null } | null = null;
  private level: SpriteLevel = 'idle';

  constructor(
    private readonly cfg: DirectorConfig,
    now: number,
  ) {
    const idle = cfg.slots.idle;
    if (!this.has(idle)) throw new Error(`sprite idle 状态「${idle}」没有可用帧`);
    this.player.play(idle, this.durations(idle), { kind: 'loop' }, now);
  }

  private has(state: string | undefined): state is string {
    return state !== undefined && (this.cfg.states[state]?.durationsMs.length ?? 0) > 0;
  }

  private durations(state: string): readonly number[] {
    return this.cfg.states[state]?.durationsMs ?? [100];
  }

  /** 动作 → 行（映射且有帧）或程序化曲线。 */
  routeAction(name: string): ActionRoute {
    const state = this.cfg.actions[name];
    return this.has(state) ? { kind: 'row', state } : { kind: 'procedural' };
  }

  /** 映射到行的动作：loop=false 播一轮；loop=true 按动作时长循环。新动作打断旧一次性行。 */
  playAction(name: string, durMs: number | null | undefined, now: number): ActionRoute {
    const route = this.routeAction(name);
    if (route.kind !== 'row') return route;
    this.playState(route.state, durMs ?? (ACTION_DEFAULT_MS as Record<string, number>)[name], now);
    return route;
  }

  /** 直接播某状态一次（一次性行一轮；循环行按 durMs，缺省两轮）——动作映射与 harness 点播共用。 */
  playState(state: string, durMs: number | null | undefined, _now: number): boolean {
    if (!this.has(state)) return false;
    const st = this.cfg.states[state]!;
    const total = st.durationsMs.reduce((s, d) => s + d, 0);
    const mode: PlayMode = !st.loop ? { kind: 'once' } : { kind: 'forMs', ms: durMs ?? total * 2 };
    this.oneShot = { state, mode, speed: 1 };
    this.oneShotPending = true;
    return true;
  }

  /**
   * 情绪：weight < 0.35 / 未映射 → 清掉持续行（新情绪取代旧情绪，只走程序化）；
   * enter 先播一轮（一次性行进行中则丢弃）；loop 持续到 release。
   */
  applyEmotion(name: string, weight: number, _now: number): void {
    const map = this.cfg.emotions[name];
    if (name === 'neutral' || weight <= 0 || !map || weight < SPRITE_EMOTION_MIN_WEIGHT) {
      this.emotionLoop = null;
      return;
    }
    if (this.has(map.enter) && !this.oneShot) {
      this.oneShot = { state: map.enter, mode: { kind: 'once' }, speed: map.speed };
      this.oneShotPending = true;
    }
    this.emotionLoop = this.has(map.loop) ? { state: map.loop, speed: map.speed } : null;
  }

  releaseEmotion(): void {
    this.emotionLoop = null;
  }

  setTalking(on: boolean): void {
    this.talking = on;
  }

  setMouth(v: number): void {
    this.mouth = Math.max(0, Math.min(1, v));
  }

  setEnergy(e: Energy): void {
    this.energy = e;
  }

  /** 当前是否有一次性行在播（runtime：映射行动作期间不叠该动作曲线、节拍门）。 */
  oneShotActive(): boolean {
    return this.oneShot !== null;
  }

  currentLevel(): SpriteLevel {
    return this.level;
  }

  /** 拖拽级：进入须 |vx| ≥ 门槛；低于门槛持续 holdMs 才回落；松手立即回落。 */
  private dragState(now: number, drag: { active: boolean; vx: number }): string | null {
    if (!drag.active) {
      this.drag = null;
      return null;
    }
    const fast = Math.abs(drag.vx) >= SPRITE_DRAG.vxMin;
    if (fast) {
      const state = drag.vx < 0 ? this.cfg.slots.dragLeft : this.cfg.slots.dragRight;
      if (!this.has(state)) return this.drag?.state ?? null;
      this.drag = { state, lowSince: null };
      return state;
    }
    if (!this.drag) return null;
    this.drag.lowSince ??= now;
    if (now - this.drag.lowSince >= SPRITE_DRAG.holdMs) {
      this.drag = null;
      return null;
    }
    return this.drag.state;
  }

  private idleChoice(): { state: string; speed: number } {
    const { slots } = this.cfg;
    if (this.energy === 'low' && this.has(slots.idleLow)) return { state: slots.idleLow, speed: 1 };
    if (this.energy === 'high' && this.has(slots.idleHigh)) return { state: slots.idleHigh, speed: 1 };
    return { state: slots.idle, speed: SPRITE_IDLE_SPEED[this.energy] };
  }

  /** 每帧：裁决等级 → 状态变化才重置 player（同状态只换速度，不跳帧）。 */
  tick(now: number, drag: { active: boolean; vx: number } = { active: false, vx: 0 }): DirectorFrame {
    const dragRow = this.dragState(now, drag);
    if (dragRow) {
      this.oneShot = null; // 拖拽接管：一次性行作废（不排队）
      this.oneShotPending = false;
      return this.show('drag', dragRow, { kind: 'loop' }, 1, now, false).frame;
    }
    if (this.oneShot) {
      const os = this.oneShot;
      const force = this.oneShotPending;
      this.oneShotPending = false;
      const r = this.show('oneShot', os.state, os.mode, os.speed, now, force);
      if (!r.finished) return r.frame;
      this.oneShot = null; // 播完：同帧内落到下一级重新裁决
    }
    if (this.emotionLoop) {
      const e = this.emotionLoop;
      return this.show('emotion', e.state, { kind: 'loop' }, e.speed, now, false).frame;
    }
    const talkState = this.cfg.slots.talk;
    if ((this.talking || this.mouth > SPRITE_TALK.mouthActive) && this.has(talkState)) {
      const speed = SPRITE_TALK.baseSpeed + this.mouth;
      return this.show('talk', talkState, { kind: 'loop' }, speed, now, false).frame;
    }
    const idle = this.idleChoice();
    return this.show('idle', idle.state, { kind: 'loop' }, idle.speed, now, false).frame;
  }

  private show(
    level: SpriteLevel,
    state: string,
    mode: PlayMode,
    speed: number,
    now: number,
    force: boolean,
  ): { frame: DirectorFrame; finished: boolean } {
    // 一次性行必须从第 0 帧起；进出一次性行级即使同状态也重播；其余同状态续播（只换速度）
    const crossOneShot = (level === 'oneShot') !== (this.level === 'oneShot');
    if (force || crossOneShot || state !== this.player.state) {
      this.player.play(state, this.durations(state), mode, now, speed);
    } else {
      this.player.speed = speed;
    }
    this.level = level;
    const r = this.player.tick(now);
    return { frame: { state, frame: r.frame, level }, finished: r.finished };
  }
}
