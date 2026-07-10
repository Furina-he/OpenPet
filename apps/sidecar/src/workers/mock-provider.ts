/**
 * Mock chat provider for Spike S4 — yields a scripted reply in chunks with a
 * fixed inter-chunk delay, so the full streaming pipeline (Worker → Main →
 * BehaviorParser → dual Renderer) can be exercised without a real LLM.
 *
 * The script deliberately mixes plain text with behavior tags (`[intent]`,
 * `<emo/>`, `<act/>`) and splits some tags across chunk boundaries, which is
 * exactly the incremental-parsing case the BehaviorParser must survive.
 */

import type { ChatEvent } from '@openpet/protocol';

// 帧类型已收口到 @openpet/protocol（单一真源）；re-export 维持既有 import 路径兼容。
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

/**
 * 演示模式台词池（M7b-2）：跳过配 Key → 无 active provider → ChatService 空链 →
 * 本 mock 流式推送。每条含 intent + emo/act 标签，驱动表情/动作。第 0 条 = MOCK_SCRIPT
 * （保证默认/既有行为不变）。worker-entry 按轮次 pickDemoScript 轮换，避免每轮同一句。
 */
export const DEMO_SCRIPTS: readonly (readonly string[])[] = [
  MOCK_SCRIPT,
  [
    '[intent mood=happy energy=high]\n',
    '嘿嘿<emo:happy/>',
    '今天也要',
    '<act:wave dur=1200/>',
    '元气满满哦！',
  ],
  [
    '[intent mood=curious energy=mid]\n',
    '唔…<emo:shy/>',
    '你想和我聊点什么呢？',
    '<act:fidget dur=1000/>',
    '我在认真听~',
  ],
];

/** 按轮次取一条台词（回绕；负数也安全）。 */
export function pickDemoScript(index: number): readonly string[] {
  const n = DEMO_SCRIPTS.length;
  return DEMO_SCRIPTS[((index % n) + n) % n]!;
}

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
