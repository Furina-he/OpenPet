// S5.2 — worker-side fetch proxy.
//
// Inside a sandboxed Provider Worker the real network stack is unreachable: the
// worker runs with `env: {}` (no secrets) and `--permission` (no ambient fs/net
// trust). So `globalThis.fetch` is replaced with a thin proxy that marshals every
// request over the MessagePort to the Main-side PluginHost, which is the ONLY
// place that knows the host whitelist and holds the decrypted API keys.
//
// Wire protocol (worker ⇄ host), all JSON-serializable frames:
//   worker → host : { kind:'fetch', id, url, init:{method,headers,body} }
//   host → worker : { kind:'fetch.result', id, ok:true,  status, body }
//                 | { kind:'fetch.result', id, ok:false, error }
//
// The handler filters strictly by (kind === 'fetch.result' && id), so it never
// swallows the worker's own control messages (`init` / `run`) sharing the port.
import { parentPort } from 'node:worker_threads';

/** Replace globalThis.fetch with a MessagePort proxy to the Main PluginHost. */
export function installFetchProxy() {
  if (!parentPort) throw new Error('installFetchProxy must run inside a worker');
  const port = parentPort;

  globalThis.fetch = (input, init = {}) =>
    new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const handler = (msg) => {
        if (!msg || msg.kind !== 'fetch.result' || msg.id !== id) return;
        port.off('message', handler);
        if (!msg.ok) {
          reject(new Error(msg.error));
          return;
        }
        // 204/205/304 are null-body statuses — the Response ctor rejects ANY
        // body (even '') for them, so coerce to null.
        const nullBody = msg.status === 204 || msg.status === 205 || msg.status === 304;
        resolve(new Response(nullBody ? null : msg.body, { status: msg.status }));
      };
      port.on('message', handler);
      port.postMessage({
        kind: 'fetch',
        id,
        url: String(input),
        init: {
          method: init.method ?? 'GET',
          headers: init.headers ?? {},
          body: init.body ?? null,
        },
      });
    });
}
