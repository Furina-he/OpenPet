import { createHash } from 'node:crypto';
import {
  buildRelationshipLine,
  buildSystemPrompt,
  DEFAULT_PERSONA_STATE,
  expandMacros,
  type ChatRequest,
} from '@openpet/protocol';
import type { ConversationStore } from './db/store.js';

/** ⑲ 「记忆」块输入：resident = 常驻块（已带 ### 小标题）；pages = 命中页。 */
export interface MemoryInjection {
  resident: string[];
  pages: Array<{ title: string; body: string }>;
}

const MEMORY_HEADER =
  '## 记忆（关于用户与我们的过往，供参考，自然使用，勿逐条复述；与当前对话冲突时以当前为准）';
const RECALL_HEADER =
  '## 相关记忆（这一轮想起的，供参考，自然使用，勿逐条复述；与当前对话冲突时以当前为准）';

function block(
  header: string,
  parts: readonly string[],
  expand: (t: string) => string,
): string {
  return parts.length === 0 ? '' : `${header}\n${parts.map((m) => expand(m)).join('\n\n')}`;
}

const pageParts = (memory: MemoryInjection | undefined): string[] =>
  (memory?.pages ?? []).map((p) => `### ${p.title}\n${p.body}`);

/**
 * ㉒ 「记忆」块渲染（组装链与「试一句」预览共用 = 所见即所注入）；无内容 → ''。
 * expand = 宏展开（组装链传 {{char}}/{{user}} 上下文，预览传恒等）。㉔ 缓存友好关时的旧布局。
 */
export function formatMemoryBlock(
  memory: MemoryInjection | undefined,
  expand: (t: string) => string = (t) => t,
): string {
  return block(MEMORY_HEADER, [...(memory?.resident ?? []), ...pageParts(memory)], expand);
}

/** ㉔ 缓存友好布局：稳定前缀里只放常驻（档案 / 关系 / 最近经历，分钟到小时级才变）。 */
export function formatResidentBlock(
  memory: MemoryInjection | undefined,
  expand: (t: string) => string = (t) => t,
): string {
  return block(MEMORY_HEADER, memory?.resident ?? [], expand);
}

/** ㉔ 缓存友好布局：句尾易变块里放这一轮想起的（名字 / 块混合命中）。 */
export function formatRecallBlock(
  memory: MemoryInjection | undefined,
  expand: (t: string) => string = (t) => t,
): string {
  return block(RECALL_HEADER, pageParts(memory), expand);
}

/** ㉔ 「试一句」预览按当前布局拼（所见即所注入）：开 = 常驻块 + 相关记忆块；关 = 旧合并块。 */
export function formatMemoryPreview(memory: MemoryInjection, cacheFriendly: boolean): string {
  if (!cacheFriendly) return formatMemoryBlock(memory);
  return [formatResidentBlock(memory), formatRecallBlock(memory)].filter(Boolean).join('\n\n');
}

/** Working Memory 窗口（tech-design §8：最近 N=20 轮原始消息）。 */
export const WORKING_TURNS = 20;
/** ㉔ 分档窗口的跳档步长。 */
export const WINDOW_STEP = 10;

/**
 * ㉔ §4.2 分档窗口：会话消息数 n > 20 时带最近 20 + (n − 20) mod 10 条（20–29 条），起点每 10 条才跳
 * 一次，其间历史前缀逐轮不变；n ≤ 20 全带（与旧窗口相同）。
 */
export function workingWindow(n: number): number {
  return n <= WORKING_TURNS ? n : WORKING_TURNS + ((n - WORKING_TURNS) % WINDOW_STEP);
}

/**
 * ㉔ §4.3 稳定前缀摘要：开头 system + 开场白（beginCount 条）的 sha1 前 8 位与字数——诊断页里
 * 连续几轮 hash 相同即前缀稳定。
 */
