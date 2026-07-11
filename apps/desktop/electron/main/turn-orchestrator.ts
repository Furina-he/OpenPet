/**
 * TurnOrchestrator —— 一轮对话在途的 provider 编排（arch-evolution #2 拆分产物）。
 *
 * 从 ChatService 迁出：TurnState + turns Map、onProviderEvent 的「首 delta 前降级 /
 * tool_call 收集 / done(stop) 工具回灌」、runToolsAndReprompt。usage 记账与
 * ConversationCore 路由留在 ChatService（session 依赖）：onProviderEvent 返回
 * 'consumed'（本层吞掉：降级重试 / 回灌轮）或 'passthrough'（ChatService 再交 core）。
 */
import type { Adapter, ChatEvent, ChatRequest } from '@openpet/protocol';
import type { ProviderHost } from './provider-host.js';
import type { PluginGateway } from './plugin-gateway.js';
import type { McpToolPort } from './chat-service.js';
import type { TraceSpanHandle } from './trace-collector.js';

/** 一轮对话在途的 provider 编排态（降级链 + 工具回灌）。 */
interface TurnState {
  /** 降级链 [primary, ...fallbacks]；空数组 = mock 路径（无 provider 配置）。 */
  chain: string[];
  /** 当前尝试的链下标。 */
  idx: number;
  /** 复用的请求（工具回灌时在末尾追加 tool 消息）。 */
  request: ChatRequest;
  /** 本轮是否已产出 delta（首 delta 后不再降级）。 */
  sawDelta: boolean;
  /** 本轮是否已做过工具回灌（单轮，防无限循环）。 */
  toolRound: boolean;
  /** 当前 provider 的自定义 Base URL（通常是 OpenAI 兼容中转站 / source.apiBase）。 */
  baseUrl?: string;
  /** 当前 source 的 adapter（worker 据此选 provider fn）；与 baseUrl 同属 baseProviderId。 */
  adapter?: Adapter;
  /** baseUrl/adapter 归属 provider，降级到其它 provider 时不能误用。 */
  baseProviderId?: string;
  /** 累积本轮 provider 产出的 tool_call，done(stop) 时统一执行 + 回灌。 */
  pendingTools: Array<{ id: string; name: string; args: unknown }>;
  /** §7：本轮 trace span（降级/工具埋点）；缺省不记。 */
  span?: TraceSpanHandle;
}

/** start() 的路由目标（ChatService 由 resolveSendTarget 解出后传入）。 */
export interface TurnTarget {
  chain: string[];
  baseUrl?: string | undefined;
  adapter?: Adapter | undefined;
  baseProviderId?: string | undefined;
}

export interface TurnOrchestratorDeps {
  host: ProviderHost;
  plugins: PluginGateway;
  mcp?: McpToolPort | undefined;
  /** chat.toolCall result/error 相直发（§4 工具卡三态闭环）。 */
  broadcast: (channel: string, params: unknown) => void;
  /** F-IT T4：一轮工具全部执行完（回灌前）——ChatService 借此 markToolEnd 取消 toolLong 定时。 */
  onToolsExecuted?: ((sessionId: string) => void) | undefined;
}

export class TurnOrchestrator {
  private readonly host: ProviderHost;
  private readonly plugins: PluginGateway;
  private readonly mcp: McpToolPort | undefined;
  private readonly broadcast: (channel: string, params: unknown) => void;
  private readonly onToolsExecuted: ((sessionId: string) => void) | undefined;
  /**
   * 在途轮的 provider 编排态（降级/首delta/工具回灌）。生命周期绑定「provider
   * 事件流」：done 时随 onProviderEvent 清理。一轮一个对象。
   */
  private readonly turns = new Map<string, TurnState>();

  constructor(deps: TurnOrchestratorDeps) {
    this.host = deps.host;
    this.plugins = deps.plugins;
    this.mcp = deps.mcp;
    this.broadcast = deps.broadcast;
    this.onToolsExecuted = deps.onToolsExecuted;
  }

  /** 开启一轮：登记在途态 + host.send。host.send 抛错时不留在途态（原样上抛，调用方转 RpcError）。 */
  start(sessionId: string, request: ChatRequest, target: TurnTarget, span?: TraceSpanHandle): void {
    const { chain, baseUrl, adapter, baseProviderId } = target;
    this.turns.set(sessionId, {
      chain,
      idx: 0,
      request,
      sawDelta: false,
      toolRound: false,
      ...(baseUrl ? { baseUrl, baseProviderId } : {}),
      ...(adapter ? { adapter } : {}),
      ...(span ? { span } : {}),
      pendingTools: [],
    });
    try {
      // chain 空 = mock 路径（无 provider 配置）：不带 providerId/request。
      this.host.send(
        sessionId,
        chain.length > 0
          ? {
              providerId: chain[0]!,
              request,
              ...(baseUrl && chain[0] === baseProviderId ? { baseUrl } : {}),
              ...(adapter && chain[0] === baseProviderId ? { adapter } : {}),
            }
          : {},
      );
    } catch (e) {
      this.turns.delete(sessionId); // 失败的发送不留在途态
      throw e;
    }
  }

