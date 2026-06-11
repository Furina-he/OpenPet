/**
 * Mock chat provider for Spike S4 — yields a scripted reply in chunks with a
 * fixed inter-chunk delay, so the full streaming pipeline (Worker → Main →
 * BehaviorParser → dual Renderer) can be exercised without a real LLM.
 *
 * The script deliberately mixes plain text with behavior tags (`[intent]`,
 * `<emo/>`, `<act/>`) and splits some tags across chunk boundaries, which is
 * exactly the incremental-parsing case the BehaviorParser must survive.
 */

import type { ChatEvent } from '@desksoul/protocol';

// 帧类型已收口到 @desksoul/protocol（单一真源）；re-export 维持既有 import 路径兼容。
export type { ChatEvent };

/** Scripted chunks; tags are split across chunks on purpose (see `<act:` below). */
export const MOCK_SCRIPT: readonly string[] = [
  '[intent mood=shy energy=low]\n',
  '嗯…<emo:shy/>',
  '我在想要不要',
  '<act:fidget ',
  'dur=1500/>请你',
  '喝杯热可可？<emo:happy/>',
];

export interface MockProviderOptions {
  /** Delay between chunks in ms (default 50). */
  intervalMs?: number;
  /** Override the scripted chunks (tests). */
  script?: readonly string[];
}

/**
 * Streams the scripted reply as `delta` events, then a terminal `done`.
 * Honors `signal`: an abort between chunks ends the stream with
 * `finishReason: 'cancel'` instead of `'stop'` (no further deltas emitted).
 */
export async function* mockProviderChat(
  signal: AbortSignal,
  opts: MockProviderOptions = {},
): AsyncGenerator<ChatEvent> {
  const intervalMs = opts.intervalMs ?? 50;
  const script = opts.script ?? MOCK_SCRIPT;

  for (const chunk of script) {
    if (signal.aborted) {
      yield { type: 'done', finishReason: 'cancel' };
      return;
    }
    await delay(intervalMs, signal);
    if (signal.aborted) {
      yield { type: 'done', finishReason: 'cancel' };
      return;
    }
    yield { type: 'delta', text: chunk };
  }
  yield { type: 'done', finishReason: 'stop' };
}

/** Resolves after `ms`, or early (without throwing) once `signal` aborts. */
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(finish, ms);
    function finish(): void {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    }
    signal.addEventListener('abort', finish, { once: true });
  });
}
