export interface ChatProvider {
  id: string;
  name: string;
  capabilities: {
    tools?: boolean;
    vision?: boolean;
    jsonMode?: boolean;
  };
  chat(req: ChatRequest, signal: AbortSignal): AsyncIterable<ChatEvent>;
}

export interface ChatRequest {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export type ChatEvent =
  | { type: 'delta'; text: string }
  | { type: 'tool_call'; name: string; args: unknown; id: string }
  | { type: 'usage'; prompt: number; completion: number; cost?: number }
  | { type: 'done'; finishReason: 'stop' | 'cancel' | 'error'; error?: string };
