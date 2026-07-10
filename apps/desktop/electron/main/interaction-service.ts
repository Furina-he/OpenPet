/**
 * InteractionService —— 声明式 Cue 引擎（F-IT 域，arch-evolution #1）。
 *
 * 一切「事件→桌宠表现」收敛为查表：核心链路只发领域事件 trigger(event)，
 * 引擎查 cue 表（manifest.cues 覆盖 DEFAULT_CUES）→ 策略门（cooldown /
 * probability×proactiveFreq / DND 静音 proactive / proactiveSpeech 总闸 say）→
 * 广播 behavior.applyEmotion / behavior.playAction / pet.say（走既有通道）。
 * 纯逻辑，broadcast/prefs/now/rand 注入可测。
 */
import type { Cue, CueEvent, Prefs } from '@openpet/protocol';
import { MOOD_DELTAS, type MoodState } from './mood-state.js';

export interface InteractionDeps {
  /** mergeCues(DEFAULT_CUES, manifest.cues)；角色切换后重新取。 */
  cues: () => Cue[];
  /** behavior.applyEmotion / behavior.playAction / pet.say。 */
  broadcast: (channel: string, params: unknown) => void;
  /** proactiveSpeech/proactiveFreq/dndStart/dndEnd 实时读。 */
  getPrefs: () => Prefs;
  mood: MoodState;
  now?: () => number;
  rand?: () => number;
}

/** 同区连击窗口（F-IT-01）。 */
export const COMBO_WINDOW_MS = 2500;
/** 连击触发次数。 */
export const COMBO_COUNT = 3;
/** 工具执行超此时长未回 → chat.toolLong（打瞌睡）。 */
export const TOOL_LONG_MS = 20_000;

/** 事件 → mood 增量映射（⑦；独立于 cue 表——chat.done 无 cue 也要累积）。 */
const EVENT_MOOD_DELTAS: Partial<Record<CueEvent, number>> = {
  'tap.head': MOOD_DELTAS.tapHead,
  'combo.head': MOOD_DELTAS.combo,
  'stroke.head': MOOD_DELTAS.stroke,
  'chat.done': MOOD_DELTAS.chatDone,
  'chat.error': MOOD_DELTAS.chatError,
};

/** idle 动作池（mood 偏置，spec F-IT-05）。 */
const IDLE_LOW = ['sigh', 'droop', 'tilt'] as const;
const IDLE_HIGH = ['jump', 'wave', 'stretch'] as const;
const IDLE_NEUTRAL = ['stretch', 'sigh', 'tilt'] as const;

