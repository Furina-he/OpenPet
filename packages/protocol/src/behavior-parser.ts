export type BehaviorEvent =
  | { type: 'text'; text: string }
  | { type: 'emotion'; name: string; weight: number }
  | { type: 'action'; name: string; durationMs: number | null }
  | { type: 'wait'; ms: number }
  | { type: 'intent'; mood: string; energy: string };

const EMO_TAG = /^<emo:([a-zA-Z][\w-]*)(?:\s+w=([0-9.]+))?\s*\/>$/;
const ACT_TAG = /^<act:([a-zA-Z][\w-]*)(?:\s+dur=(\d+))?\s*\/>$/;
const WAIT_TAG = /^<wait\s+ms=(\d+)\s*\/>$/;
const INTENT_TAG = /^\[intent\s+mood=([a-zA-Z][\w-]*)\s+energy=([a-zA-Z][\w-]*)\s*\]$/;

export class BehaviorParser {
  private buffer = '';

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
      const event = parseTag(tag);
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
}

function parseTag(tag: string): BehaviorEvent | null {
  const emo = EMO_TAG.exec(tag);
  if (emo) {
    const name = emo[1]!;
    const weight = emo[2] !== undefined ? parseFloat(emo[2]) : 1.0;
    return { type: 'emotion', name, weight };
  }
  const act = ACT_TAG.exec(tag);
  if (act) {
    const name = act[1]!;
    const durationMs = act[2] !== undefined ? parseInt(act[2], 10) : null;
    return { type: 'action', name, durationMs };
  }
  const wait = WAIT_TAG.exec(tag);
  if (wait) {
    return { type: 'wait', ms: parseInt(wait[1]!, 10) };
  }
  const intent = INTENT_TAG.exec(tag);
  if (intent) {
    return { type: 'intent', mood: intent[1]!, energy: intent[2]! };
  }
  return null;
}
