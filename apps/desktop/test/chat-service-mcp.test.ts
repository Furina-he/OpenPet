import { describe, it, expect, afterEach, vi } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ChatService, type McpToolPort } from '../electron/main/chat-service';
import { createTraceCollector } from '../electron/main/trace-collector';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOOL_ENTRY = path.join(__dirname, 'fixtures/tool-worker.mjs');

type Sent = { channel: string; params: any };
function until(pred: () => boolean, what: string, timeoutMs = 4000): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timed out waiting for ${what}`)), timeoutMs);
    const tick = setInterval(() => {
      if (pred()) {
        clearTimeout(t);
        clearInterval(tick);
        resolve();
      }
    }, 5);
  });
}
const doneOf = (sent: Sent[], id: string) =>
  sent.find((s) => s.channel === 'chat.done' && s.params.sessionId === id);

let svc: ChatService | null = null;
afterEach(async () => {
  await svc?.dispose();
  svc = null;
});

describe('ChatService · MCP 工具路由 (§4)', () => {
  it('注入 active 工具 + tool_call 经 mcp.callTool 执行 + 广播 result 相 + 回灌', async () => {
    const sent: Sent[] = [];
    const mcp: McpToolPort = {
      activeToolDefs: vi.fn(() => [{ name: 'echo', description: 'echo it', parameters: { type: 'object' } }]),
      callTool: vi.fn(async (name: string, args: unknown) => `MCP:${name}:${JSON.stringify(args)}`),
    };
    svc = new ChatService({
      providerEntryPath: TOOL_ENTRY,
      broadcast: (c, p) => sent.push({ channel: c, params: p }),
      providerChain: ['openai'],
      queue: { flushIntervalMs: 5 },
      mcp,
    });
    svc.send('s1', 'use a tool');
    await until(() => !!doneOf(sent, 's1'), 'mcp tool reprompt done');

    // 注入路径触发：send 时取了 active 工具定义
    expect(mcp.activeToolDefs).toHaveBeenCalled();
    // 执行路由到 MCP（非 plugin 网关）
    expect(mcp.callTool).toHaveBeenCalledWith('echo', { v: 42 });

    // 工具卡三态：pending（§3 core）+ result（§4 执行后）
    const toolCalls = sent.filter((s) => s.channel === 'chat.toolCall');
    expect(toolCalls.map((t) => t.params.call.phase)).toEqual(['pending', 'result']);
    expect(toolCalls[1]!.params.call.result).toBe('MCP:echo:{"v":42}');

    // 回灌：最终回复含 MCP 结果（tool-worker 回显 tool 消息）
    const text = sent
      .filter((s) => s.channel === 'chat.stream')
      .map((s) => s.params.text)
      .join('');
    expect(text).toContain('MCP:echo:');
  });

  it('§7 Trace 工具可见性：provider.stream 记 toolsSent/toolCalls，回灌重发记 turn.reprompt', async () => {
    const collector = createTraceCollector({ broadcast: () => {}, enabled: () => true });
    const sent: Sent[] = [];
    const mcp: McpToolPort = {
      activeToolDefs: () => [
        { name: 'echo', description: 'echo it', parameters: { type: 'object' } },
      ],
      callTool: async (name: string, args: unknown) => `MCP:${name}:${JSON.stringify(args)}`,
    };
    svc = new ChatService({
      providerEntryPath: TOOL_ENTRY,
      broadcast: (c, p) => sent.push({ channel: c, params: p }),
      providerChain: ['openai'],
      queue: { flushIntervalMs: 5 },
      mcp,
      trace: collector,
    });
    svc.send('s1', 'use a tool');
    await until(() => !!doneOf(sent, 's1'), 'traced tool reprompt done');

    const recs = collector.history();
    // 每轮 provider 流封口一条：首轮发了 1 个工具、模型调了 1 次；回灌轮 tools 保留、无再调。
    expect(recs.filter((r) => r.action === 'provider.stream').map((r) => r.fields)).toEqual([
      { toolsSent: 1, toolCalls: 1 },
      { toolsSent: 1, toolCalls: 0 },
    ]);
    // 回灌重发一条：二轮请求消息数（原始 user + assistant 载体 + tool 结果 ≥3）与 tools 字段保留。
    const reprompt = recs.find((r) => r.action === 'turn.reprompt');
    expect(reprompt?.fields).toMatchObject({ tools: 1 });
    expect((reprompt?.fields as { messages: number }).messages).toBeGreaterThanOrEqual(3);
    // 时间线顺序：首轮 stream → 回灌 → 二轮 stream。
    const seq = recs
      .map((r) => r.action)
      .filter((a) => a === 'provider.stream' || a === 'turn.reprompt');
    expect(seq).toEqual(['provider.stream', 'turn.reprompt', 'provider.stream']);
  });

  it('mcp.callTool 抛 → 广播 error 相 + 回灌 error 文本', async () => {
    const sent: Sent[] = [];
    const mcp: McpToolPort = {
      activeToolDefs: () => [{ name: 'echo', description: '', parameters: {} }],
      callTool: async () => {
        throw new Error('tool boom');
      },
    };
    svc = new ChatService({
      providerEntryPath: TOOL_ENTRY,
      broadcast: (c, p) => sent.push({ channel: c, params: p }),
      providerChain: ['openai'],
      queue: { flushIntervalMs: 5 },
      mcp,
    });
    svc.send('s1', 'use a tool');
    await until(() => !!doneOf(sent, 's1'), 'mcp tool error done');

    const toolCalls = sent.filter((s) => s.channel === 'chat.toolCall');
    const last = toolCalls.at(-1)!;
    expect(last.params.call.phase).toBe('error');
    expect(last.params.call.result).toContain('tool boom');
  });
});
