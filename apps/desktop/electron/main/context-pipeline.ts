/**
 * ContextPipeline —— chat.send 的前置上下文管道（arch-evolution #2 拆分产物）。
 *
 * 有序 stage 数组（照 AstrBot STAGES_ORDER 声明式）：kb/memory/lore/summary 四个检索
 * stage **并行**（⑮ spec §5，互不依赖各写 bag 槽位，延迟 ≈ 最慢单项）→ toolsStage →
 * assembleContext。§6 Persona 等后续能力只加 stage，不动 ChatService。
 *
 * kbStage 带 1.5s 超时兜底（arch-evolution #5）：检索超时/异常 → 空 hits，不阻断对话。
 */
import {
  activateLorebook,
  type ChatRequest,
  type ChatTool,
  type PackLorebook,
} from '@openpet/protocol';
import { assembleContext, type MemoryInjection } from './context-assembler.js';

/** retrieveMemory 返回形状（memory-service.MemoryRetrieval 的管道视角；stats 只进 trace）。 */
export interface MemoryRetrievalLite extends MemoryInjection {
  stats?: { resident: number; keyword: number; vector: number; chars: number };
}
import type { ConversationStore } from './db/index.js';

export interface PipelineCharacterRef {
  id: string;
  name: string;
  emotions?: readonly string[];
  actions?: readonly string[];
}

export interface ContextPipelineDeps {
  store: ConversationStore;
  character: () => PipelineCharacterRef;
  /** §5 自动 RAG 检索器；缺省不检索。 */
  retrieveKb?: ((query: string) => Promise<{ text: string }[]>) | undefined;
  /** ⑲ 三路记忆检索器（memory-service.retrieveForChat）；history = 最近消息（与 lore 同源）。缺省不注入。 */
  retrieveMemory?:
    | ((query: string, history: readonly string[]) => Promise<MemoryRetrievalLite>)
    | undefined;
  /** §4 MCP 工具定义源；缺省无工具。 */
  mcp?: { activeToolDefs: (serverActive: (id: string) => boolean) => ChatTool[] } | undefined;
  /** §6 当前生效 persona（绑定>默认>null=内置）；ipc-router 注入 persona-service.resolveFor。 */
  persona?: (() => { systemPrompt: string; beginDialogs: string[] } | null) | undefined;
  /** ⑫ 当前角色 lorebook 供给（ipc-router 注入 characters.current().manifest.lorebook）；缺省不注入。 */
  lorebook?: (() => PackLorebook | null) | undefined;
  /** ⑫ 宏上下文供给（chat.userName / 语言 / 12 小时制）；缺省组装侧不展开宏。 */
  macroUser?: (() => { user: string; locale?: string; hour12?: boolean }) | undefined;
  /** ⑮ 会话滚动摘要供给（纯 store 读 + 开关门，ipc-router 注入）；null = 无摘要/开关关。 */
  sessionSummary?: ((sessionId: string) => string | null) | undefined;
  /** ⑭ 风格锚供给（包锚 > 全局文案 > 内置；总闸关 = null）。ipc-router 注入。 */
  styleAnchor?: (() => string | null) | undefined;
}

export interface BuildInput {
  sessionId: string;
  userText: string;
  model?: string | undefined;
  /** §7：本轮 trace 记录器（chat-service 绑 span 后传入）；缺省不记。 */
  trace?: ((action: string, fields?: Record<string, unknown>) => void) | undefined;
}

/** KB 检索在发送路径上的最长等待；超时放行（空 hits）。 */
export const KB_RETRIEVE_TIMEOUT_MS = 1500;
/** ⑲ memoryStage 关键词路扫描的最近消息条数（= MEMORY_QUOTAS.keywordScanDepth）。 */
export const MEMORY_HISTORY_DEPTH = 4;

interface StageBag {
  kbHits: { text: string }[];
  memory: MemoryInjection | null;
  loreHits: string[];
  sessionSummary: string;
  tools: ChatTool[];
}

export interface ContextPipeline {
  build(input: BuildInput): Promise<ChatRequest>;
}

