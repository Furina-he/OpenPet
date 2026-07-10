import { describe, expect, it } from 'vitest';
import { rerankDocs } from '../electron/main/rerank-client.js';

const target = { apiBase: 'https://x/v1', model: 'bge-reranker', key: 'sk' };

describe('rerank-client（批次⑥，jina/vllm 兼容）', () => {
  it('POST ${apiBase}/rerank 正确 body/头，按 relevance_score 返回重排下标', async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    const fetchImpl = async (url: string | URL, init?: RequestInit): Promise<Response> => {
      captured = { url: String(url), init: init ?? {} };
      return new Response(
        JSON.stringify({
          results: [
            { index: 2, relevance_score: 0.9 },
            { index: 0, relevance_score: 0.5 },
            { index: 1, relevance_score: 0.1 },
          ],
        }),
        { status: 200 },
      );
    };
    const order = await rerankDocs({ fetchImpl }, target, 'q', ['a', 'b', 'c'], 2);
    expect(order).toEqual([2, 0]);
    expect(captured!.url).toBe('https://x/v1/rerank');
    expect((captured!.init.headers as Record<string, string>).authorization).toBe('Bearer sk');
    expect(JSON.parse(String(captured!.init.body))).toEqual({
      model: 'bge-reranker',
      query: 'q',
      documents: ['a', 'b', 'c'],
      top_n: 2,
    });
  });
  it('HTTP 非 200 / 异常 / 超时 → null（调用方回退余弦序）', async () => {
    expect(
      await rerankDocs({ fetchImpl: async () => new Response('x', { status: 500 }) }, target, 'q', ['a'], 1),
    ).toBeNull();
    expect(
      await rerankDocs(
        {
          fetchImpl: async () => {
            throw new Error('net');
          },
        },
        target,
        'q',
        ['a'],
        1,
      ),
    ).toBeNull();
  });
});
