/**
 * ConversationCore — the dual-channel splitter (Main-side).
 *
 * Consumes provider `ChatEvent`s for a session, feeds delta text through the
 * `BehaviorParser`, and emits two parallel notification streams:
 *   - chat.*      → UI Overlay (clean text, stripped of tags; done)
 *   - behavior.*  → Character window (emotion / action / intent)
 *
 * This is where "dual-track streaming" lives: one provider delta can produce
 * both a `chat.stream` (the surrounding text) and a `behavior.applyEmotion`
 * (the embedded tag), interleaved in emission order so the character reacts as
 * the text flows — not after it finishes.
 *
 * M3 生产化：
 *   - fail-safe：300ms 无新 delta 时把半截标签 buffer 放行为文本（stale flush）。
 *   - 解析告警（非法/越界/误用标签）经 opts.warn 出口，缺省 console.warn。
 *   - <say:.../> 解析后静默丢弃（V1+ 语音）。
 *   - <wait ms=N/> 文本流停顿：per-session 发射门，门后通知（含 done）按序延迟，
 *     取消时清空 pending（pending 含 done 时当场合成 done(cancel) 防死锁）。
 *
 * Pure and Electron-free so it can be unit-tested directly; the Main process
 * wires `notify` to `webContents.send`.
 */
import {
  BehaviorParser,
  type BehaviorEvent,
  type ChatEvent,
  type BehaviorWarnReason,
} from '@desksoul/protocol';

export type Notification =
  | { channel: 'chat.stream'; sessionId: string; params: { sessionId: string; text: string } }
  | {
      channel: 'chat.done';
      sessionId: string;
      params: { sessionId: string; finishReason: 'stop' | 'cancel' | 'error' };
    }
  | {
      channel: 'behavior.applyEmotion';
      sessionId: string;
      params: { name: string; weight: number };
    }
  | {
      channel: 'behavior.playAction';
      sessionId: string;
      params: { name: string; durationMs: number | null };
    }
  | { channel: 'behavior.setIntent'; sessionId: string; params: { mood: string; energy: string } };

/** tech-design §4.1 fail-safe：300ms 无新 token，半截标签强制 flush 为文本。 */
export const STALE_FLUSH_MS = 300;

export interface ConversationCoreOptions {
  /** 协议告警出口（sessionId + parser 的 reason/raw）；缺省 console.warn。 */
  warn?: (sessionId: string, reason: string, raw: string) => void;
}

interface SessionState {
  parser: BehaviorParser;
  staleTimer: ReturnType<typeof setTimeout> | null;
  /** <wait/> 发射门：null = 直通；非 null = 延迟中，后续通知进 pending。 */
  gateTimer: ReturnType<typeof setTimeout> | null;
  gatePending: GateEntry[];
  /** done 已入队：gate 排空后自毁 state。 */
  endAfterDrain: boolean;
}

type GateEntry = { kind: 'notify'; n: Notification } | { kind: 'delay'; ms: number };

/** One state per active session so interleaved sessions don't share buffer state. */
export class ConversationCore {
  private readonly sessions = new Map<string, SessionState>();
  private readonly cancelling = new Set<string>();
  private readonly warnOut: (sessionId: string, reason: string, raw: string) => void;

  constructor(
    private readonly notify: (n: Notification) => void,
    opts: ConversationCoreOptions = {},
  ) {
    this.warnOut =
      opts.warn ?? ((sid, reason, raw) => console.warn(`[behavior:${sid}] ${reason}: ${raw}`));
  }

  /**
   * 取消该 session：此后迟到的 delta 直接丢弃，半截标签 buffer、定时器与
   * 发射门 pending 一并废弃（取消语义下不值得 flush 成文本）。
   *
   * 若 pending 里已压着 done（流在 provider 侧早已结束、被 <wait/> 压住）：
   * 不会再有任何事件来，当场合成 done(cancel) 封口——否则 session 永远
   * streaming、新消息永远 busy。此时不设 cancelling（没有后续事件需要拦，
   * 标记也无人来清）。否则照旧设标记，等 ProviderHost 合成的 done 来清。
   */
  cancel(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    const hadPendingDone =
      state?.gatePending.some((e) => e.kind === 'notify' && e.n.channel === 'chat.done') ?? false;
    this.teardown(sessionId);
    if (hadPendingDone) {
      this.notify({
        channel: 'chat.done',
        sessionId,
        params: { sessionId, finishReason: 'cancel' },
      });
      return;
    }
    this.cancelling.add(sessionId);
  }

