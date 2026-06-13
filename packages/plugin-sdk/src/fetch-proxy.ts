import type { MessagePort } from 'node:worker_threads';

let proxyInstalled = false;

export function installFetchProxy(port: MessagePort): void {
  if (proxyInstalled) return;
  proxyInstalled = true;

  const pending = new Map<string, { resolve: (r: Response) => void; reject: (e: Error) => void }>();

  port.on('message', (msg: any) => {
    if (msg.kind !== 'plugin.fetchResponse') return;
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);

    if (!msg.ok) {
      p.reject(new Error(msg.error ?? 'Fetch failed'));
      return;
    }

    const response = new Response(msg.body, {
      status: msg.status ?? 200,
      headers: msg.headers,
    });
    p.resolve(response);
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((url: string | URL, init?: RequestInit) => {
    const id = crypto.randomUUID();
    const reqUrl = typeof url === 'string' ? url : url.toString();

    return new Promise<Response>((resolve, reject) => {
      pending.set(id, { resolve, reject });
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
