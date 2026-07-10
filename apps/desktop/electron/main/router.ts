/**
 * 纯 JSON-RPC 方法路由 — Main 的唯一 RPC 校验/分发点，不依赖 Electron。
 *
 * 进站 params 一律先过 `@openpet/protocol` 的 Zod schema（单一真源）：
 * 未注册 / 未知方法 → -32601；schema 违约 → -32602（tech-design §3）。
 */
import type { z } from 'zod';
import { Methods, type MethodName } from '@openpet/protocol';

export class RpcError extends Error {
  constructor(
    public readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = 'RpcError';
  }
}

export type RpcHandlers<C> = {
  [M in MethodName]?: (
    params: z.infer<(typeof Methods)[M]['params']>,
    ctx: C,
  ) => unknown | Promise<unknown>;
};

export interface RpcRouter<C> {
  dispatch(method: string, params: unknown, ctx: C): Promise<unknown>;
}

export function createRouter<C>(handlers: RpcHandlers<C>): RpcRouter<C> {
  const handlerMap = handlers as Partial<
    Record<string, (params: unknown, ctx: C) => unknown | Promise<unknown>>
  >;
  const methodMap = Methods as Record<string, { params: z.ZodTypeAny }>;

  return {
    async dispatch(method, params, ctx) {
      const def = methodMap[method];
      const handler = handlerMap[method];
      if (!def || !handler) throw new RpcError(-32601, `Method not found: ${method}`);
      const parsed = def.params.safeParse(params);
      if (!parsed.success) {
        throw new RpcError(-32602, `Invalid params for ${method}: ${parsed.error.message}`);
      }
      return handler(parsed.data, ctx);
    },
  };
}
