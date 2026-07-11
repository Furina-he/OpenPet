import { describe, it, expect, afterEach, vi } from 'vitest';
import type { ChatEvent, ChatRequest } from '@openpet/protocol';
import { getDialect } from '@openpet/protocol';
import { anthropicChat } from '../src/workers/providers/anthropic.js';
// 真 orchestrator（type-only 依赖，可直接引入）：锁「中立协议零改动即闭环」——
// anthropic 方言换上后，TurnOrchestrator 的 tool_call 收集/callTool/回灌链路原样工作。
import { TurnOrchestrator } from '../../desktop/electron/main/turn-orchestrator.js';
import type { ProviderHost } from '../../desktop/electron/main/provider-host.js';
import type { PluginGateway } from '../../desktop/electron/main/plugin-gateway.js';
import type { McpToolPort } from '../../desktop/electron/main/chat-service.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function sse(lines: string[]): Response {
  const enc = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        for (const l of lines) c.enqueue(enc.encode(l));
        c.close();
      },
    }),
    { status: 200 },
  );
}

describe('非 openai 方言工具回灌两轮闭环（anthropic × TurnOrchestrator）', () => {
  it('首轮 tool_use → callTool → 二轮请求含 tool_result 块与 tools 字段 → 二轮文本 stop', async () => {
    // fake fetch 两轮脚本：首轮吐 tool_use，二轮吐文本 stop；捕获请求体供断言。
    const bodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(init!.body as string));
      return bodies.length === 1
        ? sse([
            'event: content_block_start\ndata: {"index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"search","input":{}}}\n\n',
            'event: content_block_delta\ndata: {"index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"q\\":\\"cats\\"}"}}\n\n',
            'event: message_stop\ndata: {}\n\n',
          ])
        : sse([
            'event: content_block_delta\ndata: {"delta":{"type":"text_delta","text":"猫查到了"}}\n\n',
            'event: message_stop\ndata: {}\n\n',
          ]);
    }) as unknown as typeof fetch;

    const mcp = {
      activeToolDefs: () => [],
      callTool: vi.fn(async (name: string, args: unknown) => `MCP:${name}:${JSON.stringify(args)}`),
    };
    const broadcasts: Array<{ channel: string; params: unknown }> = [];
    const passthrough: ChatEvent[] = [];
    let finish!: () => void;
    const finished = new Promise<void>((r) => {
      finish = r;
    });

    // fake host：send 直接驱动真 anthropicChat（fake fetch），事件泵回 orchestrator。
    const host = {
      send(sessionId: string, payload: { request?: ChatRequest }) {
        void (async () => {
          for await (const ev of anthropicChat(
            getDialect('claude')!,
            payload.request!,
            new AbortController().signal,
          )) {
            if (orch.onProviderEvent(sessionId, ev) === 'passthrough') {
              passthrough.push(ev);
              if (ev.type === 'done') finish();
            }
          }
        })();
      },
    };
    const orch = new TurnOrchestrator({
      host: host as unknown as ProviderHost,
      plugins: {} as PluginGateway,
      mcp: mcp as McpToolPort,
      broadcast: (channel, params) => broadcasts.push({ channel, params }),
    });

    const request: ChatRequest = {
      messages: [{ role: 'user', content: '帮我查猫' }],
      tools: [{ name: 'search', description: '搜索', parameters: { type: 'object' } }],
    };
    orch.start('s1', request, { chain: ['claude'] });
    await finished;

    // orchestrator 走了 fake mcp.callTool（参数来自流解析的 tool_use input）
    expect(mcp.callTool).toHaveBeenCalledWith('search', { q: 'cats' });
    // 工具卡 result 相广播
    expect(broadcasts).toContainEqual({
      channel: 'chat.toolCall',
      params: {
        sessionId: 's1',
        call: { id: 'toolu_1', name: 'search', phase: 'result', result: 'MCP:search:{"q":"cats"}' },
      },
    });

    // 二轮请求体：tools 字段保留 + assistant tool_use 载体 + user tool_result 块
    expect(bodies).toHaveLength(2);
    const second = bodies[1]! as { tools?: unknown; messages: unknown[] };
    expect(second.tools).toEqual([
      { name: 'search', description: '搜索', input_schema: { type: 'object' } },
    ]);
    expect(second.messages).toEqual([
      { role: 'user', content: '帮我查猫' },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'toolu_1', name: 'search', input: { q: 'cats' } }],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'toolu_1', content: 'MCP:search:{"q":"cats"}' },
        ],
      },
    ]);

    // 二轮文本经 passthrough 到达（首轮 done(stop) 被 orchestrator 吞掉等回灌）
    expect(passthrough).toContainEqual({ type: 'delta', text: '猫查到了' });
    expect(passthrough.at(-1)).toEqual({ type: 'done', finishReason: 'stop' });
  });
});
