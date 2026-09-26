/**
 * ㉔ 主动记忆工具（spec 2026-09-26-memory-v3-design §2）：两个内置工具作为一个自有工具源并入工具口
 * （mergeToolPorts），与 MCP / 插件工具并列。
 *
 * - recall_memory {query}：角色主动翻长期记忆——同一条混合检索（名字路 + 块混合），query 只用参数、
 *   不带历史；单元上限 6、总字数 ≤2000；输出纯文本（无 [[）；真正返回的人物 / 话题页记「被想起」。
 * - remember {text}：用户明确要求记住时写一张便签（memory_note），本轮结束见到便签即编译该会话——
 *   便签和本段对话一起进编译器，由 LLM 放到合适的节 / 页（走 applyOps 受控写，不直接改文件）。
 *
 * 挂载门：总闸 privacy.longTermMemory + 各自开关 + 当前默认对话模型勾了 tool 能力（不支持工具调用的
 * 端点不会 400）；remember 另需本会话允许进记忆（IM 群聊默认不进，与编译同一个门）且本轮用户输入含
 * 明确的记忆意图——用户的话就是确认，寻常闲聊里模型不会自作主张地写记忆。
 */
import { MEMORY_QUOTAS, type ChatTool, type Prefs } from '@openpet/protocol';
import type { ToolContext } from './chat-service.js';
import type { MemoryUnit } from './memory-service.js';
import type { OwnedToolSource } from './plugins/tool-port-merge.js';

export const RECALL_TOOL = 'recall_memory';
export const REMEMBER_TOOL = 'remember';

/** 本轮用户输入里的明确记忆意图（remember 只在命中时出现）。 */
export const REMEMBER_INTENT_RE =
  /记住|记下|记一下|记着|记好|别忘|不要忘|帮我记|remember|don'?t\s+forget|keep\s+in\s+mind/i;

const RECALL_DEF: ChatTool = {
  name: RECALL_TOOL,
  description:
    '查你的长期记忆（关于用户、ta 提到的人和事、你们的共同经历）。当用户问起以前的事、或你需要某人某事的细节而上文与已给的记忆里没有时使用。query 用 2–8 个字的关键词或短语，如「王小明」「爬山」「第一次见面」。',
  parameters: {
    type: 'object',
    properties: { query: { type: 'string', description: '关键词或短语（2–8 个字）' } },
    required: ['query'],
  },
};

const REMEMBER_DEF: ChatTool = {
  name: REMEMBER_TOOL,
  description:
    '用户明确要你记住某件事时调用（「记住」「别忘了」「帮我记一下」）。把要记的写成一句完整具体的事实，相对时间换成具体日期（如「用户 2026-09-30 有面试」）；记下后会稍后整理进长期记忆。',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: `要记住的事实（1–${MEMORY_QUOTAS.noteChars} 字）` },
    },
    required: ['text'],
  },
};

export interface MemoryToolsDeps {
  getPrefs: () => Prefs;
  /** 当前默认对话模型条目 caps.tool === true。 */
  toolCapable: () => boolean;
  /** 本会话允许进记忆（IM 群聊且 im.groupIntoMemory 关 = false）。 */
  sessionAllowed: (sessionId: string) => boolean;
  /** memory-service.recall。 */
  recall: (
    query: string,
    opts: { units?: number; chars?: number; record?: boolean },
  ) => Promise<MemoryUnit[]>;
  /** 写便签（当前角色 + 该会话）。 */
  addNote: (sessionId: string, text: string) => void;
}

/** recall 结果 → 纯文本（单元已是纯文本投影）。 */
export function formatRecall(query: string, units: readonly MemoryUnit[]): string {
  if (units.length === 0) return `没有想起与「${query}」相关的记忆。`;
  return [
    `「${query}」想起了 ${units.length} 条：`,
    ...units.map((u) => `### ${u.title}\n${u.body}`),
  ].join('\n\n');
}

function argString(args: unknown, key: string): string {
  const v = args && typeof args === 'object' ? (args as Record<string, unknown>)[key] : undefined;
  return typeof v === 'string' ? v.trim() : '';
}

export function createMemoryTools(deps: MemoryToolsDeps): OwnedToolSource {
  const base = (): boolean =>
    Boolean(deps.getPrefs()['privacy.longTermMemory']) && deps.toolCapable();
  const recallOn = (): boolean => base() && deps.getPrefs()['memory.recallTool'] !== false;
  const rememberOn = (sessionId: string | undefined): boolean =>
    base() &&
    deps.getPrefs()['memory.rememberTool'] !== false &&
    !!sessionId &&
    deps.sessionAllowed(sessionId);

  return {
    activeToolDefs(ctx?: ToolContext): ChatTool[] {
      const out: ChatTool[] = [];
      if (recallOn()) out.push(RECALL_DEF);
      if (rememberOn(ctx?.sessionId) && REMEMBER_INTENT_RE.test(ctx?.userText ?? ''))
        out.push(REMEMBER_DEF);
      return out;
    },
    ownsTool: (name) => name === RECALL_TOOL || name === REMEMBER_TOOL,
    async callTool(name, args, ctx) {
      if (name === RECALL_TOOL) {
        if (!recallOn()) throw new Error('主动回想已关闭');
        const query = argString(args, 'query');
        if (!query) throw new Error('需要一个关键词（query）');
        const units = await deps.recall(query, {
          units: MEMORY_QUOTAS.toolRecallUnits,
          chars: MEMORY_QUOTAS.toolRecallChars,
          record: true,
        });
        return formatRecall(query, units);
      }
      if (name === REMEMBER_TOOL) {
        if (!rememberOn(ctx?.sessionId)) throw new Error('「记住」当前不可用');
        const text = argString(args, 'text');
        if (!text || text.length > MEMORY_QUOTAS.noteChars)
          throw new Error(`要记的内容需在 1–${MEMORY_QUOTAS.noteChars} 字之间`);
        deps.addNote(ctx!.sessionId, text);
        return `已记下：${text}（稍后整理进长期记忆）`;
      }
      throw new Error(`unknown tool ${name}`);
    },
  };
}