  /** Route a single provider event for `sessionId` into the two channels. */
  handleEvent(sessionId: string, event: ChatEvent): void {
    // usage / tool_call 不属于双轨拆分（由 ChatService 在上游拦截处理）；此处防御性
    // 忽略，避免 done 分支误判（M5：ChatEvent 扩展为 delta/tool_call/usage/done 四变体）。
    if (event.type !== 'delta' && event.type !== 'done') return;
    if (event.type === 'delta') {
      if (this.cancelling.has(sessionId)) return; // 取消后迟到的 delta
      const state = this.stateFor(sessionId);
      for (const be of state.parser.feed(event.text)) this.emitBehavior(sessionId, be);
      this.armStaleTimer(sessionId, state);
      return;
    }
    // done: flush any buffered half-tag as text, then close both channels.
    // 若 <wait/> 门开着，done 与残余文本一起排队——UI 永远先看到文本再看到 done。
    this.cancelling.delete(sessionId);
    const state = this.sessions.get(sessionId);
    const doneNotification: Notification = {
      channel: 'chat.done',
      sessionId,
      params: { sessionId, finishReason: event.finishReason },
    };
    if (!state) {
      this.notify(doneNotification);
      return;
    }
    this.clearStaleTimer(state);
    for (const be of state.parser.flush()) this.emitBehavior(sessionId, be);
    this.send(sessionId, doneNotification);
    if (state.gateTimer === null) this.sessions.delete(sessionId);
    else state.endAfterDrain = true;
  }

  /** 清理全部 session 状态与定时器（app 退出路径，ChatService.dispose 调用）。 */
  dispose(): void {
    for (const sessionId of [...this.sessions.keys()]) this.teardown(sessionId);
    this.cancelling.clear();
  }

  private stateFor(sessionId: string): SessionState {
    let s = this.sessions.get(sessionId);
    if (!s) {
      s = {
        parser: new BehaviorParser({
          onWarn: (reason: BehaviorWarnReason, raw: string) => this.warnOut(sessionId, reason, raw),
        }),
        staleTimer: null,
        gateTimer: null,
        gatePending: [],
        endAfterDrain: false,
      };
      this.sessions.set(sessionId, s);
    }
    return s;
  }

  /** 通知出口：门关着直通（零开销，M2 行为）；门开着按序排队。 */
  private send(sessionId: string, n: Notification): void {
    const state = this.sessions.get(sessionId);
    if (!state || state.gateTimer === null) {
      this.notify(n);
      return;
    }
    state.gatePending.push({ kind: 'notify', n });
  }

  private addDelay(sessionId: string, ms: number): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;
    if (state.gateTimer === null) {
      state.gateTimer = setTimeout(() => this.releaseGate(sessionId, state), ms);
    } else {
      state.gatePending.push({ kind: 'delay', ms });
    }
  }

  /** 门到点：按序放行 pending，途中遇到 delay 重新武装；排空后视情自毁。 */
  private releaseGate(sessionId: string, state: SessionState): void {
    state.gateTimer = null;
    while (state.gatePending.length > 0) {
      const entry = state.gatePending.shift()!;
      if (entry.kind === 'delay') {
        if (entry.ms > 0) {
          state.gateTimer = setTimeout(() => this.releaseGate(sessionId, state), entry.ms);
          return;
        }
        continue;
      }
      this.notify(entry.n);
    }
    if (state.endAfterDrain) this.sessions.delete(sessionId);
  }

  /** 半截标签在 buffer 里才武装定时器；到点放行为文本，流恢复后解析照常。 */
  private armStaleTimer(sessionId: string, state: SessionState): void {
    this.clearStaleTimer(state);
    if (!state.parser.hasPendingInput()) return;
    state.staleTimer = setTimeout(() => {
      state.staleTimer = null;
      const events = [...state.parser.flush()];
      if (events.length === 0) return;
      this.warnOut(
        sessionId,
        'stale-flush',
        events.map((e) => (e.type === 'text' ? e.text : '')).join(''),
      );
      for (const be of events) this.emitBehavior(sessionId, be);
    }, STALE_FLUSH_MS);
  }

  private clearStaleTimer(state: SessionState): void {
    if (state.staleTimer) {
      clearTimeout(state.staleTimer);
      state.staleTimer = null;
    }
  }

  private teardown(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;
    this.clearStaleTimer(state);
    if (state.gateTimer) {
      clearTimeout(state.gateTimer);
      state.gateTimer = null;
    }
    state.gatePending = [];
    this.sessions.delete(sessionId);
  }

  private emitBehavior(sessionId: string, be: BehaviorEvent): void {
    switch (be.type) {
      case 'text':
        this.send(sessionId, {
          channel: 'chat.stream',
          sessionId,
          params: { sessionId, text: be.text },
        });
        break;
      case 'emotion':
        this.send(sessionId, {
          channel: 'behavior.applyEmotion',
          sessionId,
          params: { name: be.name, weight: be.weight },
        });
        break;
      case 'action':
        this.send(sessionId, {
          channel: 'behavior.playAction',
          sessionId,
          params: { name: be.name, durationMs: be.durationMs },
        });
        break;
      case 'intent':
        this.send(sessionId, {
          channel: 'behavior.setIntent',
          sessionId,
          params: { mood: be.mood, energy: be.energy },
        });
        break;
      case 'say':
        // V1+ 语音：解析层支持，消费端 stub（impl-plan M3「say 留 stub」）。
        break;
      case 'wait':
        // 文本流停顿（tech-design §4.1）：parser 已 clamp ≤10s；0ms 视为无停顿。
        if (be.ms > 0) this.addDelay(sessionId, be.ms);
        break;
    }
  }
}
