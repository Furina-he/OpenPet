/**
 * EmbeddingProvider（tech-design §4.3，与 Chat 分离）。§5 KB / 自动 RAG 接入：
 * 由 worker entry 的 embed.request 分支驱动，format/baseUrl 由调用方（两层 source+model
 * 配置）映射后传入——不再 getDialect（§1 已转两层）。openai 格式批量 data[].embedding；
 * ollama 逐条 /api/embeddings。fetch 在 Worker 内被 fetch-proxy 替换为经 Main（注入 key）。
 */
export async function embed({
  inputs,
  model,
  baseUrl,
  format,
}: {
  inputs: string[];
  model: string;
  baseUrl: string;
  format: 'openai' | 'ollama';
}): Promise<number[][]> {
  if (format === 'ollama') {
    const out: number[][] = [];
    for (const input of inputs) {
      const res = await fetch(`${baseUrl}/api/embeddings`, {
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
  const res = await fetch(`${baseUrl}/embeddings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, input: inputs }),
  });
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
  const json = (await res.json()) as { data: Array<{ embedding: number[] }> };
  return json.data.map((d) => d.embedding);
}