export function prefixDigest(
  messages: ChatRequest['messages'],
  beginCount = 0,
): { hash: string; chars: number } {
  const head = messages.slice(0, 1 + beginCount).map((m) => [m.role, m.content]);
  return {
    hash: createHash('sha1').update(JSON.stringify(head)).digest('hex').slice(0, 8),
    chars: head.reduce((n, [, c]) => n + String(c).length, 0),
  };
}

export interface AssembleInput {
  store: ConversationStore;
  character: {
    id: string;
    name: string;
    emotions?: readonly string[];
    actions?: readonly string[];
  };
  sessionId: string;
  userText: string;
  /** 当前选定模型；下沉到 ChatRequest.model（worker honor）。 */
  model?: string;
  /**
   * §5 自动 RAG：知识库检索片段，非空时追加到 system 末尾「参考资料」块。
   * **只进 LLM 上下文**——不进 chat.stream / 不喂 behavior-parser（§7 桌宠核心边界）。
   */
  kbHits?: { text: string }[];
  /** ⑲ 记忆 wiki 三路注入产物（常驻块 + 命中页）；同 kbHits 只进 system。 */
  memory?: MemoryInjection;
  /** §6 用户自定义人设正文；缺省内置一句。 */
  personaPrompt?: string;
  /** §6 情景开场白（偶数条 user/assistant 交替）；只进请求不持久化（照 AstrBot _no_save）。 */
  beginDialogs?: string[];
  /** ⑫ Lorebook 命中内容（loreStage 产物）；注入 base 之后的「世界设定」块。 */
  loreHits?: string[];
  /** ⑮ 会话滚动摘要（summaryStage 产物）；「早前对话摘要」块排 lore 后、长期记忆前（更贴会话语境）。 */
  sessionSummary?: string;
  /** ⑫ 宏展开上下文（{{char}}/{{user}}/{{time}}/{{date}}/{{random}}）；缺省不展开（向后兼容）。 */
  macroCtx?: { user: string; locale?: string; hour12?: boolean };
  /** ⑭ 风格锚：以 system 消息插在 history 之后、当前 user 之前（近生成点服从度最高，spec §1）。 */
  styleAnchor?: string;
  /** ⑱ 当前心情 [-1,1]（MoodState.current()）→ 【关系记忆】语气句。 */
  moodValue?: number;
  /**
   * ㉔ 缓存友好布局（缺省 false = 本批前布局，逐字节不变）：稳定前缀（人设 + 规约 + 摘要 + 常驻记忆）
   * + 分档历史窗口 + 句尾一条易变 system（关系记忆 + 世界设定 + 相关记忆 + 参考资料 + 风格锚）。
   */
  cacheFriendly?: boolean;
}

/**
 * 组装单轮 ChatRequest（MVP：Working + Persona，tech-design §8）。
 * messages = [system(人设 + persona 摘要 + 行为标签规约 + §5 参考资料), ...最近 20 轮(非空), {user, 当前输入}]。
 * Episodic 向量召回 / Semantic 事实硬注入 / token budget packing 留 V1+。
 */
