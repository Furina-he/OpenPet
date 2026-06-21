import { z } from 'zod';

export type ProviderFormat = 'openai' | 'anthropic' | 'gemini' | 'ollama';
export type AuthStyle = 'bearer' | 'x-api-key' | 'query-key' | 'none';

export interface ProviderDialect {
  id: string;
  name: string;
  kind: 'chat' | 'embedding';
  /** 默认 base（不含末尾斜杠）；用户可在配置覆盖。 */
  baseUrl: string;
  /** 白名单主机（startsWith 匹配的 origin）。 */
  host: string;
  authStyle: AuthStyle;
  format: ProviderFormat;
  defaultModels: string[];
}

/**
 * 内置 provider dialect 表 —— Main（host 白名单 + 注入风格）与 Worker（baseUrl +
 * 请求/响应格式）共享的静态真源。OpenAI 兼容端点（openai/deepseek/qwen 及任意
 * openai-compatible）共用 format='openai'；claude/gemini/ollama 各自格式。
 */
export const BUILTIN_PROVIDERS: Record<string, ProviderDialect> = {
  openai: {
    id: 'openai',
    name: 'OpenAI',
    kind: 'chat',
    baseUrl: 'https://api.openai.com/v1',
    host: 'https://api.openai.com',
    authStyle: 'bearer',
    format: 'openai',
    defaultModels: ['gpt-4o-mini', 'gpt-4o'],
  },
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    kind: 'chat',
    baseUrl: 'https://api.deepseek.com/v1',
    host: 'https://api.deepseek.com',
    authStyle: 'bearer',
    format: 'openai',
    defaultModels: ['deepseek-chat'],
  },
  qwen: {
    id: 'qwen',
    name: '通义千问',
    kind: 'chat',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    host: 'https://dashscope.aliyuncs.com',
    authStyle: 'bearer',
    format: 'openai',
    defaultModels: ['qwen-plus'],
  },
  claude: {
    id: 'claude',
    name: 'Claude',
    kind: 'chat',
    baseUrl: 'https://api.anthropic.com/v1',
    host: 'https://api.anthropic.com',
    authStyle: 'x-api-key',
    format: 'anthropic',
    defaultModels: ['claude-sonnet-4-6'],
  },
  gemini: {
    id: 'gemini',
    name: 'Gemini',
    kind: 'chat',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    host: 'https://generativelanguage.googleapis.com',
    authStyle: 'query-key',
    format: 'gemini',
    defaultModels: ['gemini-1.5-flash'],
  },
  ollama: {
    id: 'ollama',
    name: 'Ollama (本地)',
    kind: 'chat',
    baseUrl: 'http://127.0.0.1:11434',
    host: 'http://127.0.0.1:11434',
    authStyle: 'none',
    format: 'ollama',
    defaultModels: [],
  },
};

export const PROVIDER_BASE_URL_PREF_KEYS = {
  openai: 'model.openaiBaseUrl',
  deepseek: 'model.deepseekBaseUrl',
  qwen: 'model.qwenBaseUrl',
  claude: 'model.claudeBaseUrl',
  gemini: 'model.geminiBaseUrl',
  ollama: 'model.ollamaBaseUrl',
} as const;

export function getDialect(id: string): ProviderDialect | undefined {
  return BUILTIN_PROVIDERS[id];
}

export function normalizeProviderBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

export function providerBaseUrlPrefKey(
  providerId: string,
): (typeof PROVIDER_BASE_URL_PREF_KEYS)[keyof typeof PROVIDER_BASE_URL_PREF_KEYS] | undefined {
  return PROVIDER_BASE_URL_PREF_KEYS[providerId as keyof typeof PROVIDER_BASE_URL_PREF_KEYS];
}

export function getProviderBaseUrl(
  providerId: string,
  prefs?: Record<string, unknown>,
): string | undefined {
  const dialect = getDialect(providerId);
  if (!dialect) return undefined;
  const key = providerBaseUrlPrefKey(providerId);
  const configured = key && typeof prefs?.[key] === 'string' ? prefs[key] : '';
  return normalizeProviderBaseUrl(configured || dialect.baseUrl);
}

/** 用户对某 provider 的配置覆盖（存 prefs.json；密钥另存 Keychain）。 */
export const ProviderConfigSchema = z.object({
  id: z.string(),
  enabled: z.boolean(),
  baseUrl: z.string().optional(),
  model: z.string().optional(),
});
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

// ---------------------------------------------------------------------------
// Provider 工作台（AstrBot 对齐）—— 两层 Source + Model 数据模型
// ---------------------------------------------------------------------------

/** 能力分类（对齐 AstrBot ProviderType）。 */
export const CapabilitySchema = z.enum(['chat', 'agent_runner', 'stt', 'tts', 'embedding', 'rerank']);
export type Capability = z.infer<typeof CapabilitySchema>;

/** 适配器 = 请求/响应格式；openai 兼容任意 openai-compatible 端点。 */
export const AdapterSchema = z.enum(['openai', 'anthropic', 'gemini', 'ollama']);
export type Adapter = z.infer<typeof AdapterSchema>;

