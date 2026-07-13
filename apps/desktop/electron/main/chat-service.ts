/**
 * ChatService — chat 域的 Main 侧 RPC 面 + 装配（纯模块，不依赖 Electron）。
 *
 * 管线：ProviderHost(worker 监督) → TurnOrchestrator(降级链/工具回灌) →
 *       ConversationCore(双轨拆分) → SessionStore(运行时状态机/快照/seq) +
 *       ConversationStore(SQLite 持久化) + NotificationQueue(背压) → broadcast。
 *
 * arch-evolution #2 拆分：send 前置上下文（§5 RAG + §4 tools + ContextAssembler）
 * 归 ContextPipeline；在途轮编排（首 delta 前降级 / done(stop) 工具回灌）归
 * TurnOrchestrator。本类只留 RPC 面、usage/persona 记账与通知分流。
 *
 * 取消三层传播（tech-design §3 要点 3）：renderer 发 chat.cancel 后——
 *   ① core.cancel：迟到 delta 丢弃（半截标签 buffer 一并废弃）
 *   ② queue.dropSession：待发通知瞬间清空 → UI 立即停
 *   ③ host.cancel：协作取消 + 200ms watchdog 强杀兜底
 * done(cancel) 回流时封口存储并 urgent flush，全链路 ≤ 宽限期。
 */
import { statSync } from 'node:fs';
import {
  DEFAULT_CUES,
  DEFAULT_PERSONA_STATE,
  DEFAULT_PREFS,
  updatePersonaState,
  type ChatEvent,
  type ChatTarget,
  type ChatTool,
  type StorageUsage,
} from '@openpet/protocol';
import { ConversationCore, type Notification } from './conversation-core.js';
import { InteractionService } from './interaction-service.js';
import { MoodState } from './mood-state.js';
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
import { createContextPipeline, type ContextPipeline } from './context-pipeline.js';
import { TurnOrchestrator } from './turn-orchestrator.js';
import { resolveSendTarget } from './chat-resolve.js';
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
  /** 动态解析当前 chat 目标（无显式 providerId 时用）；ipc-router 从 prefs 注入（两层 resolveChatTarget）。 */
  resolveModel?: () => ChatTarget | null;
  /**
   * MCP 工具端口（§4）：注入 active 工具定义 + 执行工具调用。结构类型，避免硬依赖 McpManager。
   * 缺省=无工具（保持现状，测试不回归）。serverActive 已在 mcp-service 同步进 manager（仅 active
   * server 在 runtimes），故 ChatService 传 `() => true` 即取全部已连接工具。
   */
  mcp?: McpToolPort;
  /**
   * §5 自动 RAG：每轮 send 前 embed 用户输入 → 检索 → 注入 system「参考资料」（ContextPipeline
   * kbStage，1.5s 超时兜底）。缺省=不检索。ipc-router 装配时构造注入（单向依赖）。
   */
  retrieveKb?: (query: string) => Promise<{ text: string }[]>;
  /** 批次⑥ F-AI-06：长期记忆检索（memoryStage 注入源）；缺省=不注入。 */
  retrieveMemory?: (query: string) => Promise<string[]>;
  /** 批次⑥：轮末（done stop）钩子——memory-extractor 提炼入口；fire-and-forget。 */
  onTurnEnd?: (sessionId: string) => void;
  /**
   * 批次⑥ F-AI-08 预算门：send 入口调用，返回错误文案 = 拦截（抛 -32003）、null = 放行。
   * ipc-router 注入（读 budget.* prefs + store.usageSummary 自然月聚合）。
   */
  budgetGate?: () => string | null;
  /**
   * F-IT T4：cue 引擎。缺省内置真引擎（DEFAULT_CUES + 内存 mood + 默认 prefs）——
   * 既有 e2e 表现（thinking/searching/confused）经引擎照旧发生。ipc-router 注入
   * 带真 prefs/manifest.cues 的实例；测试可注入 fake / 无 cooldown 实例。
   */
  interactions?: InteractionService;
  /** §6：当前生效 persona 解析器；缺省 null = 内置人设。ipc-router 注入。 */
  persona?: () => { systemPrompt: string; beginDialogs: string[] } | null;
  /** ⑫ 当前角色 lorebook（loreStage 供给）；缺省不注入。ipc-router 注入。 */
  lorebook?: () => import('@openpet/protocol').PackLorebook | null;
  /** ⑫ 宏上下文（chat.userName / 语言 / 12 小时制）；缺省组装侧不展开宏。ipc-router 注入。 */
  macroUser?: () => { user: string; locale?: string; hour12?: boolean };
  /** ⑭ 风格锚（包锚>全局>内置；总闸关 = null）；缺省不注入。ipc-router 注入。 */
  styleAnchor?: () => string | null;
  /** §7：诊断时间线采集器；缺省不埋点。ipc-router 注入。 */
  trace?: import('./trace-collector.js').TraceCollector;
  /**
   * 线 B-2 T7：send 前置拦截（AstrBot Star 命令短路 LLM）。返回文本 = 本轮回复直接
   * 走正常通知面（气泡/IM 回发/入历史全复用，不碰 provider）；null = 放行走 LLM。
   * ipc-router 注入 starHost.tryHandle 闭包；实现方须自行兜底超时（绝不阻塞聊天）。
   */
  intercept?: (sessionId: string, text: string) => Promise<string | null>;
  /**
   * ⑬ 表情分类兜底钩子：整轮（stop 收尾）零 behavior.applyEmotion 且非拦截轮时，
   * 以本轮干净文本调用（fire-and-forget，实现方自行静默失败）。ipc-router 注入
   * emotion-fallback 模块（含 im: 会话门与 pref 门）。
   */
  emotionFallback?: (sessionId: string, cleanText: string) => void;
}

