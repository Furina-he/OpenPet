import {
  buildSystemPrompt,
  DEFAULT_PERSONA_STATE,
  expandMacros,
  type ChatRequest,
} from '@openpet/protocol';
import type { ConversationStore } from './db/store.js';

/** Working Memory 窗口（tech-design §8：最近 N=20 轮原始消息）。 */
export const WORKING_TURNS = 20;

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
  /** 批次⑥ F-AI-06：长期记忆事实（pinned 全量 + 余弦 top3）；同 kbHits 只进 system。 */
  memories?: string[];
  /** §6 用户自定义人设正文；缺省内置一句。 */
  personaPrompt?: string;
  /** §6 情景开场白（偶数条 user/assistant 交替）；只进请求不持久化（照 AstrBot _no_save）。 */
  beginDialogs?: string[];
  /** ⑫ Lorebook 命中内容（loreStage 产物）；注入 base 之后的「世界设定」块。 */
  loreHits?: string[];
  /** ⑫ 宏展开上下文（{{char}}/{{user}}/{{time}}/{{date}}/{{random}}）；缺省不展开（向后兼容）。 */
  macroCtx?: { user: string; locale?: string; hour12?: boolean };
  /** ⑭ 风格锚：以 system 消息插在 history 之后、当前 user 之前（近生成点服从度最高，spec §1）。 */
  styleAnchor?: string;
}

/**
 * 组装单轮 ChatRequest（MVP：Working + Persona，tech-design §8）。
 * messages = [system(人设 + persona 摘要 + 行为标签规约 + §5 参考资料), ...最近 20 轮(非空), {user, 当前输入}]。
 * Episodic 向量召回 / Semantic 事实硬注入 / token budget packing 留 V1+。
 */
export function assembleContext(input: AssembleInput): ChatRequest {
  // ⑭ {{idle_duration}} 数据源：history 最后一条消息距今的毫秒数（无历史不注入，宏原样保留）。
  const rows = input.store.recentMessages(input.character.id, input.sessionId, WORKING_TURNS);
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
  // 批次⑥ 长期记忆段（memoryStage 检索产物）；同 kbBlock 只进 system。
  const memoryBlock =
    input.memories && input.memories.length > 0
      ? `\n\n## 关于用户的长期记忆（供参考，自然使用，勿逐条复述）\n${input.memories
          .map((m) => `- ${m}`)
          .join('\n')}`
      : '';
  // ⑫ 世界设定（Lorebook 命中）；宏先展开再拼块。
  const loreBlock =
    input.loreHits && input.loreHits.length > 0
      ? `\n\n## 世界设定（背景资料，自然运用，勿逐条复述）\n${input.loreHits.map((t) => ex(t)).join('\n\n')}`
      : '';
  const system = base + loreBlock + memoryBlock + kbBlock;
  const history = rows
    .filter((r) => r.text.length > 0)
    .map((r) => ({ role: r.role, content: r.text }));
  // §6 开场白：user/assistant 交替，插在 system 与 history 之间（只进请求不持久化）。
  const beginMsgs = (input.beginDialogs ?? []).map((text, i) => ({
    role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
    content: ex(text),
  }));
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
