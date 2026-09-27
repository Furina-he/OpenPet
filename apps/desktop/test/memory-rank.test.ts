import { afterEach, describe, expect, it } from 'vitest';
import {
  __setSegmenterForTest,
  createBm25,
  hasTerms,
  median,
  recencyBoost,
  rrfFuse,
  tokenize,
  vectorGate,
} from '../electron/main/memory-rank.js';

afterEach(() => __setSegmenterForTest(undefined));

describe('㉔ memory-rank 分词', () => {
  it('中文词元 + 字二元组；停用词去掉；含单字停用词的二元组不要', () => {
    const t = tokenize('我不吃香菜');
    expect(t.words).toContain('香菜');
    expect(t.words).not.toContain('我');
    expect(t.grams).toEqual(['吃香', '香菜']); // 「我不」「不吃」含停用词
  });

  it('无实词的输入：「是吗？」「哈哈」→ 空', () => {
    expect(hasTerms(tokenize('是吗？'))).toBe(false);
    expect(hasTerms(tokenize('哈哈'))).toBe(false);
    expect(hasTerms(tokenize('爬山'))).toBe(true);
  });

  it('英文小写 + NFKC（全角转半角）', () => {
    expect(tokenize('Ｈｅｌｌｏ World 2026').words).toEqual(['hello', 'world', '2026']);
    expect(tokenize('The cat is here').words).toEqual(['cat', 'here']);
  });

  it('Segmenter 不可用：正则退化切词，二元组照旧兜底', () => {
    __setSegmenterForTest(null);
    const t = tokenize('王小明去爬山 hiking');
    expect(t.words).toEqual(['王小明去爬山', 'hiking']);
    expect(t.grams).toContain('爬山');
    expect(t.grams).toContain('小明');
  });
});

describe('㉔ memory-rank BM25', () => {
  it('命中词的文档排前；未命中 0 分不返回；二元组兜底分词错误', () => {
    const bm = createBm25([
      { id: 'a', text: '用户档案 · 喜好厌恶\n不吃香菜，喜欢辣' },
      { id: 'b', text: '共同经历 · 2026-03-01\n我们去爬山了' },
      { id: 'c', text: '王小明\n大学室友' },
    ]);
    expect(bm.search('香菜').map((x) => x.id)).toEqual(['a']);
    expect(bm.search('周末爬山').map((x) => x.id)).toEqual(['b']);
    expect(bm.search('天气')).toEqual([]);
    expect(bm.search('是吗？')).toEqual([]);
  });

  it('长度归一：同样命中一次，短文档得分更高', () => {
    const bm = createBm25([
      { id: 'short', text: '爬山' },
      { id: 'long', text: `爬山 ${'散步 跑步 游泳 骑车 滑雪 '.repeat(10)}` },
      { id: 'other', text: '看书' },
    ]);
    const r = bm.search('爬山');
    expect(r.map((x) => x.id)).toEqual(['short', 'long']);
    expect(r[0]!.score).toBeGreaterThan(r[1]!.score);
  });

  it('同一个词：更短的文档排前', () => {
    const bm = createBm25([
      { id: 'word', text: '香菜' },
      { id: 'gram', text: '吃香菜' }, // 较长文档：长度归一后得分更低
      { id: 'x', text: '别的' },
    ]);
    const r = bm.search('香菜');
    expect(r[0]!.id).toBe('word');
  });
});

describe('㉔ memory-rank 融合 / 门 / 新近度', () => {
  it('RRF：两路都中的排前；单路按名次', () => {
    const r = rrfFuse([
      ['a', 'b', 'c'],
      ['c', 'a'],
    ]);
    expect(r.map((x) => x.id)).toEqual(['a', 'c', 'b']);
    expect(r[0]!.score).toBeCloseTo(1 / 61 + 1 / 62, 10);
  });

  it('中位数', () => {
    expect(median([])).toBe(0);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });

  it('相似度门：中位数 + 边距 与最低分取大；小库 = 最低分 + 边距', () => {
    // bge 系整体偏高：中位数 0.6 → 门 0.72
    expect(vectorGate([0.55, 0.6, 0.6, 0.62, 0.9], 0.25)).toBeCloseTo(0.72, 10);
    // OpenAI 系整体偏低：中位数 0.05 → 门取最低分 0.25
    expect(vectorGate([0.02, 0.04, 0.05, 0.06, 0.4], 0.25)).toBe(0.25);
    expect(vectorGate([0.9, 0.1], 0.25)).toBeCloseTo(0.37, 10);
  });

  it('新近度：今天 1.15，60 天前 1.075，很久以前趋近 1；未来日期按今天', () => {
    expect(recencyBoost('2026-09-27', '2026-09-27')).toBeCloseTo(1.15, 10);
    expect(recencyBoost('2026-07-29', '2026-09-27')).toBeCloseTo(1.075, 10);
    expect(recencyBoost('2020-01-01', '2026-09-27')).toBeLessThan(1.001);
    expect(recencyBoost('2027-01-01', '2026-09-27')).toBeCloseTo(1.15, 10);
  });
});
