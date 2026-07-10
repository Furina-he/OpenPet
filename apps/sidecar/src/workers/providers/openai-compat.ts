import type { ChatEvent, ChatRequest, ErrorKind, ProviderDialect } from '@openpet/protocol';
import { parseSseStream } from '@openpet/plugin-sdk';
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

/** §5：中立 ChatMessage → openai wire 消息（tool_calls/tool_call_id 映射；防中立字段泄漏）。 */
export function toWireMessage(m: ChatRequest['messages'][number]): Record<string, unknown> {
  if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
    return {
      role: 'assistant',
      content: m.content.length > 0 ? m.content : null, // 有 tool_calls 时空 content 置 null（照 AstrBot 3db778f）
      tool_calls: m.toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: tc.argsJson },
      })),
    };
  }
  if (m.role === 'tool') {
    return {
      role: 'tool',
      content: m.content,
      ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
    };
  }
  return { role: m.role, content: m.content };
}

function buildBody(req: ChatRequest, model: string): unknown {
  return {
    model,
    stream: true,
    stream_options: { include_usage: true },
    messages: req.messages.map(toWireMessage),
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
  const toolAcc = new Map<number, { id: string; name: string; args: string }>();
  try {
    for await (const sse of parseSseStream(res.body)) {
      if (signal.aborted) {
        yield { type: 'done', finishReason: 'cancel' };
        return;
      }
      if (sse.data === '[DONE]') break;
      let json: {
        choices?: Array<{
          delta?: {
            content?: string;
            reasoning_content?: string;
            tool_calls?: Array<{
              index?: number;
              id?: string;
              function?: { name?: string; arguments?: string };
            }>;
          };
          finish_reason?: string;
        }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      try {
        json = JSON.parse(sse.data);
      } catch {
        continue;
      }
      // C′ §3：推理流（deepseek-reasoner/o1 的 reasoning_content）。独立于 content——
      // 不计入 completionText（不是回复文本），由 ConversationCore 路由到 chat.reasoning + 桌宠线索。
      const reasoning = json?.choices?.[0]?.delta?.reasoning_content;
      if (typeof reasoning === 'string' && reasoning) {
        yield { type: 'reasoning', text: reasoning };
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
      const tcs = json?.choices?.[0]?.delta?.tool_calls;
      if (Array.isArray(tcs)) {
        for (const tc of tcs) {
          const idx = tc.index ?? 0;
          const cur = toolAcc.get(idx) ?? { id: '', name: '', args: '' };
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.name = tc.function.name;
          if (tc.function?.arguments) cur.args += tc.function.arguments;
          toolAcc.set(idx, cur);
        }
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
  for (const tc of toolAcc.values()) {
    let parsed: unknown = {};
    try {
      parsed = tc.args ? JSON.parse(tc.args) : {};
    } catch {
      parsed = { _raw: tc.args };
    }
    yield { type: 'tool_call', id: tc.id || `call_${tc.name}`, name: tc.name, args: parsed };
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
