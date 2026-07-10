import { describe, it, expect } from 'vitest';
import { chunkText } from '../electron/main/kb-chunk';

describe('chunkText', () => {
  it('短文本 → 单块', () => {
    expect(chunkText('hello', 100, 10)).toEqual(['hello']);
  });
  it('超长 → 多块带重叠', () => {
    const text = 'a'.repeat(250);
    const chunks = chunkText(text, 100, 20);
    expect(chunks.length).toBe(3); // 0-100, 80-180, 160-250(+尾)
    expect(chunks[0]!.length).toBe(100);
    // 重叠：块2 起点 = 块1 末尾前 20 字符
    expect(chunks[1]!.startsWith('a')).toBe(true);
  });
  it('空/空白 → 空数组', () => {
    expect(chunkText('   ', 100, 10)).toEqual([]);
  });
  it('段落优先：双换行先分段', () => {
    const chunks = chunkText('para one\n\npara two', 100, 10);
    expect(chunks).toEqual(['para one', 'para two']);
  });
});
