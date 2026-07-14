/**
 * 会话滚动摘要（⑮ 记忆域 spec §2）：Working 20 轮硬切与长期事实之间的中期记忆层。
 * 轮末 fire-and-forget（与 memory-extractor 并列，但不受 im 提炼门限制）：会话总消息数
 * > workingTurns 且「窗口外未摘要消息」≥ minUnsummarized 时，取 (summary_upto, 总数-窗口]
 * 区间消息 + 旧摘要 → LLM 单发合并为 ≤300 字新摘要 → 写回 summary + summary_upto。
 * 作用域 = 单会话（跨会话的「了解」归长期记忆）；失败静默（旧摘要还在，下轮再试）。
 * adapter 非 'openai' 跳过（同 memory-extractor 口径，T4 杂务模型可自救）。
 */
import type { Prefs } from '@openpet/protocol';
import { WORKING_TURNS } from './context-assembler.js';
import type { ConversationStore } from './db/index.js';
import type { FetchLike } from './rerank-client.js';

export interface SessionSummarizerDeps {
  store: ConversationStore;
  fetchImpl: FetchLike;
  getPrefs: () => Prefs;
  resolveTarget: () => { apiBase: string; model: string; key: string; adapter: string } | null;
  character: () => { id: string };
  workingTurns?: number;
  minUnsummarized?: number;
}

const PROMPT = [
  '你是对话摘要器。把「已有摘要」（可能为空）与「新增对话段」合并为一份不超过 300 字的摘要。',
  '保留具体事实、约定、计划和情绪脉络；丢弃寒暄与重复。',
  '只输出摘要正文本身，不要任何前缀、标题或解释。',
].join('');

export function createSessionSummarizer(deps: SessionSummarizerDeps) {
  const windowN = deps.workingTurns ?? WORKING_TURNS;
  const minNew = deps.minUnsummarized ?? 12;

  return {
    /** chat-service 轮末（stop）钩子；fire-and-forget，永不抛。 */
    async onTurnEnd(sessionId: string): Promise<void> {
      try {
        if (!deps.getPrefs()['chat.sessionSummary']) return;
        const target = deps.resolveTarget();
        if (!target || target.adapter !== 'openai') return;
        const cid = deps.character().id;
        const { count, lastId } = deps.store.messageStats(sessionId);
        if (count <= windowN) return;
        const { summary: oldSummary, upto } = deps.store.sessionSummaryGet(sessionId);
        // 未摘要集 = id > upto 的全部；其中窗口外（= 会话前 count-windowN 条）的条数：
        const unsummarized = deps.store.messagesBetween(cid, sessionId, upto ?? 0, lastId);
        const outsideCount = unsummarized.length - windowN;
        if (outsideCount < minNew) return;
        const segment = unsummarized.slice(0, outsideCount);
        const segmentText = segment
          .map((m) => `${m.role === 'user' ? '用户' : '助手'}: ${m.text}`)
          .join('\n');
        const res = await deps.fetchImpl(`${target.apiBase}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(target.key ? { authorization: `Bearer ${target.key}` } : {}),
          },
          body: JSON.stringify({
            model: target.model,
            stream: false,
            messages: [
              { role: 'system', content: PROMPT },
              {
                role: 'user',
                content: `已有摘要：${oldSummary ?? '（无）'}\n\n新增对话段：\n${segmentText}`,
              },
            ],
          }),
        });
        if (!res.ok) return;
        const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
        const text = (json.choices?.[0]?.message?.content ?? '').trim();
        if (!text) return;
        deps.store.sessionSummarySet(sessionId, text, segment[segment.length - 1]!.id);
      } catch (e) {
        console.warn('[summary] summarize failed:', e);
      }
    },
  };
}
