import { describe, expect, it } from 'vitest';
import type { ModelEntry, ProviderSource, ProviderTemplate } from '@openpet/protocol';
import {
  buildModelEntry,
  capBadges,
  formatContextLimit,
  hostOf,
  manualModelPreview,
  sourceEquals,
  templateCards,
  workbenchEntries,
} from '../src/renderer/settings/provider-workbench.js';

const src = (over: Partial<ProviderSource> = {}): ProviderSource => ({
  id: 'openai',
  adapter: 'openai',
  capability: 'chat',
  apiBase: 'https://api.openai.com/v1',
  key: 'k',
  enabled: true,
  ...over,
});

describe('provider-workbench（模型供应商工作台纯逻辑）', () => {
  it('sourceEquals：规范化后比较——空 config/headers、空串 proxy、末尾空白不算修改', () => {
    expect(sourceEquals(src(), src({ config: {}, headers: {}, proxy: '' }))).toBe(true);
    expect(sourceEquals(src(), src({ apiBase: 'https://api.openai.com/v1  ' }))).toBe(true);
    expect(sourceEquals(src(), src({ key: 'k2' }))).toBe(false);
    expect(sourceEquals(src(), src({ config: { dimensions: 1024 } }))).toBe(false);
    expect(sourceEquals(src({ config: { a: undefined } }), src())).toBe(true);
  });

  it('templateCards：按能力过滤 + 搜索（id/名/域名）+ AstrBot 优先序', () => {
    const tpls: ProviderTemplate[] = [
      {
        id: 'zhipu',
        name: 'Zhipu',
        provider: 'zhipu',
        capability: 'chat',
        adapter: 'openai',
        apiBase: 'https://open.bigmodel.cn/api/paas/v4',
        defaultModels: [],
      },
      {
        id: 'openai',
        name: 'OpenAI',
        provider: 'openai',
        capability: 'chat',
        adapter: 'openai',
        apiBase: 'https://api.openai.com/v1',
        defaultModels: [],
      },
      {
        id: 'whisper',
        name: 'Whisper',
        provider: 'openai',
        capability: 'stt',
        adapter: 'openai',
        apiBase: 'https://api.openai.com/v1',
        defaultModels: [],
      },
      {
        id: 'ollama',
        name: 'Ollama',
        provider: 'ollama',
        capability: 'chat',
        adapter: 'ollama',
        apiBase: '',
        defaultModels: [],
      },
    ];
    const cards = templateCards(tpls, 'chat', '');
    expect(cards.map((c) => c.template.id)).toEqual(['openai', 'zhipu', 'ollama']);
    expect(cards[0]!.subtitle).toBe('api.openai.com');
    expect(cards[2]!.subtitle).toBe('');
    expect(templateCards(tpls, 'chat', 'bigmodel').map((c) => c.template.id)).toEqual(['zhipu']);
    expect(templateCards(tpls, 'stt', '')).toHaveLength(1);
    expect(hostOf('not a url')).toBe('not a url');
  });

  it('workbenchEntries：已配置在前、去重可用、搜索匹配显示 ID 或模型名', () => {
    const configured: ModelEntry[] = [
      { id: 'openai/gpt-4o', sourceId: 'openai', model: 'gpt-4o', enabled: true, caps: {} },
    ];
    const all = workbenchEntries(configured, ['gpt-4o', 'gpt-4o-mini', 'o3'], '');
    expect(
      all.map((e) => (e.type === 'configured' ? `c:${e.entry.model}` : `a:${e.model}`)),
    ).toEqual(['c:gpt-4o', 'a:gpt-4o-mini', 'a:o3']);
    expect(workbenchEntries(configured, ['o3'], 'openai/').map((e) => e.type)).toEqual([
      'configured',
    ]);
    expect(workbenchEntries(configured, ['o3'], 'O3')).toHaveLength(1);
  });

  it('capBadges / formatContextLimit / manualModelPreview / buildModelEntry', () => {
    expect(capBadges({ vision: true }).map((b) => [b.key, b.enabled])).toEqual([
      ['vision', true],
      ['audio', false],
      ['tool', false],
      ['reasoning', false],
    ]);
    expect(formatContextLimit(128_000)).toBe('128K');
    expect(formatContextLimit(2_000_000)).toBe('2M');
    expect(formatContextLimit(512)).toBe('512');
    expect(formatContextLimit(undefined)).toBe('');
    expect(manualModelPreview('openai', ' gpt-4.1-mini ')).toBe('openai/gpt-4.1-mini');
    expect(manualModelPreview('openai', '  ')).toBe('');
    expect(buildModelEntry('openai', 'gpt-4o')).toEqual({
      id: 'openai/gpt-4o',
      sourceId: 'openai',
      model: 'gpt-4o',
      enabled: true,
      caps: { vision: true, audio: true, tool: true },
    });
  });
});
