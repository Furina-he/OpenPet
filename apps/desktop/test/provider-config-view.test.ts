import { describe, it, expect } from 'vitest';
import {
  modelsFor,
  buildRows,
  activeModelValue,
  type ProviderRow,
} from '../src/renderer/settings/provider-config-view';

const PROVIDERS: ProviderRow[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    kind: 'chat',
    hasKey: true,
    enabled: true,
    models: ['gpt-4o', 'gpt-4o-mini'],
  },
  { id: 'ollama', name: 'Ollama', kind: 'chat', hasKey: false, enabled: true, models: [] },
];

describe('provider-config-view（纯）', () => {
  it('modelsFor：ollama 有检测结果时用检测列表，否则用 provider.models', () => {
    expect(modelsFor(PROVIDERS, [], 'openai')).toEqual(['gpt-4o', 'gpt-4o-mini']);
    expect(modelsFor(PROVIDERS, ['llama3', 'qwen2'], 'ollama')).toEqual(['llama3', 'qwen2']);
    expect(modelsFor(PROVIDERS, [], 'ollama')).toEqual([]);
  });
  it('buildRows：当前 provider 用已选 activeModel，余用各自首个模型', () => {
    const rows = buildRows(PROVIDERS, 'openai', 'gpt-4o-mini', [], { openai: false });
    expect(rows[0]).toEqual({
      id: 'openai',
      name: 'OpenAI',
      model: 'gpt-4o-mini',
      hasKey: true,
      lastTestOk: false,
    });
    expect(rows[1]!.model).toBe(''); // ollama 无模型
    expect(rows[1]!.lastTestOk).toBeNull(); // 未测
  });
  it('activeModelValue：已选模型属当前列表则用它，否则回退首个', () => {
    expect(activeModelValue(['gpt-4o', 'gpt-4o-mini'], 'gpt-4o-mini')).toBe('gpt-4o-mini');
    expect(activeModelValue(['gpt-4o'], 'nonexistent')).toBe('gpt-4o');
    expect(activeModelValue([], 'x')).toBe('');
  });
});
