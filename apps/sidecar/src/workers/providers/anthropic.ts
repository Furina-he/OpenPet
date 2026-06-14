import type { ChatEvent, ChatRequest, ProviderDialect } from '@desksoul/protocol';
import { parseSseStream } from '@desksoul/plugin-sdk';
import { classifyStatus, classifyThrown } from './openai-compat.js';

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
  const messages = req.messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));

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
