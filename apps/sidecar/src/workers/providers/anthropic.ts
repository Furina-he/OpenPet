import type { ChatEvent, ChatRequest, ProviderDialect } from '@openpet/protocol';
import { parseSseStream } from '@openpet/plugin-sdk';
import { classifyStatus, classifyThrown } from './openai-compat.js';

/** Anthropic content block（wire 形状；只用到 text/tool_use/tool_result 三种）。 */
type AnthropicBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string };

/**
 * §5 FC 全映射：assistant+toolCalls → tool_use blocks（有文本则 text block 在前）；
 * tool 消息 → user tool_result block（Anthropic 规范：tool_result 必须紧跟对应 tool_use
 * 的下一条 user 消息——回灌序列天然满足）；纯文本轮保持 string content 不变。
 */
export function toAnthropicMessages(
  msgs: ChatRequest['messages'],
): Array<{ role: 'user' | 'assistant'; content: string | AnthropicBlock[] }> {
  return msgs
    .filter((m) => m.role !== 'system')
    .filter((m) => !(m.role === 'assistant' && m.content.length === 0 && !m.toolCalls?.length))
    .map((m) => {
      if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
        const blocks: AnthropicBlock[] = [];
        if (m.content.length > 0) blocks.push({ type: 'text', text: m.content });
        for (const tc of m.toolCalls) {
          let input: unknown = {};
          try {
            input = tc.argsJson ? JSON.parse(tc.argsJson) : {};
          } catch {
            input = { _raw: tc.argsJson };
          }
          blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input });
        }
        return { role: 'assistant' as const, content: blocks };
      }
      if (m.role === 'tool') {
        return {
          role: 'user' as const,
          content: [
            { type: 'tool_result' as const, tool_use_id: m.toolCallId ?? '', content: m.content },
          ],
        };
      }
      return {
        role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
        content: m.content,
      };
    });
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
        ...(req.tools
          ? {
              tools: req.tools.map((t) => ({
                name: t.name,
                description: t.description,
                input_schema: t.parameters,
              })),
            }
          : {}),
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
  const toolAcc = new Map<number, { id: string; name: string; args: string }>();
  for await (const sse of parseSseStream(res.body)) {
    if (signal.aborted) {
      yield { type: 'done', finishReason: 'cancel' };
      return;
    }
    let json: {
      index?: number;
      content_block?: { type?: string; id?: string; name?: string };
      delta?: { type?: string; text?: string; partial_json?: string };
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    try {
      json = JSON.parse(sse.data);
    } catch {
      continue;
    }
    if (sse.event === 'content_block_start' && json?.content_block?.type === 'tool_use') {
      toolAcc.set(json.index ?? 0, {
        id: json.content_block.id ?? '',
        name: json.content_block.name ?? '',
        args: '',
      });
    }
    if (sse.event === 'content_block_delta') {
      if (json?.delta?.type === 'text_delta' && json.delta.text) {
        yield { type: 'delta', text: json.delta.text };
      }
      if (json?.delta?.type === 'input_json_delta' && typeof json.delta.partial_json === 'string') {
        const cur = toolAcc.get(json.index ?? 0);
        if (cur) cur.args += json.delta.partial_json;
      }
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
  for (const tc of toolAcc.values()) {
    let parsed: unknown = {};
    try {
      parsed = tc.args ? JSON.parse(tc.args) : {};
    } catch {
      parsed = { _raw: tc.args };
    }
    yield { type: 'tool_call', id: tc.id || `call_${tc.name}`, name: tc.name, args: parsed };
  }
  if (sawUsage) yield { type: 'usage', prompt, completion };
  yield { type: 'done', finishReason: 'stop' };
}
