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
import type { ChatEvent } from '@desksoul/protocol';

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
}

export class ChatService {
  private readonly store: SessionStore;
  private readonly queue: NotificationQueue;
  private readonly core: ConversationCore;
  private readonly host: ProviderHost;
  readonly plugins: PluginGateway;
  private readonly defaultProviderId: string | undefined;

  constructor(opts: ChatServiceOptions) {
    this.defaultProviderId = opts.defaultProviderId;
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
    const pid = providerId ?? this.defaultProviderId;
    // 组装 messages：历史（已封口的 user/assistant 干净文本）+ 当前 user 输入
    const history = this.store
      .snapshot(sessionId, 40)
      .messages.filter((m) => m.text.length > 0)
      .map((m) => ({ role: m.role, content: m.text }));
    const request = { messages: [...history, { role: 'user' as const, content: text }] };
    try {
      this.host.send(sessionId, pid ? { providerId: pid, request } : {});
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

  /** provider 事件入口：usage 落账（不进双轨）；其余交 ConversationCore 拆分。 */
  private onProviderEvent(sessionId: string, event: ChatEvent): void {
    if (event.type === 'usage') {
      this.store.recordUsage(sessionId, event.prompt, event.completion);
      return;
    }
    this.core.handleEvent(sessionId, event);
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
