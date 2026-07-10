import { describe, it, expect } from 'vitest';
import { MemoryStore } from '../../electron/main/db/memory-store';

describe('KB store（MemoryStore）', () => {
  it('insert chunks → kbChunks 返回（含向量）→ deleteDoc 清理', () => {
    const s = new MemoryStore();
    s.kbInsertChunks('k1', 'd1', 'a.md', [
      { ord: 0, text: 'hello', vector: [1, 0] },
      { ord: 1, text: 'world', vector: [0, 1] },
    ]);
    expect(s.kbChunks(['k1']).map((c) => c.text)).toEqual(['hello', 'world']);
    expect(s.kbChunks(['k1'])[0]!.vector).toEqual([1, 0]);
    expect(s.kbDocs('k1').map((d) => d.filename)).toEqual(['a.md']);
    expect(s.kbDocs('k1')[0]!.chunkCount).toBe(2);
    s.kbDeleteDoc('k1', 'd1');
    expect(s.kbChunks(['k1'])).toEqual([]);
    expect(s.kbDocs('k1')).toEqual([]);
  });
  it('kbChunks 多库合并', () => {
    const s = new MemoryStore();
    s.kbInsertChunks('k1', 'd1', 'a', [{ ord: 0, text: 'x', vector: [1] }]);
    s.kbInsertChunks('k2', 'd2', 'b', [{ ord: 0, text: 'y', vector: [1] }]);
    expect(s.kbChunks(['k1', 'k2'])).toHaveLength(2);
    expect(s.kbChunks(['k1'])).toHaveLength(1);
  });
});
