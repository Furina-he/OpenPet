import type { ChatEvent, ChatRequest, ProviderDialect } from '@desksoul/protocol';

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
      body: JSON.stringify({ model, messages: req.messages, stream: true }),
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
          message?: { content?: string };
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
  if (prompt || completion) yield { type: 'usage', prompt, completion };
  yield { type: 'done', finishReason: 'stop' };
}
