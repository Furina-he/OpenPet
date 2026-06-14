/**
 * Electron net 适配：把一次流式 HTTP 请求映射为 FetchGateway 的 HttpAgent。
 * 仅生产引用（main/index.ts），不在 vitest 中加载（net 需 Electron 运行时）。
 * 流式：response.on('data') 边收边经 sink.data 吐出。
 */
import { net } from 'electron';
import type { HttpAgent } from './fetch-gateway.js';

export const electronHttpAgent: HttpAgent = (spec, sink) => {
  const req = net.request({ method: spec.method, url: spec.url });
  for (const [k, v] of Object.entries(spec.headers)) req.setHeader(k, v);
  spec.signal.addEventListener('abort', () => req.abort(), { once: true });

  req.on('response', (res) => {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(res.headers)) {
      headers[k] = Array.isArray(v) ? v.join(', ') : String(v);
    }
    sink.head(res.statusCode ?? 0, headers);
    res.on('data', (c: Buffer) => sink.data(c.toString('utf8')));
    res.on('end', () => sink.end());
    res.on('error', (e: Error) => sink.error(e.message));
  });
  req.on('error', (e: Error) => sink.error(e.message));
  req.on('abort', () => sink.error('aborted'));

  if (spec.body !== undefined) req.write(spec.body);
  req.end();
};
