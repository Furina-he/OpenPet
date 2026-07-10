import type { MessagePort } from 'node:worker_threads';
import type { PluginFetchRequestFrame, PluginFetchChunkFrame } from '@openpet/protocol';

let proxyInstalled = false;
const FETCH_TIMEOUT = 60_000; // 60s（流式补全可能较慢）

interface Pending {
  controller: ReadableStreamDefaultController<Uint8Array> | null;
  settleHead: (r: Response) => void;
  failHead: (e: Error) => void;
  headSettled: boolean;
  timeoutId: ReturnType<typeof setTimeout>;
}

/** 仅测试：重置安装单例，使同进程内可多次 install。 */
export function __resetFetchProxyForTest(): void {
  proxyInstalled = false;
}

/**
 * 在 Worker bootstrap 阶段把 globalThis.fetch 替换为代理实现：请求经 MessagePort
 * 上行到 Main 的 FetchGateway，响应以 plugin.fetchChunk（head/data/end/error）流式
 * 回灌，本地重建一个 ReadableStream 作为 Response.body —— provider 因此能边收边解析
 * SSE/NDJSON。密钥在 Main 注入，Worker 永不可见。
 */
export function installFetchProxy(port: MessagePort): void {
  if (proxyInstalled) return;
  proxyInstalled = true;

  const pending = new Map<string, Pending>();
  const enc = new TextEncoder();

  port.on('message', (msg: unknown) => {
    if (typeof msg !== 'object' || !msg || (msg as { kind?: string }).kind !== 'plugin.fetchChunk')
      return;
    const f = msg as PluginFetchChunkFrame;
    const p = pending.get(f.id);
    if (!p) return;

    if (f.phase === 'head') {
      clearTimeout(p.timeoutId);
      const body = new ReadableStream<Uint8Array>({
        start: (c) => {
          p.controller = c;
        },
      });
      p.headSettled = true;
      p.settleHead(
        new Response(body, { status: f.status ?? 200, ...(f.headers ? { headers: f.headers } : {}) }),
      );
    } else if (f.phase === 'data') {
      if (f.chunk) p.controller?.enqueue(enc.encode(f.chunk));
    } else if (f.phase === 'end') {
      p.controller?.close();
      pending.delete(f.id);
    } else {
      // phase === 'error'：head 之前 → reject fetch；head 之后 → error 流
      const err = new Error(f.error ?? 'fetch failed');
      if (!p.headSettled) p.failHead(err);
      else p.controller?.error(err);
      clearTimeout(p.timeoutId);
      pending.delete(f.id);
    }
  });

  globalThis.fetch = ((url: string | URL, init?: RequestInit) => {
    const id = crypto.randomUUID();
    const reqUrl = typeof url === 'string' ? url : url.toString();
    return new Promise<Response>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (pending.delete(id)) reject(new Error('Fetch timeout after 60s'));
      }, FETCH_TIMEOUT);
      pending.set(id, {
        controller: null,
        settleHead: resolve,
        failHead: reject,
        headSettled: false,
        timeoutId,
      });
      const headers = normalizeHeaders(init?.headers);
      const frame: PluginFetchRequestFrame = {
        kind: 'plugin.fetchRequest',
        id,
        url: reqUrl,
        init: {
          method: init?.method ?? 'GET',
          ...(headers ? { headers } : {}),
          ...(typeof init?.body === 'string' ? { body: init.body } : {}),
        },
      };
      port.postMessage(frame);
    });
  }) as typeof fetch;
}

function normalizeHeaders(h: RequestInit['headers']): Record<string, string> | undefined {
  if (!h) return undefined;
  if (h instanceof Headers) return Object.fromEntries(h.entries());
  if (Array.isArray(h)) return Object.fromEntries(h);
  return h as Record<string, string>;
}
