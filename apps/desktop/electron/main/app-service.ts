/**
 * AppService —— app.* 杂项 handler 工厂（M7b1：openExternal）。注入 opener 便于测；
 * 仅放行 http/https（防 file://、命令型 scheme）。由 ipc-router spread 进 router。
 */
import { RpcError } from './router.js';

export interface AppServiceDeps {
  openExternal: (url: string) => void;
}

export function createAppService(deps: AppServiceDeps) {
  return {
    'app.openExternal': async (p: { url: string }) => {
      if (!/^https?:\/\//i.test(p.url)) {
        throw new RpcError(-32602, `refused non-http(s) url: ${p.url}`);
      }
      deps.openExternal(p.url);
      return { ok: true as const };
    },
  };
}
