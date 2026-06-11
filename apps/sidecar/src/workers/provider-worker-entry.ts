/**
 * Streaming provider worker entry for Spike S4.
 *
 * Unlike the request/response `attachServer` (one message in, one out), a chat
 * completion is a *stream*: one `chat.start` in, many `chat.event` out, plus an
 * out-of-band `chat.cancel`. We model it with our own small message kinds over
 * the same MessagePort — still JSON-serializable frames, just not JSON-RPC
 * request/response (notifications would be the JSON-RPC analogue, but the spike
 * keeps the worker protocol self-contained and easy to drive from a test).
 *
 * Cancellation maps to an `AbortController` per in-flight request; the generator
 * observes `signal` between chunks and ends with `finishReason: 'cancel'`.
 */
import { parentPort, type MessagePort } from 'node:worker_threads';
import type {
  ChatStartFrame,
  ChatCancelFrame,
  ProviderInboundFrame,
  ChatEventFrame,
} from '@desksoul/protocol';
import { mockProviderChat } from './mock-provider.js';

// 兼容别名：帧定义已收口到 @desksoul/protocol（单一真源）。
export type StartMessage = ChatStartFrame;
export type CancelMessage = ChatCancelFrame;
export type InboundMessage = ProviderInboundFrame;
export type EventMessage = ChatEventFrame;

/**
 * Wires a MessagePort to the mock provider. Returns nothing; lives for the
 * lifetime of the port. Exported so a test can drive it over a MessageChannel
 * without spawning a real worker.
 */
export function attachProviderServer(port: MessagePort): void {
  const inflight = new Map<string, AbortController>();

  port.on('message', (msg: InboundMessage) => {
    if (msg.kind === 'plugin.response') return; // plugin-client 的事，与流式服务无关
    if (msg.kind === 'chat.cancel') {
      inflight.get(msg.requestId)?.abort();
      return;
    }
    if (msg.kind === 'chat.start') {
      const ac = new AbortController();
      inflight.set(msg.requestId, ac);
      void runStream(port, msg, ac, () => inflight.delete(msg.requestId));
    }
  });
}

async function runStream(
  port: MessagePort,
  start: StartMessage,
  ac: AbortController,
  cleanup: () => void,
): Promise<void> {
  const opts = start.intervalMs !== undefined ? { intervalMs: start.intervalMs } : {};
  try {
    for await (const event of mockProviderChat(ac.signal, opts)) {
      const out: EventMessage = {
        kind: 'chat.event',
        requestId: start.requestId,
        sessionId: start.sessionId,
        event,
      };
      port.postMessage(out);
    }
  } finally {
    cleanup();
  }
}

if (parentPort) {
  attachProviderServer(parentPort);
}
