/**
 * Electron net 适配：把一次流式 HTTP 请求映射为 FetchGateway 的 HttpAgent。
 * 仅生产引用（main/index.ts），不在 vitest 中加载（net 需 Electron 运行时）。
 * 流式：response.on('data') 边收边经 sink.data 吐出。
 */
import { net } from 'electron';
import type { HttpAgent } from './fetch-gateway.js';
import type { HttpGetJson } from './provider-service.js';

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

/** GET JSON（provider.* 探活/拉取用）；非 2xx 抛带 status 的 Error，供错误分级。 */
export const electronHttpGetJson: HttpGetJson = (url, headers = {}) =>
  new Promise((resolve, reject) => {
    const req = net.request({ method: 'GET', url });
    for (const [k, v] of Object.entries(headers)) req.setHeader(k, v);
    req.on('response', (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const status = res.statusCode ?? 0;
        const text = Buffer.concat(chunks).toString('utf8');
        if (status < 200 || status >= 300) {
          // 把上游响应体片段带进 error message——4xx 的真因（无效 key / 地区受限 / 端点不对）在 body 里。
          const snippet = text.replace(/\s+/g, ' ').trim().slice(0, 300);
          reject(Object.assign(new Error(`HTTP ${status}${snippet ? `: ${snippet}` : ''}`), { status }));
          return;
        }
        try {
          resolve(JSON.parse(text));
        } catch (err) {
          reject(err);
        }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
