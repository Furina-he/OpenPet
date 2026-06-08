import { z } from 'zod';

export const Methods = {
  'sys.ping': {
    params: z.object({ nonce: z.string() }),
    result: z.object({ pong: z.string(), echoNonce: z.string() }),
  },
} as const;

export type MethodName = keyof typeof Methods;
