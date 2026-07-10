import { describe, it, expect, afterEach, vi } from 'vitest';
import { embed } from '../src/workers/providers/embedding.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('embed', () => {
  it('openai format returns vectors from data[].embedding', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2] }] }), { status: 200 }),
    ) as typeof fetch;
    const v = await embed({
      inputs: ['hi'],
      model: 'text-embedding-3-small',
      baseUrl: 'http://x/v1',
      format: 'openai',
    });
    expect(v).toEqual([[0.1, 0.2]]);
  });

  it('ollama format returns embedding from /api/embeddings', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify({ embedding: [0.3, 0.4] }), { status: 200 }),
    ) as typeof fetch;
    const v = await embed({
      inputs: ['hi'],
      model: 'nomic-embed-text',
      baseUrl: 'http://x',
      format: 'ollama',
    });
    expect(v).toEqual([[0.3, 0.4]]);
  });

  it('throws with status on non-2xx', async () => {
    globalThis.fetch = vi.fn(async () => new Response(null, { status: 401 })) as typeof fetch;
    await expect(
      embed({ inputs: ['x'], model: 'm', baseUrl: 'http://x/v1', format: 'openai' }),
    ).rejects.toThrow();
  });
});
