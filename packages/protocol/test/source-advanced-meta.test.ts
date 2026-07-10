import { describe, it, expect } from 'vitest';
import { sourceAdvancedMeta } from '../src/provider-config.js';

describe('sourceAdvancedMeta', () => {
  it('通用 source 高级字段：timeoutMs/proxy/headers，全 advanced', () => {
    const items = sourceAdvancedMeta('openai');
    expect(items.map((m) => m.key)).toEqual(['timeoutMs', 'proxy', 'headers']);
    expect(items.every((m) => m.advanced)).toBe(true);
    expect(items.find((m) => m.key === 'headers')?.type).toBe('dict');
  });
  it('ollama 多一项 ollamaDisableThinking(bool)', () => {
    const keys = sourceAdvancedMeta('ollama').map((m) => m.key);
    expect(keys).toContain('ollamaDisableThinking');
    expect(sourceAdvancedMeta('ollama').find((m) => m.key === 'ollamaDisableThinking')?.type).toBe(
      'bool',
    );
  });
});