/** ChatService 对 McpManager 的最小需求（§4）。 */
export interface McpToolPort {
  activeToolDefs: (serverActive: (id: string) => boolean) => ChatTool[];
  callTool: (name: string, args: unknown) => Promise<string>;
}

const DEFAULT_CHARACTER: CharacterRef = { id: 'default', name: '小灵' };

/** arch-evolution #3：通知路由表——channel → 背压队列 or 直发（未列出默认 queue）。新增 channel = 加一行。 */
const CHANNEL_ROUTES: Record<string, { path: 'queue' | 'direct'; urgent?: boolean }> = {
  'chat.stream': { path: 'queue' },
  'behavior.setIntent': { path: 'queue' },
  'chat.done': { path: 'queue', urgent: true },
  // C′ §3：Hub 消费的推理/工具流——直发 broadcast，不进双轨背压队列（无合并/快照重放需求）。
  'chat.reasoning': { path: 'direct' },
  'chat.toolCall': { path: 'direct' },
};

export class ChatService {
  private readonly conv: ConversationStore;
  private readonly session: SessionStore;
  private readonly getCharacter: () => CharacterRef;
  private readonly sqlitePath: string | undefined;
  private readonly queue: NotificationQueue;
  /** chat.reasoning/chat.toolCall 直发通道（C′ §3，旁路背压队列）。 */
  private readonly broadcast: (channel: string, params: unknown) => void;
  /** F-IT T4：cue 引擎（chat.reasoning/tool/toolLong/error/done 领域事件 → 桌宠表现）。 */
  private readonly interactions: InteractionService;
  private readonly core: ConversationCore;
  private readonly host: ProviderHost;
  readonly plugins: PluginGateway;
  private readonly providerChain: string[];
  /** 无显式 providerId 时，从 prefs 取当前 chat 目标（ipc-router 注入两层 resolveChatTarget）。 */
  private readonly resolveModel: (() => ChatTarget | null) | undefined;
  private readonly intercept: ((sessionId: string, text: string) => Promise<string | null>) | undefined;
  /** send 前置上下文管道（§5 RAG + §4 tools + ContextAssembler）。 */
  private readonly pipeline: ContextPipeline;
  /** 在途轮编排（降级链 / 工具回灌）。 */
  private readonly orchestrator: TurnOrchestrator;
  /**
   * send 在途预占（§5）：send 变 async 后，pipeline.build 的 await 窗口内同 session 二次 send
   * 可能漏过 isStreaming 检查。同步预占此 set 关掉竞态；beginAssistant 后由 isStreaming 接管。
   */
  private readonly sending = new Set<string>();
  /**
   * 本轮最近一次 intent（驱动每轮结束的 persona 演进）。
   * **刻意独立于 orchestrator 的 turns**：它绑定的是「通知流」而非「provider 事件流」——<wait/>
   * 发射门会把 chat.done 通知延后到 provider 流早已结束之后，updatePersona 那时才读
   * intent。若随 provider-event done 一起清，门控的 done 会读到空 intent，
   * persona 静默丢基调。故由 onNotification(chat.done) 负责删（见下）。
   */
  private readonly lastIntent = new Map<string, { mood: string; energy: string }>();
  /** ⑬ 本轮兜底追踪：saw=模型吐过 emo；text=干净文本累积（capped）；intercepted=Star 命令轮。 */
  private readonly fallbackTurn = new Map<
    string,
    { saw: boolean; text: string; intercepted: boolean }
  >();
  private readonly emotionFallback:
    | ((sessionId: string, cleanText: string) => void)
    | undefined;
  /** §7 Trace：collector + 本轮 span（生命周期同 lastIntent——绑通知流，chat.done 时封口删除）。 */
  private readonly traceC: import('./trace-collector.js').TraceCollector | undefined;
  private readonly traceSpans = new Map<string, import('./trace-collector.js').TraceSpanHandle>();
  /** 批次⑥：轮末钩子（memory-extractor.onTurnEnd）；done(stop) 时 fire-and-forget。 */
  private readonly onTurnEnd: ((sessionId: string) => void) | undefined;
  /** 批次⑥ F-AI-08：预算门（返回文案=拦截）。 */
  private readonly budgetGate: (() => string | null) | undefined;