export function assembleContext(input: AssembleInput): ChatRequest {
  const cache = input.cacheFriendly === true;
  const limit = cache
    ? workingWindow(input.store.messageStats(input.character.id, input.sessionId).count)
    : WORKING_TURNS;
  // ⑭ {{idle_duration}} 数据源：history 最后一条消息距今的毫秒数（无历史不注入，宏原样保留）。
  const rows =
    limit > 0 ? input.store.recentMessages(input.character.id, input.sessionId, limit) : [];
  const lastTs = [...rows].reverse().find((r) => typeof r.ts === 'number')?.ts;
  const idleMs = lastTs !== undefined ? Math.max(0, Date.now() - lastTs) : undefined;
  const mc = input.macroCtx;
  const ex = mc
    ? (t: string) =>
        expandMacros(t, {
          char: input.character.name,
          user: mc.user,
          ...(mc.locale ? { locale: mc.locale } : {}),
          ...(mc.hour12 !== undefined ? { hour12: mc.hour12 } : {}),
          ...(idleMs !== undefined ? { idleMs } : {}),
        })
    : (t: string) => t;
  const persona = input.store.getPersonaState(input.character.id) ?? DEFAULT_PERSONA_STATE;
  const base = buildSystemPrompt({
    name: input.character.name,
    persona,
    ...(cache ? { relationshipInPrefix: false } : {}),
    ...(input.moodValue !== undefined ? { moodValue: input.moodValue } : {}),
    ...(input.personaPrompt ? { personaPrompt: ex(input.personaPrompt) } : {}),
    ...(input.character.emotions ? { emotions: input.character.emotions } : {}),
    ...(input.character.actions ? { actions: input.character.actions } : {}),
  });
  // §5 RAG 片段注入 system 末尾；编号引用，提示模型仅供参考。
  const kbBlock =
    input.kbHits && input.kbHits.length > 0
      ? `\n\n## 参考资料（知识库检索，仅供参考，勿照搬无关内容）\n${input.kbHits
          .map((h, i) => `[${i + 1}] ${h.text}`)
          .join('\n\n')}`
      : '';
  // ⑲ 「记忆」块（memoryStage 三路产物）：常驻 + `### 标题` 命中页；宏同口径展开；只进 system。
  // ㉔ 缓存友好：常驻进前缀、命中进句尾（两半按注入顺序拼 = 试一句预览）。
  const para = (t: string): string => (t ? `\n\n${t}` : '');
  const memoryBlock = para(
    cache ? formatResidentBlock(input.memory, ex) : formatMemoryBlock(input.memory, ex),
  );
  // ⑫ 世界设定（Lorebook 命中）；宏先展开再拼块。
  const loreBlock =
    input.loreHits && input.loreHits.length > 0
      ? `\n\n## 世界设定（背景资料，自然运用，勿逐条复述）\n${input.loreHits.map((t) => ex(t)).join('\n\n')}`
      : '';
  // ⑮ 早前对话摘要（本会话窗口外内容的压缩视图）。
  const summaryBlock = input.sessionSummary
    ? `\n\n## 早前对话摘要（本会话更早的内容，供参考，自然衔接勿复述）\n${input.sessionSummary}`
    : '';
  const history = rows
    .filter((r) => r.text.length > 0)
    .map((r) => ({ role: r.role, content: r.text }));
  // §6 开场白：user/assistant 交替，插在 system 与 history 之间（只进请求不持久化）。
  const beginMsgs = (input.beginDialogs ?? []).map((text, i) => ({
    role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
    content: ex(text),
  }));
  if (cache) {
    // 稳定前缀：人设 + 规约 + 早前对话摘要 + 常驻记忆（逐轮不变）
    const prefix = base + summaryBlock + memoryBlock;
    // 句尾易变块（一条）：关系记忆 + 世界设定 + 相关记忆 + 参考资料 + 风格锚（锚最后，离生成点最近）
    const tail = [
      buildRelationshipLine({
        persona,
        ...(input.moodValue !== undefined ? { moodValue: input.moodValue } : {}),
      }) ?? '',
      loreBlock.trim(),
      formatRecallBlock(input.memory, ex),
      kbBlock.trim(),
      input.styleAnchor ? ex(input.styleAnchor) : '',
    ]
      .filter(Boolean)
      .join('\n\n');
    return {
      messages: [
        { role: 'system', content: prefix },
        ...beginMsgs,
        ...history,
        ...(tail ? [{ role: 'system' as const, content: tail }] : []),
        { role: 'user', content: input.userText },
      ],
      ...(input.model ? { model: input.model } : {}),
    };
  }
  const system = base + loreBlock + summaryBlock + memoryBlock + kbBlock;
  return {
    messages: [
      { role: 'system', content: system },
      ...beginMsgs,
      ...history,
      ...(input.styleAnchor ? [{ role: 'system' as const, content: ex(input.styleAnchor) }] : []),
      { role: 'user', content: input.userText },
    ],
    ...(input.model ? { model: input.model } : {}),
  };
}
