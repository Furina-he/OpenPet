import type { Adapter, ChatEvent, ChatRequest, ProviderDialect } from '@openpet/protocol';
import { ADAPTER_TEMPLATES, getDialect } from '@openpet/protocol';
import { openaiCompatChat } from './providers/openai-compat.js';
import { ollamaChat } from './providers/ollama.js';
import { anthropicChat } from './providers/anthropic.js';
import { geminiChat } from './providers/gemini.js';

export type ProviderChatFn = (req: ChatRequest, signal: AbortSignal) => AsyncIterable<ChatEvent>;

/** providerId → chat 生成器。未知 id / 未接入的 format 返回 undefined。 */
export function resolveProvider(providerId: string, baseUrlOverride?: string): ProviderChatFn | undefined {
  const dialect = getDialect(providerId);
  if (!dialect) return undefined;
  return chatFnFor(dialect, baseUrlOverride);
}

/**
 * adapter（+ 显式 apiBase）→ chat 生成器（Provider 工作台两层路由）。
 * 合成最小 dialect（baseUrl/defaultModels 仅 fallback）；未知 adapter 返回 undefined。
 */
export function resolveProviderByAdapter(adapter: Adapter, baseUrl: string): ProviderChatFn | undefined {
  const tmpl = ADAPTER_TEMPLATES.find((t) => t.adapter === adapter);
  if (!tmpl) return undefined;
  const dialect: ProviderDialect = {
    id: adapter,
    name: adapter,
    kind: 'chat',
    baseUrl,
    host: baseUrl,
    authStyle: tmpl.authStyle,
    format: tmpl.format,
    defaultModels: tmpl.defaultModels,
  };
  return chatFnFor(dialect, baseUrl);
}

/** dialect.format → provider 流生成器（resolveProvider / resolveProviderByAdapter 共用）。 */
function chatFnFor(dialect: ProviderDialect, baseUrlOverride?: string): ProviderChatFn | undefined {
  switch (dialect.format) {
    case 'openai':
      return (req, signal) => openaiCompatChat(dialect, req, signal, baseUrlOverride);
    case 'ollama':
      return (req, signal) => ollamaChat(dialect, req, signal, baseUrlOverride);
    case 'anthropic':
      return (req, signal) => anthropicChat(dialect, req, signal, baseUrlOverride);
    case 'gemini':
      return (req, signal) => geminiChat(dialect, req, signal, baseUrlOverride);
    default:
      return undefined;
  }
}
