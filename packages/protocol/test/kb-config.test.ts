import { describe, it, expect } from 'vitest';
import { KbSchema } from '../src/kb-config.js';

describe('KbSchema', () => {
  it('默认 emoji/chunkSize/overlap/topK/active/counts', () => {
    const k = KbSchema.parse({ id: 'k1', name: '资料' });
    expect(k).toMatchObject({
      emoji: '📚',
      chunkSize: 512,
      chunkOverlap: 50,
      topK: 5,
      active: true,
      docCount: 0,
      chunkCount: 0,
      embeddingModelId: '',
    });
  });
});
