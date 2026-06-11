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
 * Pure and Electron-free so it can be unit-tested directly; the Main process
 * wires `notify` to `webContents.send`.
 */
import { BehaviorParser, type BehaviorEvent, type ChatEvent } from '@desksoul/protocol';

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

/** One parser per active session so interleaved sessions don't share buffer state. */
export class ConversationCore {
  private readonly parsers = new Map<string, BehaviorParser>();
  private readonly cancelling = new Set<string>();

  constructor(private readonly notify: (n: Notification) => void) {}

  /**
   * 取消该 session：此后迟到的 delta 直接丢弃，半截标签 buffer 一并废弃
   * （取消语义下不值得 flush 成文本）。调用方必须保证之后会有一个 done
   * 事件（ProviderHost 协作取消或 watchdog 强杀都会合成）——done 负责清标记。
   */
  cancel(sessionId: string): void {
    this.cancelling.add(sessionId);
    this.parsers.delete(sessionId);
  }

  /** Route a single provider event for `sessionId` into the two channels. */
  handleEvent(sessionId: string, event: ChatEvent): void {
    if (event.type === 'delta') {
      if (this.cancelling.has(sessionId)) return; // 取消后迟到的 delta
      const parser = this.parserFor(sessionId);
      for (const be of parser.feed(event.text)) this.emitBehavior(sessionId, be);
      return;
    }
    // done: flush any buffered half-tag as text, then close both channels.
    this.cancelling.delete(sessionId);
    const parser = this.parsers.get(sessionId);
    if (parser) {
      for (const be of parser.flush()) this.emitBehavior(sessionId, be);
      this.parsers.delete(sessionId);
    }
    this.notify({
      channel: 'chat.done',
      sessionId,
      params: { sessionId, finishReason: event.finishReason },
    });
  }

  private parserFor(sessionId: string): BehaviorParser {
    let p = this.parsers.get(sessionId);
    if (!p) {
      p = new BehaviorParser();
      this.parsers.set(sessionId, p);
    }
    return p;
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
      case 'wait':
        // M1 不在文本流上实现 <wait/> 节流；M3 行为协议生产化时处理。
        break;
    }
  }
}