export function createContextPipeline(deps: ContextPipelineDeps): ContextPipeline {
  const kbStage = async (input: BuildInput, bag: StageBag): Promise<void> => {
    if (!deps.retrieveKb) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      bag.kbHits = await Promise.race([
        deps.retrieveKb(input.userText),
        new Promise<{ text: string }[]>((resolve) => {
          timer = setTimeout(() => resolve([]), KB_RETRIEVE_TIMEOUT_MS);
        }),
      ]);
    } catch {
      /* embed/检索失败 → 跳过注入，对话照常 */
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
    input.trace?.('context.kb', { hits: bag.kbHits.length });
  };

  const memoryStage = async (input: BuildInput, bag: StageBag): Promise<void> => {
    // ⑲ 三路记忆注入（镜像 kbStage——1.5s 超时、异常放行，检索失败不阻断对话）。
    // history 取最近 4 条（与 lore scanDepth 同口径，关键词路扫描窗）。
    if (!deps.retrieveMemory) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let got: MemoryRetrievalLite | null = null;
    try {
      const history = deps.store
        .recentMessages(deps.character().id, input.sessionId, MEMORY_HISTORY_DEPTH)
        .map((r) => r.text);
      got = await Promise.race([
        deps.retrieveMemory(input.userText, history),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), KB_RETRIEVE_TIMEOUT_MS);
        }),
      ]);
    } catch {
      /* 记忆检索失败 → 跳过注入 */
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
    if (got && (got.resident.length > 0 || got.pages.length > 0))
      bag.memory = { resident: got.resident, pages: got.pages };
    input.trace?.(
      'context.memory',
      got?.stats ?? {
        resident: got?.resident.length ?? 0,
        keyword: got?.pages.length ?? 0,
        vector: 0,
        chars: 0,
      },
    );
  };

  const loreStage = async (input: BuildInput, bag: StageBag): Promise<void> => {
    // ⑫ Lorebook：关键词扫描（最近 scanDepth 条 + 当前输入）→ 命中 content 注入「世界设定」块。
    const book = deps.lorebook?.() ?? null;
    if (!book || book.entries.length === 0) return;
    const history = deps.store
      .recentMessages(deps.character().id, input.sessionId, book.scanDepth)
      .map((r) => r.text);
    bag.loreHits = activateLorebook(book, { history, current: input.userText });
    input.trace?.('context.lore', { hits: bag.loreHits.length });
  };

  const summaryStage = async (input: BuildInput, bag: StageBag): Promise<void> => {
    // ⑮ 会话滚动摘要：纯 store 读（无 LLM、无超时竞速），开关门在供给侧。
    if (!deps.sessionSummary) return;
    bag.sessionSummary = deps.sessionSummary(input.sessionId) ?? '';
    input.trace?.('context.summary', { present: bag.sessionSummary.length > 0 });
  };

  const toolsStage = async (_input: BuildInput, bag: StageBag): Promise<void> => {
    // §4：注入 active MCP 工具定义（worker buildBody 映射成 provider tools）。
    bag.tools = deps.mcp?.activeToolDefs(() => true) ?? [];
  };

  // ⑮ 并行检索（spec §5）：四个检索 stage 互不依赖（各写 bag 自己的槽位），并行后
  // 组装产物与串行逐字节一致；任一 stage 抛错吞掉（检索是增益，不阻断对话）。
  const retrievalStages = [kbStage, memoryStage, loreStage, summaryStage];

  return {
    async build(input: BuildInput): Promise<ChatRequest> {
      const bag: StageBag = {
        kbHits: [],
        memory: null,
        loreHits: [],
        sessionSummary: '',
        tools: [],
      };
      await Promise.all(retrievalStages.map((stage) => stage(input, bag).catch(() => {})));
      await toolsStage(input, bag); // 同步取定义，无 IO
      // ContextAssembler：system prompt(人设+persona+行为标签规约 + §5 参考资料) + 最近 20 轮 + 当前 user。
      const personaSel = deps.persona?.() ?? null;
      const mc = deps.macroUser?.();
      const anchor = deps.styleAnchor?.() ?? null;
      const assembled = assembleContext({
        store: deps.store,
        character: deps.character(),
        sessionId: input.sessionId,
        userText: input.userText,
        ...(input.model ? { model: input.model } : {}),
        ...(bag.kbHits.length > 0 ? { kbHits: bag.kbHits } : {}),
        ...(bag.memory ? { memory: bag.memory } : {}),
        ...(bag.loreHits.length > 0 ? { loreHits: bag.loreHits } : {}),
        ...(bag.sessionSummary ? { sessionSummary: bag.sessionSummary } : {}),
        ...(mc ? { macroCtx: mc } : {}),
        ...(anchor ? { styleAnchor: anchor } : {}),
        ...(personaSel
          ? { personaPrompt: personaSel.systemPrompt, beginDialogs: personaSel.beginDialogs }
          : {}),
      });
      // 空 tools 不设，避免空 tools 干扰 provider。
      const request: ChatRequest =
        bag.tools.length > 0 ? { ...assembled, tools: bag.tools } : assembled;
      input.trace?.('context.assembled', {
        messages: request.messages.length,
        tools: bag.tools.map((t) => t.name),
        persona: personaSel !== null,
      });
      return request;
    },
  };
}
