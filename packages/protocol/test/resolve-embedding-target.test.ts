import { describe, it, expect } from 'vitest';
import { resolveEmbeddingTarget } from '../src/provider-config.js';

const sources = [{ id: 's1', adapter: 'openai', apiBase: 'http://x/v1', enabled: true } as never];
const models = [
  { id: 'm1', sourceId: 's1', model: 'text-embedding-3-small', enabled: true } as never,
];

describe('resolveEmbeddingTarget', () => {
  it('按 embeddingModelId 解析 source+model', () => {
    expect(resolveEmbeddingTarget(sources, models, 'm1')).toMatchObject({
      sourceId: 's1',
      adapter: 'openai',
      apiBase: 'http://x/v1',
      model: 'text-embedding-3-small',
    });
  });
  it('缺失/disabled → null', () => {
    expect(resolveEmbeddingTarget(sources, models, '')).toBeNull();
    expect(resolveEmbeddingTarget(sources, models, 'nope')).toBeNull();
  });
});