/** 'HH:MM' → 当日分钟数；非法输入回 null（不启用 DND）。 */
function parseHm(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** DND 时段判定（跨午夜区间正确处理；start===end 视为不启用）。 */
export function inDndWindow(nowMs: number, dndStart: string, dndEnd: string): boolean {
  const start = parseHm(dndStart);
  const end = parseHm(dndEnd);
  if (start === null || end === null || start === end) return false;
  const d = new Date(nowMs);
  const t = d.getHours() * 60 + d.getMinutes();
  return start < end ? t >= start && t < end : t >= start || t < end;
}

export class InteractionService {
  private readonly deps: InteractionDeps;
  private readonly now: () => number;
  private readonly rand: () => number;
  /** ② 冷却：按 event 记最近一次发射时刻。 */
  private readonly lastFired = new Map<CueEvent, number>();
  /** ⑧ 连击：同 zone 的 (count, 首击时刻)。 */
  private readonly combos = new Map<string, { count: number; startedAt: number }>();
  /** ⑨ toolLong 定时器（按 sessionId）。 */
  private readonly toolTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(deps: InteractionDeps) {
    this.deps = deps;
    this.now = deps.now ?? (() => Date.now());
    this.rand = deps.rand ?? (() => Math.random());
  }

  /** 领域事件入口：查表 → 策略门 → 发射（语义 ①-⑦，见 plan T3）。 */
  trigger(event: CueEvent): void {
    // ⑦ mood 联动先于查表——chat.done 无 cue 也要累积。
    const delta = EVENT_MOOD_DELTAS[event];
    if (delta !== undefined) this.deps.mood.bump(delta);

    // ① 查表无该 on → no-op。
    const cue = this.deps.cues().find((c) => c.on === event);
    if (!cue) return;

    // ② cooldown 未过 → no-op。
    const now = this.now();
    const last = this.lastFired.get(event);
    if (cue.cooldownMs && last !== undefined && now - last < cue.cooldownMs) return;

    const prefs = this.deps.getPrefs();
    if (cue.proactive) {
      // ③ DND 时段静音 proactive 类。
      if (inDndWindow(now, prefs['general.dndStart'], prefs['general.dndEnd'])) return;
      // ④ 有效概率 = (probability ?? 1) * (proactiveFreq/100)。
      const p = (cue.probability ?? 1) * (prefs['general.proactiveFreq'] / 100);
      if (p <= 0 || (p < 1 && this.rand() >= p)) return;
    } else if (cue.probability !== undefined && this.rand() >= cue.probability) {
      return;
    }

    // ⑤ 发射（idle.timeout 特判 mood 偏置动作池）。
    this.lastFired.set(event, now);
    if (cue.emotion) {
      this.deps.broadcast('behavior.applyEmotion', { name: cue.emotion, weight: 1 });
    }
    const action = event === 'idle.timeout' ? this.pickIdleAction() : cue.action;
    if (action) {
      this.deps.broadcast('behavior.playAction', { name: action, durationMs: null });
    }
    // ⑥ say：proactiveSpeech 总闸；池随机一条。
    if (cue.say?.length && prefs['general.proactiveSpeech']) {
      const text = cue.say[Math.min(cue.say.length - 1, Math.floor(this.rand() * cue.say.length))]!;
      this.deps.broadcast('pet.say', { text });
    }
  }

  /** ⑧ tap 辅助入口：同 zone 2.5s 窗口计数，第 3 次改发 combo.head 并清零，否则发 tap.*。 */
  onTap(zone: 'head' | 'body'): void {
    const now = this.now();
    const c = this.combos.get(zone);
    const count = c && now - c.startedAt <= COMBO_WINDOW_MS ? c.count + 1 : 1;
    if (zone === 'head' && count >= COMBO_COUNT) {
      this.combos.delete(zone);
      this.trigger('combo.head');
      return;
    }
    this.combos.set(zone, { count, startedAt: count === 1 ? now : c!.startedAt });
    this.trigger(zone === 'head' ? 'tap.head' : 'tap.body');
  }

  /** ⑨ 工具执行开始：起 20s 定时，到点发 chat.toolLong（打瞌睡）。 */
  markToolStart(sessionId: string): void {
    this.markToolEnd(sessionId); // 同 session 重复 start 先清旧
    this.toolTimers.set(
      sessionId,
      setTimeout(() => {
        this.toolTimers.delete(sessionId);
        this.trigger('chat.toolLong');
      }, TOOL_LONG_MS),
    );
  }

  /** ⑨ 工具执行结束：取消定时。 */
  markToolEnd(sessionId: string): void {
    const t = this.toolTimers.get(sessionId);
    if (t) {
      clearTimeout(t);
      this.toolTimers.delete(sessionId);
    }
  }

  dispose(): void {
    for (const t of this.toolTimers.values()) clearTimeout(t);
    this.toolTimers.clear();
  }

  private pickIdleAction(): string {
    const mood = this.deps.mood.current();
    const pool = mood < -0.3 ? IDLE_LOW : mood > 0.4 ? IDLE_HIGH : IDLE_NEUTRAL;
    return pool[Math.min(pool.length - 1, Math.floor(this.rand() * pool.length))]!;
  }
}
