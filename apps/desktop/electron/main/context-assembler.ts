import { buildSystemPrompt, DEFAULT_PERSONA_STATE, type ChatRequest } from '@desksoul/protocol';
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
}

/**
 * 组装单轮 ChatRequest（MVP：Working + Persona，tech-design §8）。
 * messages = [system(人设 + persona 摘要 + 行为标签规约), ...最近 20 轮(非空), {user, 当前输入}]。
 * Episodic 向量召回 / Semantic 事实硬注入 / token budget packing 留 V1+。
 */
export function assembleContext(input: AssembleInput): ChatRequest {
  const persona = input.store.getPersonaState(input.character.id) ?? DEFAULT_PERSONA_STATE;
  const system = buildSystemPrompt({
    name: input.character.name,
    persona,
    ...(input.character.emotions ? { emotions: input.character.emotions } : {}),
    ...(input.character.actions ? { actions: input.character.actions } : {}),
  });
  const history = input.store
    .recentMessages(input.character.id, input.sessionId, WORKING_TURNS)
    .filter((r) => r.text.length > 0)
    .map((r) => ({ role: r.role, content: r.text }));
  return {
    messages: [
      { role: 'system', content: system },
      ...history,
      { role: 'user', content: input.userText },
    ],
    ...(input.model ? { model: input.model } : {}),
  };
}
