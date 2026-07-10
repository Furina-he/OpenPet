import { describe, it, expect } from 'vitest';
import { cosineTopK, type Vectored } from '../electron/main/kb-search';

const items: Vectored<{ id: string }>[] = [
  { meta: { id: 'a' }, vector: [1, 0] },
  { meta: { id: 'b' }, vector: [0, 1] },
  { meta: { id: 'c' }, vector: [0.9, 0.1] },
];

describe('cosineTopK', () => {
  it('按余弦相似降序取 topK', () => {
    const r = cosineTopK(items, [1, 0], 2);
    expect(r.map((x) => x.meta.id)).toEqual(['a', 'c']);
    expect(r[0]!.score).toBeCloseTo(1, 5);
  });
  it('topK 超量 → 全返', () => {
    expect(cosineTopK(items, [1, 0], 10)).toHaveLength(3);
  });
  it('零向量安全（不 NaN）', () => {
    const r = cosineTopK([{ meta: { id: 'z' }, vector: [0, 0] }], [1, 0], 1);
    expect(r[0]!.score).toBe(0);
  });
});
