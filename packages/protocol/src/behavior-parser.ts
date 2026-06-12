export type BehaviorEvent =
  | { type: 'text'; text: string }
  | { type: 'emotion'; name: string; weight: number }
  | { type: 'action'; name: string; durationMs: number | null }
  | { type: 'wait'; ms: number }
  | { type: 'say'; clip: string }
  | { type: 'intent'; mood: string; energy: string };

/**
 * 数值边界（越界 clamp + warn）。persona 模板与消费端共享同一组上限，
 * maxTagLength 限制的是「未闭合标签的等待窗口」（防 buffer 无限增长），
 * 不限制已完整闭合的标签。
 */
export const BEHAVIOR_LIMITS = {
  emotionWeightMax: 1,
  actionDurationMaxMs: 60_000,
  waitMaxMs: 10_000,
  maxTagLength: 128,
} as const;

export type BehaviorWarnReason =
  | 'malformed-tag' // 注册命名空间内、闭合后语法不合规（如 <emo:bad name/>、w=1.2.3）
  | 'unregistered-tag' // <NAME...> 形状但 NAME 不在注册集（如 <bogus:x/>、<div>）
  | 'value-clamped' // w/dur/ms 越界被 clamp
  | 'tag-overflow' // 未闭合超过 maxTagLength，整段放行为文本
  | 'misplaced-intent'; // [intent] 不在段首

export interface BehaviorParserOptions {
  /** 协议层告警出口。protocol 包零运行时依赖，日志实现由宿主注入。 */
  onWarn?: (reason: BehaviorWarnReason, raw: string) => void;
}

const EMO_TAG = /^<emo:([a-zA-Z][\w-]*)(?:\s+w=(\d+(?:\.\d+)?|\.\d+))?\s*\/>$/;
const ACT_TAG = /^<act:([a-zA-Z][\w-]*)(?:\s+dur=(\d+))?\s*\/>$/;
const WAIT_TAG = /^<wait\s+ms=(\d+)\s*\/>$/;
const SAY_TAG = /^<say:([a-zA-Z][\w-]*)\s*\/>$/;
const INTENT_TAG = /^\[intent\s+mood=([a-zA-Z][\w-]*)\s+energy=([a-zA-Z][\w-]*)\s*\]$/;

export class BehaviorParser {
  private buffer = '';
  private readonly onWarn: ((reason: BehaviorWarnReason, raw: string) => void) | undefined;

  constructor(opts: BehaviorParserOptions = {}) {
    this.onWarn = opts.onWarn;
  }

  *feed(chunk: string): Generator<BehaviorEvent> {
    this.buffer += chunk;
    yield* this.drain(false);
  }

  *flush(): Generator<BehaviorEvent> {
    yield* this.drain(true);
  }

  private *drain(flush: boolean): Generator<BehaviorEvent> {
    while (this.buffer.length > 0) {
      const open = this.nextMarker();
      if (open === -1) {
        yield { type: 'text', text: this.buffer };
        this.buffer = '';
        return;
      }
      if (open > 0) {
        yield { type: 'text', text: this.buffer.slice(0, open) };
        this.buffer = this.buffer.slice(open);
      }
      const closer = this.buffer[0] === '<' ? '>' : ']';
      const close = this.buffer.indexOf(closer);
      if (close === -1) {
        if (flush) {
          yield { type: 'text', text: this.buffer };
          this.buffer = '';
        }
        return;
      }
      const tag = this.buffer.slice(0, close + 1);
      const event = this.parseRegistered(tag);
      yield event ?? { type: 'text', text: tag };
      this.buffer = this.buffer.slice(close + 1);
    }
  }

  private nextMarker(): number {
    const lt = this.buffer.indexOf('<');
    const br = this.buffer.indexOf('[');
    if (lt === -1) return br;
    if (br === -1) return lt;
    return Math.min(lt, br);
  }

  private warn(reason: BehaviorWarnReason, raw: string): void {
    this.onWarn?.(reason, raw);
  }

  private parseRegistered(tag: string): BehaviorEvent | null {
    const emo = EMO_TAG.exec(tag);
    if (emo) {
      const weight = emo[2] !== undefined ? parseFloat(emo[2]) : 1.0;
      return {
        type: 'emotion',
        name: emo[1]!,
        weight: this.clamp(weight, BEHAVIOR_LIMITS.emotionWeightMax, tag),
      };
    }
    const act = ACT_TAG.exec(tag);
    if (act) {
      const durationMs =
        act[2] !== undefined
          ? this.clamp(parseInt(act[2], 10), BEHAVIOR_LIMITS.actionDurationMaxMs, tag)
          : null;
      return { type: 'action', name: act[1]!, durationMs };
    }
    const wait = WAIT_TAG.exec(tag);
    if (wait) {
      return {
        type: 'wait',
        ms: this.clamp(parseInt(wait[1]!, 10), BEHAVIOR_LIMITS.waitMaxMs, tag),
      };
    }
    const say = SAY_TAG.exec(tag);
    if (say) {
      return { type: 'say', clip: say[1]! };
    }
    const intent = INTENT_TAG.exec(tag);
    if (intent) {
      return { type: 'intent', mood: intent[1]!, energy: intent[2]! };
    }
    return null;
  }

  /** 正则保证非负，越上限 clamp + warn。 */
  private clamp(v: number, max: number, raw: string): number {
    if (v <= max) return v;
    this.warn('value-clamped', raw);
    return max;
  }
}
