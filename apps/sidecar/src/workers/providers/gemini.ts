import type { ChatEvent, ChatRequest, ProviderDialect } from '@openpet/protocol';
import { parseSseStream } from '@openpet/plugin-sdk';
import { classifyStatus, classifyThrown } from './openai-compat.js';

/** §5：Gemini contents 消毒（同 anthropic 策略：丢空 assistant，tool 折叠为 user）。 */
export function toGeminiContents(
  msgs: ChatRequest['messages'],
): Array<{ role: 'user' | 'model'; parts: [{ text: string }] }> {
  return msgs
    .filter((m) => m.role !== 'system')
    .filter((m) => !(m.role === 'assistant' && m.content.length === 0))
    .map((m) => ({
      role: m.role === 'assistant' ? ('model' as const) : ('user' as const),
      parts: [{ text: m.role === 'tool' ? `[工具结果] ${m.content}` : m.content }] as [
        { text: string },
      ],
    }));
}

/**
 * Gemini streamGenerateContent（alt=sse）。API key 在 url query，由 Main 的
 * FetchGateway 注入（worker 只打不带 key 的 url）。
 */
export async function* geminiChat(
  dialect: ProviderDialect,
  req: ChatRequest,
  signal: AbortSignal,
  baseUrlOverride?: string,
): AsyncGenerator<ChatEvent> {
  const base = baseUrlOverride ?? dialect.baseUrl;
  const model = req.model ?? dialect.defaultModels[0] ?? '';
  const contents = toGeminiContents(req.messages);

  let res: Response;
  try {
    res = await fetch(`${base}/models/${model}:streamGenerateContent?alt=sse`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contents }),
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
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    try {
      json = JSON.parse(sse.data);
    } catch {
      continue;
    }
    const text = json?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    if (text) yield { type: 'delta', text };
    if (json?.usageMetadata) {
      sawUsage = true;
      prompt = json.usageMetadata.promptTokenCount ?? prompt;
      completion = json.usageMetadata.candidatesTokenCount ?? completion;
    }
  }

  if (signal.aborted) {
    yield { type: 'done', finishReason: 'cancel' };
    return;
  }
  if (sawUsage) yield { type: 'usage', prompt, completion };
  yield { type: 'done', finishReason: 'stop' };
}