  /**
   * provider 事件编排：tool_call 收集；首 delta 前 error 降级；done(stop) 工具回灌。
   * 返回 'consumed'（本层吞掉）或 'passthrough'（ChatService 交 ConversationCore）。
   */
  onProviderEvent(sessionId: string, event: ChatEvent): 'consumed' | 'passthrough' {
    const turn = this.turns.get(sessionId);
    if (event.type === 'tool_call') {
      turn?.pendingTools.push({ id: event.id, name: event.name, args: event.args });
      // C′ §3：passthrough 让 core 驱动 Hub 工具卡(pending) + 桌宠 searching 线索（不影响 done(stop) 回灌收集）。
      return 'passthrough';
    }
    if (event.type === 'delta' && turn) turn.sawDelta = true;
    // 首 delta 前 error → 顺位降级（同一对话只顺位一次到链尾）。
    if (event.type === 'done' && event.finishReason === 'error' && turn && !turn.sawDelta) {
      if (turn.idx + 1 < turn.chain.length) {
        turn.idx += 1;
        turn.span?.record('provider.fallback', {
          from: turn.chain[turn.idx - 1] ?? '',
          to: turn.chain[turn.idx] ?? '',
          ...(event.error ? { error: event.error } : {}),
        });
        try {
          const providerId = turn.chain[turn.idx]!;
          this.host.send(sessionId, {
            providerId,
            request: turn.request,
            ...(turn.baseUrl && providerId === turn.baseProviderId
              ? { baseUrl: turn.baseUrl }
              : {}),
            ...(turn.adapter && providerId === turn.baseProviderId
              ? { adapter: turn.adapter }
              : {}),
          });
          return 'consumed'; // 吞掉本次 error done，等下一个 provider 接管
        } catch {
          // worker 不可用（如刚崩溃、onDeath 正在清算在途流）：无法顺位重试。
          // 必须吞掉异常——否则会冒泡打断 onDeath 的清算/重生调度并让 session 永挂——
          // 落到下方按 error 封口本轮。
        }
      }
    }
    // §7 工具可见性：每轮 provider 流封口记 toolsSent/toolCalls——一条记录分清
    // 「工具没附上」(toolsSent=0)与「发了但模型没调」(toolsSent>0 且 toolCalls=0，中转站吞 tools 常见)。
    if (event.type === 'done' && event.finishReason === 'stop' && turn) {
      turn.span?.record('provider.stream', {
        toolsSent: turn.request.tools?.length ?? 0,
        toolCalls: turn.pendingTools.length,
      });
    }
    // done(stop) 且本轮有未回灌的 tool_call → 执行 + 回灌一轮。
    if (
      event.type === 'done' &&
      event.finishReason === 'stop' &&
      turn &&
      turn.pendingTools.length > 0 &&
      !turn.toolRound
    ) {
      turn.toolRound = true;
      const tools = turn.pendingTools;
      turn.pendingTools = [];
      void this.runToolsAndReprompt(sessionId, turn, tools);
      return 'consumed'; // 吞掉本轮 done，等回灌轮
    }
    if (event.type === 'done') this.turns.delete(sessionId);
    return 'passthrough';
  }

  /** 执行 tool_call（MCP 优先，plugin.invokeTool 兜底）→ 广播 result/error 相 → tool 消息回灌 → 同 provider 重发一次。 */
  private async runToolsAndReprompt(
    sessionId: string,
    turn: TurnState,
    tools: Array<{ id: string; name: string; args: unknown }>,
  ): Promise<void> {
    const toolMessages: Array<{ role: 'tool'; content: string; toolCallId: string }> = [];
    for (const t of tools) {
      // pending 相已由 onProviderEvent→core 在收到 tool_call 事件时发过（§3）；此处执行后补 result/error。
      turn.span?.record('tool.call', { name: t.name });
      let result: string;
      let phase: 'result' | 'error' = 'result';
      try {
        if (this.mcp) {
          // MVP：tool_call 均来自 MCP 注入的工具，直接走 callTool；未配 mcp 时回退 plugin 网关。
          result = await this.mcp.callTool(t.name, t.args);
        } else {
          const r = await this.plugins.handle({
            kind: 'plugin.request',
            rpc: {
              jsonrpc: '2.0',
              id: 1,
              method: 'plugin.invokeTool',
              params: { toolId: t.name, args: t.args },
            },
          });
          if (r.rpc.error) {
            phase = 'error';
            result = `error: ${r.rpc.error.message}`;
          } else {
            const value = (r.rpc.result as { value: unknown }).value;
            result = typeof value === 'string' ? value : JSON.stringify(value);
          }
        }
      } catch (e) {
        phase = 'error';
        result = `error: ${e instanceof Error ? e.message : String(e)}`;
      }
      // §4：补发工具卡 result/error 相（§3 工具卡三态闭环；走与 pending 同一 chat.toolCall 通道）。
      this.broadcast('chat.toolCall', {
        sessionId,
        call: { id: t.id, name: t.name, phase, result },
      });
      turn.span?.record('tool.result', { name: t.name, phase, chars: result.length });
      toolMessages.push({ role: 'tool', content: result, toolCallId: t.id });
    }
    // §5：先补 assistant(tool_calls) 载体消息再接 tool 结果——openai 规范序列，严格端点不再 400。
    const assistantToolMsg = {
      role: 'assistant' as const,
      content: '',
      toolCalls: tools.map((t) => ({
        id: t.id,
        name: t.name,
        argsJson: JSON.stringify(t.args ?? {}),
      })),
    };
    turn.request = {
      ...turn.request,
      messages: [...turn.request.messages, assistantToolMsg, ...toolMessages],
    };
    this.onToolsExecuted?.(sessionId);
    turn.span?.record('turn.reprompt', {
      messages: turn.request.messages.length,
      tools: turn.request.tools?.length ?? 0,
    });
    const providerId = turn.chain[turn.idx]!;
    this.host.send(sessionId, {
      providerId,
      request: turn.request,
      ...(turn.baseUrl && providerId === turn.baseProviderId ? { baseUrl: turn.baseUrl } : {}),
      ...(turn.adapter && providerId === turn.baseProviderId ? { adapter: turn.adapter } : {}),
    });
  }
}
