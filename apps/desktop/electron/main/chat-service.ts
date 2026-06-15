/**
 * ChatService — chat 域的 Main 侧编排（纯模块，不依赖 Electron）。
 *
 * 管线：ProviderHost(worker 监督) → ConversationCore(双轨拆分) →
 *       SessionStore(运行时状态机/快照/seq) + ConversationStore(SQLite 持久化) +
 *       NotificationQueue(背压) → broadcast。
 *
 * M6：上下文经 ContextAssembler 组装（system prompt 人设+persona + 最近 20 轮）；
 *     每轮 done(stop) 后用本轮 intent 演进 persona_state；数据管理（storageUsage/
 *     exportData）下沉到这里（ipc-router 暴露为 app.* RPC）。
 *
 * 取消三层传播（tech-design §3 要点 3）：renderer 发 chat.cancel 后——
 *   ① core.cancel：迟到 delta 丢弃（半截标签 buffer 一并废弃）
 *   ② queue.dropSession：待发通知瞬间清空 → UI 立即停
 *   ③ host.cancel：协作取消 + 200ms watchdog 强杀兜底
 * done(cancel) 回流时封口存储并 urgent flush，全链路 ≤ 宽限期。
 */
import { statSync } from 'node:fs';
import {
  DEFAULT_PERSONA_STATE,
  updatePersonaState,
  type ChatEvent,
  type ChatRequest,
  type StorageUsage,
} from '@desksoul/protocol';
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
import { createConversationStore, MemoryStore, type ConversationStore } from './db/index.js';
import { assembleContext } from './context-assembler.js';
import { exportDsbak } from './db/export-bundle.js';
import { RpcError } from './router.js';

export interface CharacterRef {
  id: string;
  name: string;
  emotions?: readonly string[];
  actions?: readonly string[];
}

export interface ChatServiceOptions {
  providerEntryPath: string;
  broadcast: (channel: string, params: unknown) => void;
  /** 持久化后端实例；缺省纯内存 MemoryStore（测试）。生产由 ipc-router 注入 SqliteStore。 */
  store?: ConversationStore;
  /** 当前角色（ContextAssembler + 角色隔离）；缺省 default/小灵。 */
  character?: () => CharacterRef;
  /** SqliteStore 源 db 路径（导出快照用）；缺省导出仅含 manifest。 */
  sqlitePath?: string;
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

const DEFAULT_CHARACTER: CharacterRef = { id: 'default', name: '小灵' };

export class ChatService {
  private readonly conv: ConversationStore;
  private readonly session: SessionStore;
  private readonly getCharacter: () => CharacterRef;
  private readonly sqlitePath: string | undefined;
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
  /** 本轮最近一次 intent（驱动每轮结束的 persona 演进）。 */
  private readonly lastIntent = new Map<string, { mood: string; energy: string }>();

  constructor(opts: ChatServiceOptions) {
    this.providerChain =
      opts.providerChain ?? (opts.defaultProviderId ? [opts.defaultProviderId] : []);
    this.conv = opts.store ?? new MemoryStore();
    this.getCharacter = opts.character ?? (() => DEFAULT_CHARACTER);
    this.sqlitePath = opts.sqlitePath;
    this.session = new SessionStore({ store: this.conv, characterId: this.getCharacter().id });
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
    if (this.session.isStreaming(sessionId)) {
      throw new RpcError(-32001, `session busy: ${sessionId} is still streaming`);
    }
    const chain = providerId ? [providerId] : this.providerChain;
    // ContextAssembler：system prompt(人设+persona+行为标签规约) + 最近 20 轮 + 当前 user。
    const request = assembleContext({
      store: this.conv,
      character: this.getCharacter(),
      sessionId,
      userText: text,
    });
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
    this.session.appendUser(sessionId, text);
    this.session.beginAssistant(sessionId);
    return { ok: true };
  }

  cancel(sessionId: string): { ok: true } {
    // 无在途流时不设 cancelling 标记——否则标记无 done 来清，会吞掉下一个流
    if (!this.session.isStreaming(sessionId)) return { ok: true };
    this.core.cancel(sessionId); // ①
    this.queue.dropSession(sessionId); // ②
    this.host.cancel(sessionId); // ③
    return { ok: true };
  }

  snapshot(sessionId: string, limit?: number): SessionSnapshot {
    return this.session.snapshot(sessionId, limit);
  }

  /** D7 存储占用（app.storageUsage 后端）。 */
  storageUsage(): StorageUsage {
    return this.conv.storageUsage();
  }

  /** 一键导出 .dsbak（app.exportData 后端）：DB + manifest，无密钥。 */
  async exportData(outPath: string): Promise<{ ok: true; bytes: number }> {
    await exportDsbak(this.conv, outPath, this.sqlitePath ? { sqlitePath: this.sqlitePath } : {});
    return { ok: true, bytes: statSync(outPath).size };
  }

  /** provider 事件入口：usage 落账；tool_call 收集；首 delta 前 error 降级；其余交 ConversationCore。 */
  private onProviderEvent(sessionId: string, event: ChatEvent): void {
    if (event.type === 'usage') {
      this.session.recordUsage(sessionId, event.prompt, event.completion);
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
        const seq = this.session.appendDelta(n.sessionId, n.params.text);
        this.queue.push({
          channel: n.channel,
          sessionId: n.sessionId,
          params: { ...n.params, seq },
        });
        return;
      }
      case 'behavior.setIntent':
        // 记录本轮基调，done(stop) 时演进 persona；同时照常下发渲染端。
        this.lastIntent.set(n.sessionId, { mood: n.params.mood, energy: n.params.energy });
        this.queue.push({ channel: n.channel, sessionId: n.sessionId, params: n.params });
        return;
      case 'chat.done':
        this.session.finishAssistant(n.sessionId, n.params.finishReason);
        if (n.params.finishReason === 'stop') this.updatePersona(n.sessionId);
        this.lastIntent.delete(n.sessionId);
        this.queue.push({ channel: n.channel, sessionId: n.sessionId, params: n.params }, {
          urgent: true,
        });
        return;
      default:
        this.queue.push({ channel: n.channel, sessionId: n.sessionId, params: n.params });
    }
  }

  /** 每轮结束演进 persona_state（亲密度 +1、本轮 intent、互动时间）。 */
  private updatePersona(sessionId: string): void {
    const cid = this.getCharacter().id;
    const prev = this.conv.getPersonaState(cid) ?? DEFAULT_PERSONA_STATE;
    const ts = Date.now();
    const intent = this.lastIntent.get(sessionId);
    this.conv.putPersonaState(cid, updatePersonaState(prev, { ...(intent ?? {}), ts }), ts);
  }

  /** 仅测试：模拟 provider worker 崩溃。 */
  killWorkerForTest(): void {
    this.host.killWorkerForTest();
  }

  async dispose(): Promise<void> {
    this.core.dispose(); // 先停：不再向 queue 产出（stale/gate 定时器全清）
    this.queue.dispose();
    this.session.dispose();
    await this.host.dispose();
  }
}
