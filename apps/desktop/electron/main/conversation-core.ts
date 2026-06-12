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
}

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
   * 取消该 session：此后迟到的 delta 直接丢弃，半截标签 buffer 与定时器一并废弃
   * （取消语义下不值得 flush 成文本）。调用方必须保证之后会有一个 done
   * 事件（ProviderHost 协作取消或 watchdog 强杀都会合成）——done 负责清标记。
   */
  cancel(sessionId: string): void {
    this.teardown(sessionId);
    this.cancelling.add(sessionId);
  }

  /** Route a single provider event for `sessionId` into the two channels. */
  handleEvent(sessionId: string, event: ChatEvent): void {
    if (event.type === 'delta') {
      if (this.cancelling.has(sessionId)) return; // 取消后迟到的 delta
      const state = this.stateFor(sessionId);
      for (const be of state.parser.feed(event.text)) this.emitBehavior(sessionId, be);
      this.armStaleTimer(sessionId, state);
      return;
    }
    // done: flush any buffered half-tag as text, then close both channels.
    this.cancelling.delete(sessionId);
    const state = this.sessions.get(sessionId);
    if (state) {
      this.clearStaleTimer(state);
      for (const be of state.parser.flush()) this.emitBehavior(sessionId, be);
      this.sessions.delete(sessionId);
    }
    this.notify({
      channel: 'chat.done',
      sessionId,
      params: { sessionId, finishReason: event.finishReason },
    });
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
      };
      this.sessions.set(sessionId, s);
    }
    return s;
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
    this.sessions.delete(sessionId);
  }

  private emitBehavior(sessionId: string, be: BehaviorEvent): void {
    switch (be.type) {
      case 'text':
        this.notify({ channel: 'chat.stream', sessionId, params: { sessionId, text: be.text } });
        break;
      case 'emotion':
        this.notify({
          channel: 'behavior.applyEmotion',
          sessionId,
          params: { name: be.name, weight: be.weight },
        });
        break;
      case 'action':
        this.notify({
          channel: 'behavior.playAction',
          sessionId,
          params: { name: be.name, durationMs: be.durationMs },
        });
        break;
      case 'intent':
        this.notify({
          channel: 'behavior.setIntent',
          sessionId,
          params: { mood: be.mood, energy: be.energy },
        });
        break;
      case 'say':
        // V1+ 语音：解析层支持，消费端 stub（impl-plan M3「say 留 stub」）。
        break;
      case 'wait':
        // Task 7 接管：per-session 发射门实现文本流停顿。
        break;
    }
  }
}
