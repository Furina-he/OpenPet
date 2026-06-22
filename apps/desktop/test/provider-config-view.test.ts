import { describe, it, expect } from 'vitest';
import {
  sourcesForTab,
  modelsForSource,
  mergedModelEntries,
  capsBadges,
  formatContextLimit,
  defaultPrefKeyFor,
  fetchOutcomeMessage,
} from '../src/renderer/settings/provider-config-view';
import type { ProviderSource, ModelEntry } from '@desksoul/protocol';

const sources: ProviderSource[] = [
  { id: 'openai-main', adapter: 'openai', capability: 'chat', apiBase: 'b1', key: '', enabled: true },
  { id: 'voice', adapter: 'openai', capability: 'tts', apiBase: 'b2', key: '', enabled: true },
];
const models: ModelEntry[] = [
  {
    id: 'openai-main/gpt-4o',
    sourceId: 'openai-main',
    model: 'gpt-4o',
    enabled: true,
    caps: { vision: true, tool: true },
    contextTokens: 128000,
  },
];

describe('provider-config-view（两层，纯）', () => {
  it('sourcesForTab filters by capability', () => {
    expect(sourcesForTab(sources, 'chat').map((s) => s.id)).toEqual(['openai-main']);
    expect(sourcesForTab(sources, 'tts').map((s) => s.id)).toEqual(['voice']);
  });
  it('modelsForSource filters by sourceId', () => {
    expect(modelsForSource(models, 'openai-main')).toHaveLength(1);
    expect(modelsForSource(models, 'voice')).toEqual([]);
  });
  it('mergedModelEntries puts configured first, drops dup available', () => {
    const merged = mergedModelEntries(models, ['gpt-4o', 'gpt-4o-mini']);
    expect(merged.map((e) => [e.type, e.model])).toEqual([
      ['configured', 'gpt-4o'],
      ['available', 'gpt-4o-mini'],
    ]);
  });
  it('capsBadges + formatContextLimit', () => {
    expect(capsBadges({ vision: true, tool: true, reasoning: false }, 128000)).toEqual([
      'vision',
      'tool',
      '128K',
    ]);
    expect(formatContextLimit(1_000_000)).toBe('1M');
    expect(formatContextLimit(undefined)).toBe('');
  });
  it('defaultPrefKeyFor maps capability → pref key', () => {
    expect(defaultPrefKeyFor('chat')).toBe('model.defaultChatModelId');
    expect(defaultPrefKeyFor('embedding')).toBe('model.defaultEmbeddingModelId');
  });

  it('fetchOutcomeMessage reports counts and classifies errors', () => {
    expect(fetchOutcomeMessage({ count: 3 })).toBe('拉取到 3 个模型');
    expect(fetchOutcomeMessage({ count: 0 })).toContain('未找到模型');
    expect(fetchOutcomeMessage({ error: Object.assign(new Error('x'), { status: 401 }) })).toContain(
      'HTTP 401',
    );
    expect(
      fetchOutcomeMessage({ error: Object.assign(new Error('x'), { status: 401 }) }),
    ).toContain('API Key');
    expect(fetchOutcomeMessage({ error: Object.assign(new Error('x'), { status: 500 }) })).toContain(
      'HTTP 500',
    );
    expect(fetchOutcomeMessage({ error: new Error('ECONNREFUSED') })).toContain('ECONNREFUSED');
  });

  it('fetchOutcomeMessage recovers status from IPC-wrapped messages (status prop lost)', () => {
    const ipc = new Error(
      "Error invoking remote method 'desksoul:rpc': Error: HTTP 403: { error: region not supported }",
    );
    const msg = fetchOutcomeMessage({ error: ipc });
    expect(msg).toContain('HTTP 403');
    expect(msg).toContain('地区'); // 地区受限提示
    expect(msg).not.toContain('invoking remote method'); // IPC 包装前缀已剥掉
  });
});
