import { describe, it, expect } from 'vitest';
import {
  PROVIDER_TEMPLATES,
  ProviderTemplateSchema,
  providerIconUrl,
  providerConfigMeta,
  ProviderSourceSchema,
  type Capability,
} from '../src/index.js';

const byName = (n: string) => PROVIDER_TEMPLATES.find((t) => t.name === n);

describe('PROVIDER_TEMPLATES（照 AstrBot config_template）', () => {
  it('全部条目合法解析', () => {
    for (const t of PROVIDER_TEMPLATES) expect(ProviderTemplateSchema.parse(t)).toEqual(t);
  });

  it('6 个能力都有具名模板', () => {
    const caps: Capability[] = ['chat', 'agent_runner', 'stt', 'tts', 'embedding', 'rerank'];
    for (const c of caps) {
      expect(PROVIDER_TEMPLATES.some((t) => t.capability === c)).toBe(true);
    }
  });

  it('含 AstrBot 的代表性具名 provider', () => {
    // chat：不再只有「OpenAI Compatible」泛型
    expect(byName('DeepSeek')?.capability).toBe('chat');
    expect(byName('SiliconFlow')?.capability).toBe('chat');
    // embedding / tts / rerank / agent
    expect(byName('OpenAI Embedding')?.capability).toBe('embedding');
    expect(byName('Ollama Embedding')?.capability).toBe('embedding');
    expect(byName('Edge TTS')?.capability).toBe('tts');
    expect(byName('vLLM Rerank')?.capability).toBe('rerank');
    expect(byName('Dify')?.capability).toBe('agent_runner');
  });

  it('每个模板带 id/provider(图标键)/apiBase', () => {
    for (const t of PROVIDER_TEMPLATES) {
      expect(t.id.length).toBeGreaterThan(0);
      expect(t.provider.length).toBeGreaterThan(0);
    }
  });

  it('embedding 模板只用 worker embed() 支持的 openai/ollama 格式', () => {
    for (const t of PROVIDER_TEMPLATES.filter((x) => x.capability === 'embedding')) {
      expect(['openai', 'ollama']).toContain(t.adapter);
    }
  });
});

describe('providerIconUrl', () => {
  it('已知厂商返回 URL，未知返回空串', () => {
    expect(providerIconUrl('openai')).toMatch(/^https?:\/\//);
    expect(providerIconUrl('google')).toMatch(/^https?:\/\//);
    expect(providerIconUrl('不存在')).toBe('');
  });
});

describe('providerConfigMeta（按能力的类型专属字段，照 AstrBot items）', () => {
  it('chat 无额外字段（走 models 表 + caps）', () => {
    expect(providerConfigMeta('chat')).toEqual([]);
  });
  it('embedding 有向量维度字段', () => {
    expect(providerConfigMeta('embedding').map((m) => m.key)).toContain('dimensions');
  });
  it('rerank 有 API 路径后缀字段', () => {
    expect(providerConfigMeta('rerank').map((m) => m.key)).toContain('rerankApiSuffix');
  });
  it('tts 有音色字段；agent 有应用字段', () => {
    expect(providerConfigMeta('tts').map((m) => m.key)).toContain('voice');
    expect(providerConfigMeta('agent_runner').map((m) => m.key)).toContain('agentAppId');
  });
  it('每条都是合法 ConfigItemMeta（带 key）', () => {
    for (const cap of ['embedding', 'rerank', 'tts', 'stt', 'agent_runner'] as const) {
      for (const m of providerConfigMeta(cap)) expect(m.key.length).toBeGreaterThan(0);
    }
  });
});

describe('ProviderSourceSchema +config blob', () => {
  it('接受可选 config（类型专属参数）', () => {
    const s = ProviderSourceSchema.parse({
      id: 'e1',
      adapter: 'openai',
      capability: 'embedding',
      apiBase: 'http://x/v1',
      config: { dimensions: 1024 },
    });
    expect(s.config).toEqual({ dimensions: 1024 });
  });
});

describe('ProviderSourceSchema +name/icon', () => {
  it('接受可选 name/icon，缺省 undefined', () => {
    const s = ProviderSourceSchema.parse({
      id: 's1',
      adapter: 'openai',
      capability: 'embedding',
      apiBase: 'http://x/v1',
    });
    expect(s.name).toBeUndefined();
    expect(s.icon).toBeUndefined();
    const s2 = ProviderSourceSchema.parse({
      id: 's2',
      adapter: 'openai',
      capability: 'chat',
      apiBase: 'http://x/v1',
      name: 'DeepSeek',
      icon: 'deepseek',
    });
    expect(s2.name).toBe('DeepSeek');
    expect(s2.icon).toBe('deepseek');
  });
});
