/**
 * FetchGateway — Main 侧代理 fetch 网关（M5）。
 *
 * Worker 的 plugin.fetchRequest 经 ProviderHost 进来：
 *   1. resolveHost 白名单校验（命中得 providerId，否则拒绝）
 *   2. injectAuth 按 dialect 注入密钥（Keychain 取，发生在 Main —— Worker 永不见密钥）
 *   3. 注入的 HttpAgent 执行实际请求（生产为 Electron net；测试 mock）
 *   4. head/data/end/error → plugin.fetchChunk 帧经 send 流式回灌 Worker
 *
 * HttpAgent 是注入的抽象：Electron `net` 不能在 vitest 加载，故执行 HTTP 的能力
 * 从外部注入，网关本身保持纯模块、可单测。
 */
import type { PluginFetchRequestFrame, PluginFetchChunkFrame } from '@desksoul/protocol';

export interface HttpRequestSpec {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  signal: AbortSignal;
}

export interface HttpResponseSink {
  head(status: number, headers: Record<string, string>): void;
  data(chunk: string): void;
  end(): void;
  error(message: string): void;
}

export type HttpAgent = (spec: HttpRequestSpec, sink: HttpResponseSink) => void;

export interface FetchGatewayDeps {
  agent: HttpAgent;
  /** 命中白名单返回 providerId，否则 null（拒绝）。 */
  resolveHost: (url: string) => { providerId: string } | null;
  /** 按 providerId 把密钥注入（dialect：Bearer/x-api-key 改 header；query-key 改 url）。 */
  injectAuth: (
    providerId: string,
    url: string,
    headers: Record<string, string>,
  ) => Promise<{ url?: string; headers: Record<string, string> }>;
}

export interface FetchGateway {
  handle(frame: PluginFetchRequestFrame, send: (chunk: PluginFetchChunkFrame) => void): void;
  cancel(id: string): void;
  cancelAll(): void;
}

export function createFetchGateway(deps: FetchGatewayDeps): FetchGateway {
  const inflight = new Map<string, AbortController>();

  return {
    handle(frame, send) {
      const sendErr = (error: string): void =>
        send({ kind: 'plugin.fetchChunk', id: frame.id, phase: 'error', error });

      const hit = deps.resolveHost(frame.url);
      if (!hit) {
        sendErr(`host not allowed: ${frame.url}`);
        return;
      }

      const ac = new AbortController();
      inflight.set(frame.id, ac);
      const done = (): void => {
        inflight.delete(frame.id);
      };

      void deps
        .injectAuth(hit.providerId, frame.url, { ...(frame.init.headers ?? {}) })
        .then(({ url, headers }) => {
          const sink: HttpResponseSink = {
            head: (status, h) =>
              send({ kind: 'plugin.fetchChunk', id: frame.id, phase: 'head', status, headers: h }),
            data: (chunk) => send({ kind: 'plugin.fetchChunk', id: frame.id, phase: 'data', chunk }),
            end: () => {
              send({ kind: 'plugin.fetchChunk', id: frame.id, phase: 'end' });
              done();
            },
            error: (message) => {
              sendErr(message);
              done();
            },
          };
          deps.agent(
            {
              url: url ?? frame.url,
              method: frame.init.method,
              headers,
              ...(frame.init.body !== undefined ? { body: frame.init.body } : {}),
              signal: ac.signal,
            },
            sink,
          );
        })
        .catch((e: unknown) => {
          sendErr(e instanceof Error ? e.message : String(e));
          done();
        });
    },
    cancel(id) {
      inflight.get(id)?.abort();
      inflight.delete(id);
    },
    cancelAll() {
      for (const ac of inflight.values()) ac.abort();
      inflight.clear();
    },
  };
}