/** 模型能力标签（= AstrBot modalities + reasoning）。 */
export const ModelCapsSchema = z.object({
  vision: z.boolean().optional(),
  audio: z.boolean().optional(),
  tool: z.boolean().optional(),
  reasoning: z.boolean().optional(),
});
export type ModelCaps = z.infer<typeof ModelCapsSchema>;

/** Provider Source = 端点账号；可多建、同 adapter 可并存。key 明文随 source 存（用户裁定）。 */
export const ProviderSourceSchema = z.object({
  id: z.string().min(1),
  adapter: AdapterSchema,
  capability: CapabilitySchema,
  apiBase: z.string(),
  key: z.string().default(''),
  enabled: z.boolean().default(true),
  timeoutMs: z.number().int().positive().optional(),
  proxy: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  ollamaDisableThinking: z.boolean().optional(),
});
export type ProviderSource = z.infer<typeof ProviderSourceSchema>;

/** Model 条目 = 挂在某 Source 下的具体模型；id = `${sourceId}/${model}`。 */
export const ModelEntrySchema = z.object({
  id: z.string().min(1),
  sourceId: z.string().min(1),
  model: z.string().min(1),
  enabled: z.boolean().default(true),
  caps: ModelCapsSchema.default({}),
  contextTokens: z.number().int().positive().optional(),
});
export type ModelEntry = z.infer<typeof ModelEntrySchema>;

/** 新建 source 时的 adapter 默认模板（替代旧 BUILTIN_PROVIDERS 单选全集）。 */
export const AdapterTemplateSchema = z.object({
  adapter: AdapterSchema,
  capability: CapabilitySchema,
  label: z.string(),
  defaultApiBase: z.string(),
  authStyle: z.enum(['bearer', 'x-api-key', 'query-key', 'none']),
  format: AdapterSchema,
  defaultModels: z.array(z.string()),
});
export type AdapterTemplate = z.infer<typeof AdapterTemplateSchema>;

export const ADAPTER_TEMPLATES: AdapterTemplate[] = [
  {
    adapter: 'openai',
    capability: 'chat',
    label: 'OpenAI Compatible',
    defaultApiBase: 'https://api.openai.com/v1',
    authStyle: 'bearer',
    format: 'openai',
    defaultModels: ['gpt-4o-mini', 'gpt-4o'],
  },
  {
    adapter: 'anthropic',
    capability: 'chat',
    label: 'Anthropic Claude',
    defaultApiBase: 'https://api.anthropic.com/v1',
    authStyle: 'x-api-key',
    format: 'anthropic',
    defaultModels: ['claude-sonnet-4-6'],
  },
  {
    adapter: 'gemini',
    capability: 'chat',
    label: 'Google Gemini',
    defaultApiBase: 'https://generativelanguage.googleapis.com/v1beta',
    authStyle: 'query-key',
    format: 'gemini',
    defaultModels: ['gemini-1.5-flash'],
  },
  {
    adapter: 'ollama',
    capability: 'chat',
    label: 'Ollama (本地)',
    defaultApiBase: 'http://127.0.0.1:11434',
    authStyle: 'none',
    format: 'ollama',
    defaultModels: [],
  },
];

/** 生成不冲突的 source id（对齐 AstrBot generateUniqueSourceId）。 */
export function generateUniqueSourceId(baseId: string, existingIds: Iterable<string>): string {
  const existing = new Set(existingIds);
  if (!existing.has(baseId)) return baseId;
  let i = 1;
  while (existing.has(`${baseId}_${i}`)) i += 1;
  return `${baseId}_${i}`;
}

/** Model 条目 id 拼装：`${sourceId}/${model}`。 */
export function modelEntryId(sourceId: string, model: string): string {
  return `${sourceId}/${model}`;
}

/** adapter（+ apiBase + key）→ 拉模型列表的 URL：ollama=/api/tags、gemini=/models?key=、其余=/models。 */
export function getModelsUrlForAdapter(adapter: Adapter, apiBase: string, key: string): string {
  const base = normalizeProviderBaseUrl(apiBase);
  if (adapter === 'ollama') return `${base}/api/tags`;
  if (adapter === 'gemini') return `${base}/models${key ? `?key=${encodeURIComponent(key)}` : ''}`;
  return `${base}/models`;
}

export interface ChatTarget {
  sourceId: string;
  adapter: Adapter;
  apiBase: string;
  model: string;
}

/**
 * defaultChatModelId → ModelEntry → ProviderSource；任一缺失/disabled 返回 null（走离线兜底）。
 * 纯函数，无降级链（对齐 AstrBot）。
 */
export function resolveChatTarget(
  sources: ProviderSource[],
  models: ModelEntry[],
  defaultChatModelId: string,
): ChatTarget | null {
  if (!defaultChatModelId) return null;
  const entry = models.find((m) => m.id === defaultChatModelId);
  if (!entry || !entry.enabled) return null;
  const source = sources.find((s) => s.id === entry.sourceId);
  if (!source || !source.enabled) return null;
  return {
    sourceId: source.id,
    adapter: source.adapter,
    apiBase: source.apiBase,
    model: entry.model,
  };
}
