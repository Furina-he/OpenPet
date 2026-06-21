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
