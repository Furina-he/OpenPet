import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/**
 * M5 验收：「Worker 内 secrets 读不到」。
 * 密钥注入只发生在 Main 的 provider-config（经 FetchGateway 出网那一刻）；Worker
 * env:{} 且不自行读环境变量取密钥、不自行拼 Authorization 头。这里做静态断言兜底。
 */
describe('M5 secret isolation', () => {
  it('provider worker entry does not read process.env for secrets', () => {
    const entry = require.resolve('@openpet/sidecar/dist/workers/provider-worker-entry.js');
    const src = readFileSync(entry, 'utf8');
    expect(src).not.toMatch(/process\.env\.[A-Z_]*KEY/);
    expect(src).not.toMatch(/process\.env\.[A-Z_]*TOKEN/);
  });

  it('openai-compat provider does not inject Authorization itself (Main injects)', () => {
    const f = require.resolve('@openpet/sidecar/dist/workers/providers/openai-compat.js');
    const src = readFileSync(f, 'utf8');
    expect(src.toLowerCase()).not.toContain('authorization');
    expect(src).not.toContain('Bearer ');
  });
});