  constructor(opts: ChatServiceOptions) {
    this.providerChain =
      opts.providerChain ?? (opts.defaultProviderId ? [opts.defaultProviderId] : []);
    this.resolveModel = opts.resolveModel;
    this.intercept = opts.intercept;
    this.traceC = opts.trace;
    this.conv = opts.store ?? new MemoryStore();
    this.getCharacter = opts.character ?? (() => DEFAULT_CHARACTER);
    this.sqlitePath = opts.sqlitePath;
    this.session = new SessionStore({
      store: this.conv,
      characterId: () => this.getCharacter().id,
    });
    this.queue = new NotificationQueue(opts.broadcast, opts.queue ?? {});
    this.broadcast = opts.broadcast;
    this.plugins = createPluginGateway(opts.plugins ?? {});
    // F-IT T4：缺省内置真引擎——DEFAULT_CUES + 进程内 mood + 默认 prefs（无 DND/主动语音等
    // 策略差异影响非主动 cue），保证裸构造（测试）下 thinking/searching/confused 表现照旧。
    this.interactions = opts.interactions ?? ChatService.defaultInteractions(opts.broadcast);
    this.core = new ConversationCore((n) => this.onNotification(n), {
      cue: (e, sid) => {
        this.interactions.trigger(e);
        if (e === 'chat.tool') this.interactions.markToolStart(sid);
      },
    });
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
    this.pipeline = createContextPipeline({
      store: this.conv,
      character: () => this.getCharacter(),
      retrieveKb: opts.retrieveKb,
      retrieveMemory: opts.retrieveMemory,
      mcp: opts.mcp,
      persona: opts.persona,
      lorebook: opts.lorebook,
      macroUser: opts.macroUser,
      styleAnchor: opts.styleAnchor,
    });
    this.onTurnEnd = opts.onTurnEnd;
    this.budgetGate = opts.budgetGate;
    this.emotionFallback = opts.emotionFallback;
    this.orchestrator = new TurnOrchestrator({
      host: this.host,
      plugins: this.plugins,
      mcp: opts.mcp,
      broadcast: opts.broadcast,
      onToolsExecuted: (sid) => this.interactions.markToolEnd(sid),
    });
  }

