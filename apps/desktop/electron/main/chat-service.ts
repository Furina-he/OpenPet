/**
 * ChatService — chat 域的 Main 侧编排（纯模块，不依赖 Electron）。
 *
 * 管线：ProviderHost(worker 监督) → ConversationCore(双轨拆分) →
 *       SessionStore(记录/快照/seq) + NotificationQueue(背压) → broadcast。
 *
 * 取消三层传播（tech-design §3 要点 3）：renderer 发 chat.cancel 后——
 *   ① core.cancel：迟到 delta 丢弃（半截标签 buffer 一并废弃）
 *   ② queue.dropSession：待发通知瞬间清空 → UI 立即停
 *   ③ host.cancel：协作取消 + 200ms watchdog 强杀兜底
 * done(cancel) 回流时封口存储并 urgent flush，全链路 ≤ 宽限期。
 *
 * plugin.*（Worker → Main）经 PluginGateway 校验分发；M5 扩展为多 worker。
 */
import { ConversationCore, type Notification } from './conversation-core.js';
import { ProviderHost, type ProviderHostOptions } from './provider-host.js';
import { SessionStore, type SessionSnapshot } from './session-store.js';
import { NotificationQueue, type NotificationQueueOptions } from './notification-queue.js';
import {
  createPluginGateway,
  type PluginGateway,
  type PluginGatewayDeps,
} from './plugin-gateway.js';
import { createFetchGateway, type FetchGatewayDeps } from './fetch-gateway.js';
import { RpcError } from './router.js';
import type { ChatEvent, ChatRequest } from '@desksoul/protocol';

export interface ChatServiceOptions {
  providerEntryPath: string;
  broadcast: (channel: string, params: unknown) => void;
  /** 会话历史 JSON 持久化路径；缺省纯内存（测试）。 */
  persistPath?: string;
  queue?: NotificationQueueOptions;
  host?: ProviderHostOptions;
  plugins?: PluginGatewayDeps;
  /** 代理 fetch 网关依赖（agent + 白名单 + 密钥注入）；缺省不挂（mock 不发 fetch）。 */
  fetch?: FetchGatewayDeps;
  /** 默认 provider id（chat.send 未指定时用）；缺省则走 mock（intervalMs）路径。 */
  defaultProviderId?: string;
  /** 降级链 [primary, ...fallbacks]；优先于 defaultProviderId。首 delta 前失败顺位重试一次。 */
  providerChain?: string[];
}

export class ChatService {
  private readonly store: SessionStore;
  private readonly queue: NotificationQueue;
  private readonly core: ConversationCore;
  private readonly host: ProviderHost;
  readonly plugins: PluginGateway;
  private readonly providerChain: string[];
  /** 本轮是否已产出 delta（首 delta 后不再降级）。 */
  private readonly sawDelta = new Map<string, boolean>();
  /** 在途降级尝试：链 + 当前下标 + 复用的 request。 */
  private readonly attempt = new Map<
    string,
    { chain: string[]; idx: number; request: ChatRequest }
  >();
  /** 本轮是否已做过工具回灌（单轮，防无限循环）。 */
  private readonly toolRound = new Map<string, boolean>();
  /** 累积本轮 provider 产出的 tool_call，done 时统一执行 + 回灌。 */
  private readonly pendingTools = new Map<
    string,
    Array<{ id: string; name: string; args: unknown }>
  >();

  constructor(opts: ChatServiceOptions) {
    this.providerChain =
      opts.providerChain ?? (opts.defaultProviderId ? [opts.defaultProviderId] : []);
    this.store = new SessionStore(opts.persistPath ? { persistPath: opts.persistPath } : {});
    this.queue = new NotificationQueue(opts.broadcast, opts.queue ?? {});
    this.plugins = createPluginGateway(opts.plugins ?? {});
    this.core = new ConversationCore((n) => this.onNotification(n));
    const fetchGateway = opts.fetch ? createFetchGateway(opts.fetch) : null;
    this.host = new ProviderHost(
      opts.providerEntryPath,
      (sessionId, event) => this.onProviderEvent(sessionId, event),
      {
        ...(opts.host ?? {}),
        onPluginRequest: (frame) => this.plugins.handle(frame),
        ...(fetchGateway
          ? {
              onFetchRequest: (frame, send) => fetchGateway.handle(frame, send),
              onFetchCancelAll: () => fetchGateway.cancelAll(),
            }
          : {}),
      },
    );
  }

  send(sessionId: string, text: string, providerId?: string): { ok: true } {
    if (this.store.isStreaming(sessionId)) {
      throw new RpcError(-32001, `session busy: ${sessionId} is still streaming`);
    }
    const chain = providerId ? [providerId] : this.providerChain;
    // 组装 messages：历史（已封口的 user/assistant 干净文本）+ 当前 user 输入
    const history = this.store
      .snapshot(sessionId, 40)
      .messages.filter((m) => m.text.length > 0)
      .map((m) => ({ role: m.role, content: m.text }));
    const request = { messages: [...history, { role: 'user' as const, content: text }] };
    try {
      if (chain.length > 0) {
        this.attempt.set(sessionId, { chain, idx: 0, request });
        this.sawDelta.set(sessionId, false);
        this.host.send(sessionId, { providerId: chain[0]!, request });
      } else {
        this.host.send(sessionId, {}); // mock 路径（无 provider 配置）
      }
    } catch {
      throw new RpcError(-32002, 'provider unavailable (worker restarting)');
    }
    // host.send 成功才入账：失败的发送不进历史
    this.store.appendUser(sessionId, text);
    this.store.beginAssistant(sessionId);
    return { ok: true };
  }

