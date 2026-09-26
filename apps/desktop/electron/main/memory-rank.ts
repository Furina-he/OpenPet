/**
 * ㉔ 记忆 v3 块级混合检索的纯函数（spec 2026-09-26-memory-v3-design §3.2）：分词 / BM25 / RRF /
 * 向量相似度门 / 新近度。零依赖——分词用 `Intl.Segmenter('zh', {granularity: 'word'})`，外加中文连续段的
 * 字二元组兜底分词错误（如「吃香｜菜」里的「香菜」）。设计参考 LivingMemory 调研笔记 §5，未复制其代码。
 */

/** BM25 参数。 */
export const BM25_K1 = 1.2;
export const BM25_B = 0.75;
/** 字二元组相对词元的权重。 */
export const GRAM_WEIGHT = 0.5;
/** RRF 常数。 */
export const RRF_K = 60;
/** 相似度门的边距：得分须明显高于本次查询在库里的中位数。 */
export const VECTOR_GATE_MARGIN = 0.12;
/** 块数少于此数时中位数不可靠，门 = 最低分 + 边距。 */
export const VECTOR_GATE_MIN_DOCS = 5;

/** 虚词 / 语气词 / 代词（单字也用于过滤二元组：含任一单字停用词的二元组不要）。 */
const STOPWORDS = new Set(
  (
    '的 了 是 我 你 他 她 它 们 在 和 与 及 就 都 也 吗 呢 吧 啊 呀 哈 嗯 哦 噢 喔 嘛 啦 哎 唉 诶 呃 ' +
    '这 那 有 没 不 很 还 又 要 会 能 想 去 来 说 着 过 被 把 给 让 对 从 到 向 但 而 或 如 若 ' +
    '一 个 些 点 下 上 里 啥 么 怎 哪 谁 呐 咯 嘿 嘻 ' +
    '我们 你们 他们 她们 它们 这个 那个 这些 那些 这样 那样 什么 怎么 怎样 为什么 一个 一下 一点 ' +
    '没有 可以 就是 还是 但是 因为 所以 如果 然后 而且 或者 已经 知道 觉得 真的 其实 哈哈 哈哈哈 嗯嗯 ' +
    '时候 什么时候 记得 还记得 ' +
    'a an the is am are was were be been being to of and or in on at for with by from as it its ' +
    'this that these those i me my you your he him his she her we us our they them their ' +
    'do does did done not no yes so just ok okay oh ah hmm lol haha what how why who which'
  ).split(/\s+/),
);

const HAN_RUN_RE = /\p{Script=Han}+/gu;
const WORDLIKE_RE = /[\p{L}\p{N}]/u;
const FALLBACK_RE = /[\p{L}\p{N}]+/gu;

type Segmenter = { segment(s: string): Iterable<{ segment: string; isWordLike?: boolean }> };
let segmenter: Segmenter | null | undefined;
function getSegmenter(): Segmenter | null {
  if (segmenter !== undefined) return segmenter;
  try {
    const Ctor = (Intl as unknown as { Segmenter?: new (l: string, o: object) => Segmenter })
      .Segmenter;
    segmenter = Ctor ? new Ctor('zh', { granularity: 'word' }) : null;
  } catch {
    segmenter = null;
  }
  return segmenter;
}

/** 测试用：强制走无 Segmenter 的正则退化路径。 */
export function __setSegmenterForTest(s: Segmenter | null | undefined): void {
  segmenter = s;
}

export interface Tokens {
  /** 词元（去停用词）。 */
  words: string[];
  /** 中文连续段的字二元组（含单字停用词的不要）。 */
  grams: string[];
}

/** NFKC + 小写 → 词元 + 字二元组。 */
export function tokenize(text: string): Tokens {
  const norm = text.normalize('NFKC').toLowerCase();
  const words: string[] = [];
  const seg = getSegmenter();
  if (seg) {
    for (const s of seg.segment(norm)) {
      const w = s.segment.trim();
      if (!w || s.isWordLike === false || !WORDLIKE_RE.test(w)) continue;
      if (!STOPWORDS.has(w)) words.push(w);
    }
  } else {
    for (const m of norm.matchAll(FALLBACK_RE)) if (!STOPWORDS.has(m[0])) words.push(m[0]);
  }
  const grams: string[] = [];
  for (const m of norm.matchAll(HAN_RUN_RE)) {
    const run = [...m[0]];
    for (let i = 0; i + 1 < run.length; i++) {
      const a = run[i]!;
      const b = run[i + 1]!;
      if (STOPWORDS.has(a) || STOPWORDS.has(b)) continue;
      grams.push(a + b);
    }
  }
  return { words, grams };
}

