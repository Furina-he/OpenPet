import type { ChatEvent, ChatRequest, ErrorKind, ProviderDialect } from '@desksoul/protocol';
import { parseSseStream } from '@desksoul/plugin-sdk';
import { estimateTokens, estimateMessagesTokens } from '../token-estimate.js';

/** HTTP 状态 → 错误分级（J3 数据侧）。 */
export function classifyStatus(status: number): ErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'server';
  return 'unknown';
}

/** 抛出的异常（网络/超时）→ 错误分级。 */
export function classifyThrown(e: unknown): ErrorKind {
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
  if (msg.includes('timeout') || msg.includes('timed out')) return 'timeout';
  return 'network';
}

function buildBody(req: ChatRequest, model: string): unknown {
  return {
    model,
    stream: true,
    stream_options: { include_usage: true },
    messages: req.messages,
    ...(req.params?.temperature !== undefined ? { temperature: req.params.temperature } : {}),
    ...(req.params?.maxTokens !== undefined ? { max_tokens: req.params.maxTokens } : {}),
    ...(req.tools
      ? {
          tools: req.tools.map((t) => ({
            type: 'function',
            function: { name: t.name, description: t.description, parameters: t.parameters },
          })),
        }
      : {}),
  };
}

/**
 * OpenAI 兼容流式补全（覆盖 openai/deepseek/qwen 及任意 openai-compatible 端点）。
 * 用 globalThis.fetch（Worker 内被 fetch-proxy 替换为经 Main 注入密钥）。
 */
export async function* openaiCompatChat(
  dialect: ProviderDialect,
  req: ChatRequest,
  signal: AbortSignal,
  baseUrlOverride?: string,
): AsyncGenerator<ChatEvent> {
  const model = req.model ?? dialect.defaultModels[0] ?? '';
  const base = baseUrlOverride ?? dialect.baseUrl;

  let res: Response;
  try {
    res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildBody(req, model)),
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
  let completionText = '';
  try {
    for await (const sse of parseSseStream(res.body)) {
      if (signal.aborted) {
        yield { type: 'done', finishReason: 'cancel' };
        return;
      }
      if (sse.data === '[DONE]') break;
      let json: {
        choices?: Array<{ delta?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      try {
        json = JSON.parse(sse.data);
      } catch {
        continue;
      }
      const text = json?.choices?.[0]?.delta?.content;
      if (typeof text === 'string' && text) {
        completionText += text;
        yield { type: 'delta', text };
      }
      if (json?.usage) {
        sawUsage = true;
        prompt = json.usage.prompt_tokens ?? 0;
        completion = json.usage.completion_tokens ?? 0;
      }
    }
  } catch (e) {
    yield {
      type: 'done',
      finishReason: signal.aborted ? 'cancel' : 'error',
      ...(signal.aborted ? {} : { error: String(e), errorKind: classifyThrown(e) }),
    };
    return;
  }

  if (signal.aborted) {
    yield { type: 'done', finishReason: 'cancel' };
    return;
  }
  if (sawUsage) {
    yield { type: 'usage', prompt, completion };
  } else if (completionText) {
    // provider 未返回 usage：本地估算（prompt 从请求 messages，completion 从累积文本）
    yield {
      type: 'usage',
      prompt: estimateMessagesTokens(req.messages),
      completion: estimateTokens(completionText),
    };
  }
  yield { type: 'done', finishReason: 'stop' };
}
