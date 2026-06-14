import type { ChatEvent, ChatRequest } from '@desksoul/protocol';
import { getDialect } from '@desksoul/protocol';
import { openaiCompatChat } from './providers/openai-compat.js';
import { ollamaChat } from './providers/ollama.js';
import { anthropicChat } from './providers/anthropic.js';
import { geminiChat } from './providers/gemini.js';

export type ProviderChatFn = (req: ChatRequest, signal: AbortSignal) => AsyncIterable<ChatEvent>;

/** providerId → chat 生成器。未知 id / 未接入的 format 返回 undefined。 */
export function resolveProvider(providerId: string): ProviderChatFn | undefined {
  const dialect = getDialect(providerId);
  if (!dialect) return undefined;
  switch (dialect.format) {
    case 'openai':
      return (req, signal) => openaiCompatChat(dialect, req, signal);
    case 'ollama':
      return (req, signal) => ollamaChat(dialect, req, signal);
    case 'anthropic':
      return (req, signal) => anthropicChat(dialect, req, signal);
    case 'gemini':
      return (req, signal) => geminiChat(dialect, req, signal);
    default:
      return undefined;
  }
}
