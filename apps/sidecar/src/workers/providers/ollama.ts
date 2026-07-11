import type { ChatEvent, ChatRequest, ProviderDialect } from '@openpet/protocol';

/**
 * §5：/api/chat 支持 tool role，但须剥离中立字段；无 toolCalls 的空 assistant 丢弃。
 * assistant+toolCalls → `tool_calls:[{function:{name,arguments}}]`（Ollama 的 arguments 是对象非字符串）。
 */
export function toOllamaMessages(
  msgs: ChatRequest['messages'],
): Array<{ role: string; content: string; tool_calls?: unknown[] }> {
  return msgs
    .filter((m) => !(m.role === 'assistant' && m.content.length === 0 && !m.toolCalls?.length))
    .map((m) => {
      if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
        return {
          role: 'assistant',
          content: m.content,
          tool_calls: m.toolCalls.map((tc) => {
            let args: unknown = {};
            try {
              args = tc.argsJson ? JSON.parse(tc.argsJson) : {};
            } catch {
              args = { _raw: tc.argsJson };
            }
            return { function: { name: tc.name, arguments: args } };
          }),
        };
      }
      return { role: m.role, content: m.content };
    });
}

/**
 * Ollama 本地流式补全。/api/chat 返回 NDJSON（每行一个 JSON，非 SSE）：
 *   {"message":{"content":"x"},"done":false} … {"done":true,"prompt_eval_count":N,"eval_count":M}
 */
export async function* ollamaChat(
  dialect: ProviderDialect,
  req: ChatRequest,
  signal: AbortSignal,
  baseUrlOverride?: string,
): AsyncGenerator<ChatEvent> {
  const base = baseUrlOverride ?? dialect.baseUrl;
  const model = req.model ?? dialect.defaultModels[0] ?? 'llama3';
  let res: Response;
  try {
    res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: toOllamaMessages(req.messages),
        stream: true,
        ...(req.tools
          ? {
              tools: req.tools.map((t) => ({
                type: 'function',
                function: { name: t.name, description: t.description, parameters: t.parameters },
              })),
            }
          : {}),
      }),
      signal,
    });
  } catch (e) {
    yield {
      type: 'done',
      finishReason: signal.aborted ? 'cancel' : 'error',
      ...(signal.aborted ? {} : { error: String(e), errorKind: 'network' as const }),
    };
    return;
  }
  if (!res.ok) {
    yield {
      type: 'done',
      finishReason: 'error',
      error: `HTTP ${res.status}`,
      errorKind: res.status >= 500 ? 'server' : 'unknown',
    };
    return;
  }
  if (!res.body) {
    yield { type: 'done', finishReason: 'error', error: 'empty body', errorKind: 'server' };
    return;
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let prompt = 0;
  let completion = 0;
  const toolCalls: Array<{ id?: string | undefined; name: string; args: unknown }> = [];
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (signal.aborted) {
        yield { type: 'done', finishReason: 'cancel' };
        return;
      }
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let json: {
          message?: {
            content?: string;
            tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: unknown } }>;
          };
          done?: boolean;
          prompt_eval_count?: number;
          eval_count?: number;
        };
        try {
          json = JSON.parse(line);
        } catch {
          continue;
        }
        const text = json?.message?.content;
        if (typeof text === 'string' && text) yield { type: 'delta', text };
        if (Array.isArray(json?.message?.tool_calls)) {
          for (const tc of json.message.tool_calls) {
            if (tc.function?.name) {
              toolCalls.push({ id: tc.id, name: tc.function.name, args: tc.function.arguments ?? {} });
            }
          }
        }
        if (json?.done) {
          prompt = json.prompt_eval_count ?? 0;
          completion = json.eval_count ?? 0;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (signal.aborted) {
    yield { type: 'done', finishReason: 'cancel' };
    return;
  }
  for (let i = 0; i < toolCalls.length; i++) {
    const tc = toolCalls[i]!;
    yield { type: 'tool_call', id: tc.id ?? `call_${tc.name}_${i}`, name: tc.name, args: tc.args };
  }
  if (prompt || completion) yield { type: 'usage', prompt, completion };
  yield { type: 'done', finishReason: 'stop' };
}
