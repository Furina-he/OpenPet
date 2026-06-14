import { getDialect } from '@desksoul/protocol';

/**
 * EmbeddingProvider（tech-design §4.3，与 Chat 分离）。M5 提供实现，消费方在 M8
 * 记忆向量接入。openai 格式批量 data[].embedding；ollama 逐条 /api/embeddings。
 * 返回每条输入对应的向量。fetch 在 Worker 内被 fetch-proxy 替换为经 Main。
 */
export async function embed(
  providerId: string,
  inputs: string[],
  model: string,
  baseUrlOverride?: string,
): Promise<number[][]> {
  const d = getDialect(providerId);
  if (!d) throw new Error(`unknown provider: ${providerId}`);
  const base = baseUrlOverride ?? d.baseUrl;

  if (d.format === 'ollama') {
    const out: number[][] = [];
    for (const input of inputs) {
      const res = await fetch(`${base}/api/embeddings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, prompt: input }),
      });
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
      const json = (await res.json()) as { embedding: number[] };
      out.push(json.embedding);
    }
    return out;
  }

  // openai 格式（含 deepseek/qwen 兼容端点）
  const res = await fetch(`${base}/embeddings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, input: inputs }),
  });
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
  const json = (await res.json()) as { data: Array<{ embedding: number[] }> };
  return json.data.map((d2) => d2.embedding);
}
