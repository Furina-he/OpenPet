/**
 * rerank 客户端（批次⑥）——jina/vllm/cohere 兼容：POST ${apiBase}/rerank
 * {model, query, documents, top_n} → results[{index, relevance_score}]（照 AstrBot
 * vllm_rerank_source）。Main 直调（FetchLike 注入，同 voice-service 模式）；
 * 任何失败/超时(3s) → null，调用方回退余弦序——rerank 永不阻断检索。
 *
 * FetchLike 是结构化最小面（与 voice-service 同款，net.fetch/全局 fetch/测试 fake 均满足）；
 * memory-extractor（T4）复用本类型。
 */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

export interface RerankTarget {
  apiBase: string;
  model: string;
  key: string;
}

const RERANK_TIMEOUT_MS = 3000;

export async function rerankDocs(
  deps: { fetchImpl: FetchLike },
  target: RerankTarget,
  query: string,
  documents: string[],
  topN: number,
): Promise<number[] | null> {
  try {
    const res = await Promise.race([
      deps.fetchImpl(`${target.apiBase}/rerank`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(target.key ? { authorization: `Bearer ${target.key}` } : {}),
        },
        body: JSON.stringify({ model: target.model, query, documents, top_n: topN }),
      }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), RERANK_TIMEOUT_MS)),
    ]);
    if (!res || !res.ok) return null;
    const json = (await res.json()) as {
      results?: Array<{ index?: number; relevance_score?: number }>;
    };
    if (!Array.isArray(json.results)) return null;
    return json.results
      .filter((r) => typeof r.index === 'number')
      .sort((a, b) => (b.relevance_score ?? 0) - (a.relevance_score ?? 0))
      .slice(0, topN)
      .map((r) => r.index!);
  } catch {
    return null;
  }
}