  cancel(sessionId: string): { ok: true } {
    // 无在途流时不设 cancelling 标记——否则标记无 done 来清，会吞掉下一个流
    if (!this.store.isStreaming(sessionId)) return { ok: true };
    this.core.cancel(sessionId); // ①
    this.queue.dropSession(sessionId); // ②
    this.host.cancel(sessionId); // ③
    return { ok: true };
  }

  snapshot(sessionId: string, limit?: number): SessionSnapshot {
    return this.store.snapshot(sessionId, limit);
  }

  /** provider 事件入口：usage 落账；tool_call 收集；首 delta 前 error 降级；其余交 ConversationCore。 */
  private onProviderEvent(sessionId: string, event: ChatEvent): void {
    if (event.type === 'usage') {
      this.store.recordUsage(sessionId, event.prompt, event.completion);
      return;
    }
    if (event.type === 'tool_call') {
      const list = this.pendingTools.get(sessionId) ?? [];
      list.push({ id: event.id, name: event.name, args: event.args });
      this.pendingTools.set(sessionId, list);
      return; // 不进双轨
    }
    if (event.type === 'delta') this.sawDelta.set(sessionId, true);
    if (event.type === 'done' && event.finishReason === 'error' && !this.sawDelta.get(sessionId)) {
      const a = this.attempt.get(sessionId);
      if (a && a.idx + 1 < a.chain.length) {
        a.idx += 1;
        this.host.send(sessionId, { providerId: a.chain[a.idx]!, request: a.request });
        return; // 吞掉本次 error done，等下一个 provider 接管（同一对话只顺位一次到链尾）
      }
    }
    if (event.type === 'done' && event.finishReason === 'stop') {
      const tools = this.pendingTools.get(sessionId);
      const att = this.attempt.get(sessionId);
      if (tools && tools.length > 0 && att && !this.toolRound.get(sessionId)) {
        this.toolRound.set(sessionId, true);
        this.pendingTools.delete(sessionId);
        void this.runToolsAndReprompt(sessionId, att, tools);
        return; // 吞掉本轮 done，等回灌轮
      }
    }
    this.core.handleEvent(sessionId, event);
    if (event.type === 'done') {
      this.sawDelta.delete(sessionId);
      this.attempt.delete(sessionId);
      this.toolRound.delete(sessionId);
      this.pendingTools.delete(sessionId);
    }
  }

  /** 执行 tool_call（经 PluginGateway.invokeTool）→ tool 消息回灌 → 同 provider 重发一次。 */
  private async runToolsAndReprompt(
    sessionId: string,
    att: { chain: string[]; idx: number; request: ChatRequest },
    tools: Array<{ id: string; name: string; args: unknown }>,
  ): Promise<void> {
    const toolMessages: Array<{ role: 'tool'; content: string }> = [];
    for (const t of tools) {
      let result: unknown;
      try {
        const r = await this.plugins.handle({
          kind: 'plugin.request',
          rpc: {
            jsonrpc: '2.0',
            id: 1,
            method: 'plugin.invokeTool',
            params: { toolId: t.name, args: t.args },
          },
        });
        result = r.rpc.result
          ? (r.rpc.result as { value: unknown }).value
          : `error: ${r.rpc.error?.message}`;
      } catch (e) {
        result = `error: ${e instanceof Error ? e.message : String(e)}`;
      }
      toolMessages.push({
        role: 'tool',
        content: typeof result === 'string' ? result : JSON.stringify(result),
      });
    }
    const nextRequest = { ...att.request, messages: [...att.request.messages, ...toolMessages] };
    this.attempt.set(sessionId, { ...att, request: nextRequest });
    this.host.send(sessionId, { providerId: att.chain[att.idx]!, request: nextRequest });
  }

  private onNotification(n: Notification): void {
    switch (n.channel) {
      case 'chat.stream': {
        // 先入账拿 seq 再入队：保证 snapshot.seq ≥ 一切已广播/待广播的 seq
        const seq = this.store.appendDelta(n.sessionId, n.params.text);
        this.queue.push({
          channel: n.channel,
          sessionId: n.sessionId,
          params: { ...n.params, seq },
        });
        return;
      }
      case 'chat.done':
        this.store.finishAssistant(n.sessionId, n.params.finishReason);
        this.queue.push({ channel: n.channel, sessionId: n.sessionId, params: n.params }, {
          urgent: true,
        });
        return;
      default:
        this.queue.push({ channel: n.channel, sessionId: n.sessionId, params: n.params });
    }
  }

  /** 仅测试：模拟 provider worker 崩溃。 */
  killWorkerForTest(): void {
    this.host.killWorkerForTest();
  }

  async dispose(): Promise<void> {
    this.core.dispose(); // 先停：不再向 queue 产出（stale/gate 定时器全清）
    this.queue.dispose();
    this.store.dispose();
    await this.host.dispose();
  }
}
