/**
 * PluginClient — worker 侧的 plugin.* 调用端（Worker → Main 的 JSON-RPC）。
 *
 * 与同一 MessagePort 上的流式帧（chat.*）共存：双方都按 `kind` 过滤，互不干扰。
 * Main 侧对端是 PluginGateway（desktop electron/main/plugin-gateway.ts）。
 * M5 的 Provider/Skill/Tool 插件运行时将以此为 SDK 内的标准上行通道。
 */
import type { MessagePort } from 'node:worker_threads';
import type { PluginRequestFrame, PluginResponseFrame } from '@openpet/protocol';

export interface PluginClient {
  /** 调用 Main 侧 plugin.* method；error 响应 reject（Error 带 `code` 属性）。 */
  call(method: string, params?: unknown): Promise<unknown>;
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

export function createPluginClient(port: MessagePort): PluginClient {
  let nextId = 1;
  const pending = new Map<number, Pending>();

  port.on('message', (msg: unknown) => {
    const frame = msg as Partial<PluginResponseFrame>;
    if (frame?.kind !== 'plugin.response' || typeof frame.rpc?.id !== 'number') return;
    const p = pending.get(frame.rpc.id);
    if (!p) return;
    pending.delete(frame.rpc.id);
    if (frame.rpc.error) {
      p.reject(Object.assign(new Error(frame.rpc.error.message), { code: frame.rpc.error.code }));
    } else {
      p.resolve(frame.rpc.result);
    }
  });

  return {
    call(method, params) {
      const id = nextId++;
      const frame: PluginRequestFrame = {
        kind: 'plugin.request',
        rpc: { jsonrpc: '2.0', id, method, ...(params !== undefined ? { params } : {}) },
      };
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        port.postMessage(frame);
      });
    },
  };
}
