import { describe, expect, it } from 'vitest';
import {
  MemoryFactSchema,
  KbSchema,
  Methods,
  resolveRerankTarget,
  type ProviderSource,
  type ModelEntry,
} from '../src/index.js';

describe('批次⑥ protocol', () => {
  it('MemoryFactSchema 解析', () => {
    expect(
      MemoryFactSchema.safeParse({ id: 1, text: '用户喜欢猫', pinned: false, createdAt: 1 }).success,
    ).toBe(true);
    expect(MemoryFactSchema.safeParse({ id: 1, text: '', pinned: false, createdAt: 1 }).success).toBe(false);
  });
  it('KbSchema rerank 默认 false（旧数据兼容）', () => {
    const kb = KbSchema.parse({ id: 'k', name: 'n' });
    expect(kb.rerank).toBe(false);
  });
  it('resolveRerankTarget：默认 rerank 模型 → target；未配 → null', () => {
    const sources = [
      { id: 's1', name: 'S', adapter: 'openai', apiBase: 'https://x/v1', key: 'k', enabled: true },
    ] as unknown as ProviderSource[];
    const models = [
      { id: 'm1', sourceId: 's1', model: 'bge-reranker', enabled: true },
    ] as unknown as ModelEntry[];
    expect(resolveRerankTarget(sources, models, 'm1')?.model).toBe('bge-reranker');
    expect(resolveRerankTarget(sources, models, '')).toBeNull();
  });
  it('methods 注册齐全', () => {
    for (const m of [
      'memory.list',
      'memory.add',
      'memory.delete',
      'memory.setPinned',
      'memory.clear',
      'kb.importFile',
      'app.importData',
      'app.relaunch',
      'app.openDataDir',
      'app.usageSummary',
      'app.clearMessages',
      'app.exportDataPick',
    ] as const)
      expect(Methods[m]).toBeDefined();
  });
});