/** 查询里有没有实词（「是吗？」「哈哈」= 没有 → 不检索）。 */
export function hasTerms(t: Tokens): boolean {
  return t.words.length > 0 || t.grams.length > 0;
}

function termWeights(t: Tokens): Map<string, number> {
  const m = new Map<string, number>();
  for (const w of t.words) m.set(`w:${w}`, 1);
  for (const g of t.grams) if (!m.has(`g:${g}`)) m.set(`g:${g}`, GRAM_WEIGHT);
  return m;
}

export interface Bm25Index {
  search(query: string): Array<{ id: string; score: number }>;
}

/** BM25（k1 1.2 / b 0.75；词元权重 1.0、二元组 0.5；IDF 取恒正形式）。 */
export function createBm25(docs: ReadonlyArray<{ id: string; text: string }>): Bm25Index {
  const tfs = docs.map((d) => {
    const t = tokenize(d.text);
    const tf = new Map<string, number>();
    for (const w of t.words) tf.set(`w:${w}`, (tf.get(`w:${w}`) ?? 0) + 1);
    for (const g of t.grams) tf.set(`g:${g}`, (tf.get(`g:${g}`) ?? 0) + 1);
    return { id: d.id, tf, len: t.words.length + t.grams.length };
  });
  const n = tfs.length;
  const avgdl = n ? tfs.reduce((s, d) => s + d.len, 0) / n || 1 : 1;
  const df = new Map<string, number>();
  for (const d of tfs) for (const k of d.tf.keys()) df.set(k, (df.get(k) ?? 0) + 1);
  const idf = (k: string): number => {
    const f = df.get(k) ?? 0;
    return Math.log(1 + (n - f + 0.5) / (f + 0.5));
  };
  return {
    search(query: string): Array<{ id: string; score: number }> {
      const q = termWeights(tokenize(query));
      if (q.size === 0 || n === 0) return [];
      const out: Array<{ id: string; score: number }> = [];
      for (const d of tfs) {
        let score = 0;
        for (const [k, w] of q) {
          const f = d.tf.get(k);
          if (!f) continue;
          const norm = f + BM25_K1 * (1 - BM25_B + (BM25_B * d.len) / avgdl);
          score += w * idf(k) * ((f * (BM25_K1 + 1)) / norm);
        }
        if (score > 0) out.push({ id: d.id, score });
      }
      return out.sort((a, b) => b.score - a.score);
    },
  };
}

/** Reciprocal Rank Fusion：各路排名（1 起）求和 1/(k + rank)。 */
export function rrfFuse(
  lists: ReadonlyArray<readonly string[]>,
  k = RRF_K,
): Array<{ id: string; score: number }> {
  const acc = new Map<string, number>();
  for (const list of lists)
    list.forEach((id, i) => acc.set(id, (acc.get(id) ?? 0) + 1 / (k + i + 1)));
  return [...acc.entries()].map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score);
}

export function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * 相似度门 = max(最低分, 本次查询对全部块得分的中位数 + 边距)；块数 < 5 时 = 最低分 + 边距。
 * 「明显高于库里的平均水平」——对整体偏高的 bge 系与整体偏低的 OpenAI 系都自适应。
 */
export function vectorGate(
  scores: readonly number[],
  minScore: number,
  margin = VECTOR_GATE_MARGIN,
): number {
  if (scores.length < VECTOR_GATE_MIN_DOCS) return minScore + margin;
  return Math.max(minScore, median(scores) + margin);
}

/** 新近度：1 + 0.15 × 0.5^(距今天数 / 60)；日期非法 / 晚于今天按今天。 */
export function recencyBoost(date: string, today: string): number {
  const d = Date.parse(`${date}T00:00:00Z`);
  const t = Date.parse(`${today}T00:00:00Z`);
  const days = Number.isFinite(d) && Number.isFinite(t) ? Math.max(0, (t - d) / 86_400_000) : 0;
  return 1 + 0.15 * 0.5 ** (days / 60);
}
