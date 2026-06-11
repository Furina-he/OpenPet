import type { z } from 'zod';
import type { Methods, MethodName } from '@desksoul/protocol';

type MethodParams<M extends MethodName> = z.infer<(typeof Methods)[M]['params']>;
type MethodResult<M extends MethodName> = z.infer<(typeof Methods)[M]['result']>;

declare global {
  interface Window {
    desksoul: {
      /** JSON-RPC 调用（preload 透传到 Main 的 router，params/result 按协议表强类型）。 */
      rpc: <M extends MethodName>(method: M, params: MethodParams<M>) => Promise<MethodResult<M>>;
      /** 订阅 Main 推送的 notification；返回退订函数。payload = 该 method 的 params。 */
      on: <M extends MethodName>(channel: M, cb: (payload: MethodParams<M>) => void) => () => void;
    };
  }
}

export {};