  /** 裸构造（无 ipc-router 装配）时的内置 cue 引擎：默认表 + 进程内 mood + 默认 prefs。 */
  private static defaultInteractions(
    broadcast: (channel: string, params: unknown) => void,
  ): InteractionService {
    let moodPref = { value: 0, updatedAt: 0 };
    return new InteractionService({
      cues: () => DEFAULT_CUES,
      broadcast,
      getPrefs: () => DEFAULT_PREFS,
      mood: new MoodState({
        getPref: () => moodPref,
        setPref: (v) => {
          moodPref = v;
        },
      }),
    });
  }

  send(sessionId: string, text: string, providerId?: string): Promise<{ ok: true }> {
    // busy 检查同步抛（在任何 await 前），并同步预占 sending —— 关掉 pipeline await 窗口的竞态。
    if (this.session.isStreaming(sessionId) || this.sending.has(sessionId)) {
      throw new RpcError(-32001, `session busy: ${sessionId} is still streaming`);
    }
    // 批次⑥ F-AI-08：预算超限门（pause 模式），同步拦截——不进 pipeline / 不进历史。
    const blocked = this.budgetGate?.();
    if (blocked) throw new RpcError(-32003, blocked);
    this.sending.add(sessionId);
    return this.sendInner(sessionId, text, providerId).finally(() =>
      this.sending.delete(sessionId),
    );
  }

  private async sendInner(
    sessionId: string,
    text: string,
    providerId?: string,
  ): Promise<{ ok: true }> {
    const resolved = providerId ? undefined : this.resolveModel?.();
    const { chain, model, adapter, baseUrl } = resolveSendTarget(
      providerId,
      this.providerChain,
      resolved,
    );
    const baseProviderId = resolved?.sourceId;
    // §7：一轮一 span；outline 只取用户输入前 60 字符（隐私口径 spec §3.1）。
    const span = this.traceC?.span(sessionId, text.slice(0, 60));
    if (span) this.traceSpans.set(sessionId, span);
    span?.record('turn.start', {
      chain,
      ...(model ? { model } : {}),
      ...(adapter ? { adapter } : {}),
    });
    // 线 B-2 T7：Star 命令短路——命中即以拦截文本收轮（正常通知面：stream/done/历史/IM 回发全复用）。
    const intercepted = (await this.intercept?.(sessionId, text)) ?? null;
    if (intercepted !== null) {
      span?.record('turn.intercepted', { by: 'star' });
      this.trackTurn(sessionId).intercepted = true; // ⑬ 命令输出不做表情分类
      this.session.appendUser(sessionId, text);
      this.session.beginAssistant(sessionId);
      this.core.handleEvent(sessionId, { type: 'delta', text: intercepted });
      this.core.handleEvent(sessionId, { type: 'done', finishReason: 'stop' });
      return { ok: true };
    }
    const request = await this.pipeline.build({
      sessionId,
      userText: text,
      model,
      ...(span ? { trace: (a: string, f?: Record<string, unknown>) => span.record(a, f) } : {}),
    });
    try {
      this.orchestrator.start(sessionId, request, { chain, baseUrl, adapter, baseProviderId }, span);
    } catch {
      throw new RpcError(-32002, 'provider unavailable (worker restarting)');
    }
    // host.send 成功才入账：失败的发送不进历史
    this.session.appendUser(sessionId, text);
    this.session.beginAssistant(sessionId);
    return { ok: true };
  }

