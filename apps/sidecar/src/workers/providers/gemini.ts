import type { ChatEvent, ChatRequest, ProviderDialect } from '@openpet/protocol';
import { parseSseStream } from '@openpet/plugin-sdk';
import { classifyStatus, classifyThrown } from './openai-compat.js';

/** Gemini content part（wire 形状；text / functionCall / functionResponse 三种）。 */
type GeminiPart =
  | { text: string }
  | { functionCall: { name: string; args: unknown } }
  | { functionResponse: { name: string; response: { result: string } } };

/**
 * §5 FC 全映射：assistant+toolCalls → `role:'model'` functionCall parts（有文本则 text part 在前）；
 * tool 消息 → `role:'user'` functionResponse part——Gemini 要函数名而非 id，先扫一遍
 * toolCallId→name 索引再映射（两遍扫描，纯函数）。纯文本轮保持不变。
 */
export function toGeminiContents(
  msgs: ChatRequest['messages'],
): Array<{ role: 'user' | 'model'; parts: GeminiPart[] }> {
  const idToName = new Map<string, string>();
  for (const m of msgs) {
    if (m.role === 'assistant' && m.toolCalls) {
      for (const tc of m.toolCalls) idToName.set(tc.id, tc.name);
    }
  }
  return msgs
    .filter((m) => m.role !== 'system')
    .filter((m) => !(m.role === 'assistant' && m.content.length === 0 && !m.toolCalls?.length))
    .map((m) => {
      if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
        const parts: GeminiPart[] = [];
        if (m.content.length > 0) parts.push({ text: m.content });
        for (const tc of m.toolCalls) {
          let args: unknown = {};
          try {
            args = tc.argsJson ? JSON.parse(tc.argsJson) : {};
          } catch {
            args = { _raw: tc.argsJson };
          }
          parts.push({ functionCall: { name: tc.name, args } });
        }
        return { role: 'model' as const, parts };
      }
      if (m.role === 'tool') {
        const name = (m.toolCallId && idToName.get(m.toolCallId)) || '';
        return {
          role: 'user' as const,
          parts: [{ functionResponse: { name, response: { result: m.content } } }] as GeminiPart[],
        };
      }
      return {
        role: m.role === 'assistant' ? ('model' as const) : ('user' as const),
        parts: [{ text: m.content }] as GeminiPart[],
      };
    });
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
      body: JSON.stringify({
        contents,
        ...(req.tools
          ? {
              tools: [
                {
                  functionDeclarations: req.tools.map((t) => ({
                    name: t.name,
                    description: t.description,
                    parameters: t.parameters,
                  })),
                },
              ],
            }
          : {}),
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
  const toolCalls: Array<{ name: string; args: unknown }> = [];
  for await (const sse of parseSseStream(res.body)) {
    if (signal.aborted) {
      yield { type: 'done', finishReason: 'cancel' };
      return;
    }
    let json: {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string; functionCall?: { name?: string; args?: unknown } }> };
      }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    try {
      json = JSON.parse(sse.data);
    } catch {
      continue;
    }
    const parts = json?.candidates?.[0]?.content?.parts ?? [];
    const text = parts.map((p) => p.text ?? '').join('');
    if (text) yield { type: 'delta', text };
    for (const p of parts) {
      if (p.functionCall?.name) {
        toolCalls.push({ name: p.functionCall.name, args: p.functionCall.args ?? {} });
      }
    }
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
  // Gemini 无 tool_call id：合成 call_<name>_<序号>（id 只在我们侧回灌闭环，不回传 Gemini）。
  for (let i = 0; i < toolCalls.length; i++) {
    const tc = toolCalls[i]!;
    yield { type: 'tool_call', id: `call_${tc.name}_${i}`, name: tc.name, args: tc.args };
  }
  if (sawUsage) yield { type: 'usage', prompt, completion };
  yield { type: 'done', finishReason: 'stop' };
}
