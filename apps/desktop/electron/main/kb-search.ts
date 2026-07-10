export interface Vectored<M> {
  meta: M;
  vector: number[];
}
export interface Scored<M> {
  meta: M;
  score: number;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** 暴力余弦 top-k（= AstrBot FAISS IndexFlatL2 的等价；MVP 全量扫描）。 */
export function cosineTopK<M>(items: Vectored<M>[], query: number[], topK: number): Scored<M>[] {
  return items
    .map((it) => ({ meta: it.meta, score: cosine(it.vector, query) }))
    .sort((x, y) => y.score - x.score)
    .slice(0, topK);
}

/** 单对余弦（memory 去重/检索共用；cosineTopK 内部同式）。 */
export function cosineSim(a: number[], b: number[]): number {
  return cosine(a, b);
}