  /**
   * §5：把 embed 请求转给 ProviderHost.embed（绑定两层 embedding target）。
   * target=null（未配 embedding 模型）→ 抛错，由 kb-service/调用方兜底。
   */
  async embed(inputs: string[], target: ChatTarget | null): Promise<number[][]> {
    if (!target) throw new Error('未配置 embedding 模型');
    return this.host.embed(inputs, {
      model: target.model,
      baseUrl: target.apiBase,
      adapter: target.adapter,
    });
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

  /** provider 事件入口：usage 落账；编排（降级/回灌）交 orchestrator；passthrough 再交 ConversationCore。 */
  private onProviderEvent(sessionId: string, event: ChatEvent): void {
    if (event.type === 'usage') {
      this.session.recordUsage(sessionId, event.prompt, event.completion);
      this.traceSpans
        .get(sessionId)
        ?.record('turn.usage', { prompt: event.prompt, completion: event.completion });
      return;
    }
    if (this.orchestrator.onProviderEvent(sessionId, event) === 'consumed') return;
    this.core.handleEvent(sessionId, event);
  }

  private onNotification(n: Notification): void {
    const params = this.bookkeep(n);
    const route = CHANNEL_ROUTES[n.channel] ?? { path: 'queue' as const };
    if (route.path === 'direct') {
      this.broadcast(n.channel, params);
    } else if (route.urgent) {
      this.queue.push({ channel: n.channel, sessionId: n.sessionId, params }, { urgent: true });
    } else {
      this.queue.push({ channel: n.channel, sessionId: n.sessionId, params });
    }
  }

  /** 每通道记账副作用（seq 注入 / intent 记录 / 轮封口），返回最终下发 params。 */
  private trackTurn(sessionId: string): { saw: boolean; text: string; intercepted: boolean } {
    let t = this.fallbackTurn.get(sessionId);
    if (!t) {
      t = { saw: false, text: '', intercepted: false };
      this.fallbackTurn.set(sessionId, t);
    }
    return t;
  }

  private bookkeep(n: Notification): unknown {
    switch (n.channel) {
      case 'chat.stream': {
        // 先入账拿 seq 再入队：保证 snapshot.seq ≥ 一切已广播/待广播的 seq
        const seq = this.session.appendDelta(n.sessionId, n.params.text);
        const turn = this.trackTurn(n.sessionId);
        if (turn.text.length < 800) turn.text += n.params.text; // ⑬ 分类只需开头 800 字符
        return { ...n.params, seq };
      }
      case 'behavior.applyEmotion':
        this.trackTurn(n.sessionId).saw = true; // ⑬ 模型合作，本轮不需兜底
        return n.params;
      case 'behavior.setIntent':
        // 记录本轮基调，done(stop) 时演进 persona；同时照常下发渲染端。
        this.lastIntent.set(n.sessionId, { mood: n.params.mood, energy: n.params.energy });
        return n.params;
      case 'chat.done':
        this.session.finishAssistant(n.sessionId, n.params.finishReason);
        this.interactions.markToolEnd(n.sessionId); // 轮已封口，toolLong 定时不再有意义
        if (n.params.finishReason === 'stop') {
          this.updatePersona(n.sessionId);
          this.interactions.trigger('chat.done'); // mood 累积（无 cue 表项，不发表现）
          this.onTurnEnd?.(n.sessionId); // 批次⑥：轮末记忆提炼（fire-and-forget，不 await）
          const fb = this.fallbackTurn.get(n.sessionId);
          if (fb && !fb.saw && !fb.intercepted && fb.text.trim().length > 0 && this.emotionFallback) {
            this.traceSpans
              .get(n.sessionId)
              ?.record('turn.emotionFallback', { textLen: fb.text.length });
            this.emotionFallback(n.sessionId, fb.text); // ⑬ fire-and-forget，不延迟 done
          }
        }
        if (n.params.finishReason === 'error') {
          // J3：错误时驱动角色"歪头"——领域事件经 cue 表（confused + droop）。
          this.interactions.trigger('chat.error');
        }
        this.lastIntent.delete(n.sessionId);
        this.fallbackTurn.delete(n.sessionId);
        this.traceSpans.get(n.sessionId)?.record('turn.done', {
          finishReason: n.params.finishReason,
          ...(n.params.errorKind ? { errorKind: n.params.errorKind } : {}),
        });
        this.traceSpans.delete(n.sessionId);
        return n.params;
      default:
        return n.params;
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
    this.interactions.dispose(); // toolLong 定时器清空（引擎归 ipc-router 所有时此调用幂等无害）
    this.queue.dispose();
    this.session.dispose();
    await this.host.dispose();
  }
}
