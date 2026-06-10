import { z } from 'zod';

/**
 * Method registry — single source of truth for IPC contracts.
 *
 * Request/response methods (Renderer → Main) carry a meaningful `result`.
 * Notification methods (Main → Renderer, fire-and-forget over
 * `webContents.send`) never expect a reply, so their `result` is `z.null()`
 * and only `params` matters. Keeping a uniform `{ params, result }` shape lets
 * every method be looked up the same way regardless of direction.
 */
export const Methods = {
  // --- request/response: Renderer → Main ---
  'sys.ping': {
    params: z.object({ nonce: z.string() }),
    result: z.object({ pong: z.string(), echoNonce: z.string() }),
  },
  'chat.send': {
    params: z.object({ sessionId: z.string(), text: z.string() }),
    result: z.object({ ok: z.literal(true) }),
  },
  'chat.cancel': {
    params: z.object({ sessionId: z.string() }),
    result: z.object({ ok: z.literal(true) }),
  },

  // --- notification: Main → UI Overlay Renderer ---
  'chat.stream': {
    params: z.object({ sessionId: z.string(), text: z.string() }),
    result: z.null(),
  },
  'chat.done': {
    params: z.object({
      sessionId: z.string(),
      finishReason: z.enum(['stop', 'cancel', 'error']),
    }),
    result: z.null(),
  },

  // --- notification: Main → Character Renderer ---
  'behavior.applyEmotion': {
    params: z.object({ name: z.string(), weight: z.number() }),
    result: z.null(),
  },
  'behavior.playAction': {
    params: z.object({ name: z.string(), durationMs: z.number().nullable() }),
    result: z.null(),
  },
  'behavior.setIntent': {
    params: z.object({ mood: z.string(), energy: z.string() }),
    result: z.null(),
  },
} as const;

export type MethodName = keyof typeof Methods;
