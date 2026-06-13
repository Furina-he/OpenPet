import type { ChatProvider, ChatRequest, ChatEvent } from './types.js';

export interface ProviderConfig {
  id: string;
  name: string;
  capabilities: ChatProvider['capabilities'];
  chat: (req: ChatRequest, signal: AbortSignal) => AsyncIterable<ChatEvent>;
}

export function defineProvider(config: ProviderConfig): ChatProvider {
  return {
    id: config.id,
    name: config.name,
    capabilities: config.capabilities,
    chat: config.chat,
  };
}
