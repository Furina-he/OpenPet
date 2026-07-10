import type { ChatEvent, ChatRequest, ProviderDialect } from '@openpet/protocol';
import { parseSseStream } from '@openpet/plugin-sdk';
import { classifyStatus, classifyThrown } from './openai-compat.js';

/** §5：Anthropic 只收 user/assistant 纯文本——丢空 assistant（toolCalls-only），tool 折叠为 user。 */
export function toAnthropicMessages(
  msgs: ChatRequest['messages'],
): Array<{ role: 'user' | 'assistant'; content: string }> {
  return msgs
    .filter((m) => m.role !== 'system')
    .filter((m) => !(m.role === 'assistant' && m.content.length === 0))
    .map((m) => ({
      role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
      content: m.role === 'tool' ? `[工具结果] ${m.content}` : m.content,
    }));
}

/** Anthropic Messages API 流式（event: content_block_delta / message_delta / message_stop）。 */
export async function* anthropicChat(
  dialect: ProviderDialect,
  req: ChatRequest,
  signal: AbortSignal,
  baseUrlOverride?: string,
): AsyncGenerator<ChatEvent> {
  const base = baseUrlOverride ?? dialect.baseUrl;
  const model = req.model ?? dialect.defaultModels[0] ?? '';
  const system = req.messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n');
  const messages = toAnthropicMessages(req.messages);

  let res: Response;
  try {
    res = await fetch(`${base}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: true,
        max_tokens: req.params?.maxTokens ?? 1024,
        ...(system ? { system } : {}),
        messages,
      }),
      signal,
    });
  } catch (e) {
    yield {
      type: 'done',
      finishReason: signal.aborted ? 'cancel' : 'error',
      ...(signal.aborted ? {} : { error: String(e), errorKind: classifyThrown(e) }),
    };
    return;
  }
  if (!res.ok) {
    yield { type: 'done', finishReason: 'error', error: `HTTP ${res.status}`, errorKind: classifyStatus(res.status) };
    return;
  }
  if (!res.body) {
    yield { type: 'done', finishReason: 'error', error: 'empty body', errorKind: 'server' };
    return;
  }

  let prompt = 0;
  let completion = 0;
  let sawUsage = false;
  for await (const sse of parseSseStream(res.body)) {
    if (signal.aborted) {
      yield { type: 'done', finishReason: 'cancel' };
      return;
    }
    let json: {
      delta?: { type?: string; text?: string };
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    try {
      json = JSON.parse(sse.data);
    } catch {
      continue;
    }
    if (sse.event === 'content_block_delta' && json?.delta?.type === 'text_delta' && json.delta.text) {
      yield { type: 'delta', text: json.delta.text };
    }
    if (json?.usage) {
      sawUsage = true;
      prompt = json.usage.input_tokens ?? prompt;
      completion = json.usage.output_tokens ?? completion;
    }
    if (sse.event === 'message_stop') break;
  }

  if (signal.aborted) {
    yield { type: 'done', finishReason: 'cancel' };
    return;
  }
  if (sawUsage) yield { type: 'usage', prompt, completion };
  yield { type: 'done', finishReason: 'stop' };
}
