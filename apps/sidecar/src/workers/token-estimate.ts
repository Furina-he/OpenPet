import { encode } from 'gpt-tokenizer';
import type { ChatRequest } from '@openpet/protocol';

/** 单段文本的 token 数（cl100k_base；provider 缺 usage 时的兜底估算）。 */
export function estimateTokens(text: string): number {
  return encode(text).length;
}

/** 粗估 prompt token：每条消息 ~4 token 结构开销 + 内容 token，整体 +2。 */
export function estimateMessagesTokens(messages: ChatRequest['messages']): number {
  let total = 0;
  for (const m of messages) total += 4 + estimateTokens(m.content);
  return total + 2;
}
