import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProviderHost } from '../electron/main/provider-host';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EMBED_ENTRY = path.join(__dirname, 'fixtures/embed-worker.mjs');

let host: ProviderHost | null = null;
afterEach(async () => {
  await host?.dispose();
  host = null;
});

describe('ProviderHost.embed（§5 EmbeddingBridge）', () => {
  it('embed.request → embed.result 解析为向量', async () => {
    host = new ProviderHost(EMBED_ENTRY, () => {});
    const vectors = await host.embed(['a', 'bb'], { model: 'mod' });
    expect(vectors).toEqual([
      [1, 3],
      [2, 3],
    ]);
  });

  it('embed.error → reject', async () => {
    host = new ProviderHost(EMBED_ENTRY, () => {});
    await expect(host.embed(['__error__'], { model: 'm' })).rejects.toThrow(/boom/);
  });

  it('worker 不回复 → 超时 reject', async () => {
    host = new ProviderHost(EMBED_ENTRY, () => {}, { embedTimeoutMs: 50 });
    await expect(host.embed(['__hang__'], { model: 'm' })).rejects.toThrow(/timeout|timed out/i);
  });

  it('多个并发 embed 各自按 requestId 解析', async () => {
    host = new ProviderHost(EMBED_ENTRY, () => {});
    const [r1, r2] = await Promise.all([
      host.embed(['xyz'], { model: 'm1' }),
      host.embed(['ab'], { model: 'mm' }),
    ]);
    expect(r1).toEqual([[3, 2]]);
    expect(r2).toEqual([[2, 2]]);
  });
});
