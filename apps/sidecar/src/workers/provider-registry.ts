import type { ChatEvent, ChatRequest } from '@desksoul/protocol';
import { getDialect } from '@desksoul/protocol';
import { openaiCompatChat } from './providers/openai-compat.js';

export type ProviderChatFn = (req: ChatRequest, signal: AbortSignal) => AsyncIterable<ChatEvent>;

/** providerId → chat 生成器。未知 id / 未接入的 format 返回 undefined。 */
export function resolveProvider(providerId: string): ProviderChatFn | undefined {
  const dialect = getDialect(providerId);
  if (!dialect) return undefined;
  switch (dialect.format) {
    case 'openai':
      return (req, signal) => openaiCompatChat(dialect, req, signal);
    // anthropic / gemini（Task 3.6）、ollama（Phase 5）在后续接入
    default:
      return undefined;
  }
}
