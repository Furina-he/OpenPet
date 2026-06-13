import type { MessagePort } from 'node:worker_threads';

let proxyInstalled = false;
const FETCH_TIMEOUT = 30000; // 30 seconds

interface PendingRequest {
  resolve: (r: Response) => void;
  reject: (e: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

export function installFetchProxy(port: MessagePort): void {
  if (proxyInstalled) return;
  proxyInstalled = true;

  const pending = new Map<string, PendingRequest>();

  port.on('message', (msg: unknown) => {
    // 类型守卫
    if (typeof msg !== 'object' || !msg || !('kind' in msg)) return;
    if (msg.kind !== 'plugin.fetchResponse') return;

    const response = msg as {
      kind: 'plugin.fetchResponse';
      id: string;
      ok: boolean;
      status?: number;
      headers?: Record<string, string>;
      body?: string;
      error?: string;
    };

    const p = pending.get(response.id);
    if (!p) return;

    clearTimeout(p.timeoutId); // 清理超时
    pending.delete(response.id);

    if (!response.ok) {
      p.reject(new Error(response.error ?? 'Fetch failed'));
      return;
    }

    const res = new Response(response.body, {
      status: response.status ?? 200,
      ...(response.headers ? { headers: response.headers } : {}),
    });
    p.resolve(res);
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((url: string | URL, init?: RequestInit) => {
    const id = crypto.randomUUID();
    const reqUrl = typeof url === 'string' ? url : url.toString();

    return new Promise<Response>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        const p = pending.get(id);
        if (p) {
          pending.delete(id);
          p.reject(new Error('Fetch timeout after 30s'));
        }
      }, FETCH_TIMEOUT);

      pending.set(id, { resolve, reject, timeoutId });

      port.postMessage({
        kind: 'plugin.fetchRequest',
        id,
        url: reqUrl,
        init: {
          method: init?.method ?? 'GET',
          headers: init?.headers,
          body: init?.body,
        },
      });
    });
  }) as typeof originalFetch;
}
