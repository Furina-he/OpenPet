/**
 * ContextPipeline —— chat.send 的前置上下文管道（arch-evolution #2 拆分产物）。
 *
 * 有序 stage 数组（照 AstrBot STAGES_ORDER 声明式）：kbStage → toolsStage 收集
 * { kbHits, tools } 后 assembleContext。§6 Persona 等后续能力只加 stage，不动 ChatService。
 *
 * kbStage 带 1.5s 超时兜底（arch-evolution #5）：检索超时/异常 → 空 hits，不阻断对话。
 */
import type { ChatRequest, ChatTool } from '@openpet/protocol';
import { assembleContext } from './context-assembler.js';
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
  /** 批次⑥ 长期记忆检索器（memory-service.retrieveForChat）；缺省不注入。 */
  retrieveMemory?: ((query: string) => Promise<string[]>) | undefined;
  /** §4 MCP 工具定义源；缺省无工具。 */
  mcp?: { activeToolDefs: (serverActive: (id: string) => boolean) => ChatTool[] } | undefined;
  /** §6 当前生效 persona（绑定>默认>null=内置）；ipc-router 注入 persona-service.resolveFor。 */
  persona?: (() => { systemPrompt: string; beginDialogs: string[] } | null) | undefined;
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

interface StageBag {
  kbHits: { text: string }[];
  memories: string[];
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
    // 批次⑥：长期记忆注入（镜像 kbStage——1.5s 超时、异常放行，检索失败不阻断对话）。
    if (!deps.retrieveMemory) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      bag.memories = await Promise.race([
        deps.retrieveMemory(input.userText),
        new Promise<string[]>((resolve) => {
          timer = setTimeout(() => resolve([]), KB_RETRIEVE_TIMEOUT_MS);
        }),
      ]);
    } catch {
      /* 记忆检索失败 → 跳过注入 */
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
    input.trace?.('context.memory', { hits: bag.memories.length });
  };

  const toolsStage = async (_input: BuildInput, bag: StageBag): Promise<void> => {
    // §4：注入 active MCP 工具定义（worker buildBody 映射成 provider tools）。
    bag.tools = deps.mcp?.activeToolDefs(() => true) ?? [];
  };

  const stages = [kbStage, memoryStage, toolsStage];

  return {
    async build(input: BuildInput): Promise<ChatRequest> {
      const bag: StageBag = { kbHits: [], memories: [], tools: [] };
      for (const stage of stages) await stage(input, bag);
      // ContextAssembler：system prompt(人设+persona+行为标签规约 + §5 参考资料) + 最近 20 轮 + 当前 user。
      const personaSel = deps.persona?.() ?? null;
      const assembled = assembleContext({
        store: deps.store,
        character: deps.character(),
        sessionId: input.sessionId,
        userText: input.userText,
        ...(input.model ? { model: input.model } : {}),
        ...(bag.kbHits.length > 0 ? { kbHits: bag.kbHits } : {}),
        ...(bag.memories.length > 0 ? { memories: bag.memories } : {}),
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
