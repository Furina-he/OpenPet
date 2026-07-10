/**
 * 轮末长期记忆提炼（F-AI-06，spec §1.1）：每 characterId 每 N 个 stop 轮触发一次，
 * 取最近 16 条消息 → Main 直调 openai 兼容 /chat/completions（stream:false，镜像
 * voice-service：默认 chat 目标 + source.key 明文 bearer）→ 解析 0–3 条事实 →
 * embed 去重（余弦>0.92）→ 入库。全链路静默失败（提炼是增益不是依赖）。
 * adapter 非 'openai' 本期跳过（anthropic/gemini/ollama → follow-up）。
 */
import type { Prefs } from '@openpet/protocol';
import type { ConversationStore } from './db/index.js';
import { cosineSim } from './kb-search.js';
import type { FetchLike } from './rerank-client.js';

export interface MemoryExtractorDeps {
  store: ConversationStore;
  embed: (inputs: string[]) => Promise<number[][]>;
  fetchImpl: FetchLike;
  getPrefs: () => Prefs;
  resolveTarget: () => { apiBase: string; model: string; key: string; adapter: string } | null;
  character: () => { id: string };
  turnsPerExtract?: number;
}

const DEDUPE_COSINE = 0.92;
const RECENT_MESSAGES = 16;

const PROMPT = [
  '你是记忆提炼器。从下面的对话里提炼 0-3 条值得长期记住的、关于用户的稳定事实/偏好/背景',
  '（如宠物、职业、习惯、重要关系）。不要提炼一次性/临时/闲聊信息。',
  '只输出一个 JSON 字符串数组，例如 ["用户养了只猫"]；没有值得记的就输出 []。',
].join('');

export function createMemoryExtractor(deps: MemoryExtractorDeps) {
  const every = deps.turnsPerExtract ?? 8;
  const counters = new Map<string, number>();

  async function extract(sessionId: string): Promise<void> {
    const target = deps.resolveTarget();
    if (!target || target.adapter !== 'openai') return;
    const cid = deps.character().id;
    const recent = deps.store
      .recentMessages(cid, sessionId, RECENT_MESSAGES)
      .map((m) => `${m.role === 'user' ? '用户' : '助手'}: ${m.text}`)
      .join('\n');
    if (!recent) return;
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
          { role: 'user', content: recent },
        ],
      }),
    });
    if (!res.ok) return;
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = (json.choices?.[0]?.message?.content ?? '').replace(/```(?:json)?|```/g, '').trim();
    let facts: unknown;
    try {
      facts = JSON.parse(raw);
    } catch {
      return;
    }
    if (!Array.isArray(facts)) return;
    const texts = facts
      .filter((f): f is string => typeof f === 'string' && f.trim().length > 3)
      .slice(0, 3);
    if (texts.length === 0) return;
    const vectors = await deps.embed(texts);
    const existing = deps.store.memoryVectors(cid);
    for (let i = 0; i < texts.length; i++) {
      const v = vectors[i];
      if (!v || v.length === 0) continue;
      const dup = existing.some((e) => e.vector.length > 0 && cosineSim(e.vector, v) > DEDUPE_COSINE);
      if (!dup) deps.store.memoryInsert(cid, texts[i]!.trim(), v, Date.now());
    }
  }

  return {
    /** chat-service 轮末（stop）钩子；fire-and-forget，永不抛。 */
    async onTurnEnd(sessionId: string): Promise<void> {
      try {
        if (!deps.getPrefs()['privacy.longTermMemory']) return;
        const cid = deps.character().id;
        const n = (counters.get(cid) ?? 0) + 1;
        counters.set(cid, n);
        if (n % every !== 0) return;
        await extract(sessionId);
      } catch (e) {
        console.warn('[memory] extract failed:', e);
      }
    },
  };
}
