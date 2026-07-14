/**
 * 轮末长期记忆提炼（F-AI-06 + ⑮ 记忆域生命周期 v2，spec §1/§3）：每 characterId 每 N 个
 * stop 轮触发一次，取最近 16 条消息 + 「已有相关记忆」候选集（对话拼接文本 embed 一次 →
 * 余弦 top8）→ Main 直调 openai 兼容 /chat/completions（stream:false）→ 解析 0–3 个操作
 * {op: add|update|remove}。护栏：update/remove 的 id 必须在候选集内（防幻觉）、pinned 条目
 * 豁免（用户意志高于 LLM）、add 保留余弦>0.92 去重。flush() 收尾：计数>0 立即提炼并清零，
 * 60s 防抖（退出/切角色/切会话时挂）。全链路静默失败（提炼是增益不是依赖）。
 * adapter 非 'openai' 本期跳过（anthropic/gemini/ollama → follow-up，T4 杂务模型可自救）。
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
  now?: () => number;
}

const DEDUPE_COSINE = 0.92;
const RECENT_MESSAGES = 16;
const CANDIDATE_TOP = 8;
const FLUSH_DEBOUNCE_MS = 60_000;

const PROMPT = [
  '你是记忆维护器。对比下面的对话和「已有相关记忆」，输出 0-3 个记忆操作（JSON 数组）：',
  '{"op":"add","text":"..."} = 值得长期记住的、关于用户的新稳定事实/偏好/背景（如宠物、职业、习惯、重要关系）；',
  '{"op":"update","id":数字,"text":"..."} = 已有条目过时或被对话中的新信息取代，改写为新内容；',
  '{"op":"remove","id":数字} = 已有条目已明确失效。',
  '内容与已有条目重复、或只是一次性/临时/闲聊信息 → 不输出操作。',
  '只输出 JSON 数组本身，例如 [{"op":"add","text":"用户养了只猫"}]；无操作输出 []。',
].join('');

interface MemoryOp {
  op: 'add' | 'update' | 'remove';
  id?: number;
  text?: string;
}

function parseOps(raw: string): MemoryOp[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter(
      (o): o is MemoryOp =>
        typeof o === 'object' &&
        o !== null &&
        ['add', 'update', 'remove'].includes((o as MemoryOp).op),
    )
    .slice(0, 3);
}

export function createMemoryExtractor(deps: MemoryExtractorDeps) {
  const every = deps.turnsPerExtract ?? 8;
  const now = deps.now ?? Date.now;
  /** 每角色未提炼轮计数（仅内存；flush 兜底后剩余风险=崩溃丢计数，spec §3 可接受）。 */
  const counters = new Map<string, number>();
  /** 每角色最近活跃会话（flush 时知道从哪个会话取消息）。 */
  const lastSession = new Map<string, string>();
  let lastFlushAt = -Infinity;

  async function extract(cid: string, sessionId: string): Promise<void> {
    const target = deps.resolveTarget();
    if (!target || target.adapter !== 'openai') return;
    const recent = deps.store
      .recentMessages(cid, sessionId, RECENT_MESSAGES)
      .map((m) => `${m.role === 'user' ? '用户' : '助手'}: ${m.text}`)
      .join('\n');
    if (!recent) return;

    // 候选集：对话拼接文本 embed 一次 → 该角色记忆余弦 top8（spec §1 防 prompt 膨胀）。
    const all = deps.store.memoryVectors(cid);
    let candidates: typeof all = [];
    if (all.length > 0) {
      const qv = (await deps.embed([recent]))[0];
      if (qv && qv.length > 0) {
        candidates = all
          .filter((e) => e.vector.length > 0)
          .map((e) => ({ e, sim: cosineSim(e.vector, qv) }))
          .sort((a, b) => b.sim - a.sim)
          .slice(0, CANDIDATE_TOP)
          .map((x) => x.e);
      }
    }
    const candidateBlock = candidates.length
      ? `\n\n已有相关记忆：\n${candidates.map((c) => `[${c.id}] ${c.text}`).join('\n')}`
      : '\n\n已有相关记忆：（无）';

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
          { role: 'user', content: recent + candidateBlock },
        ],
      }),
    });
    if (!res.ok) return;
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = (json.choices?.[0]?.message?.content ?? '').replace(/```(?:json)?|```/g, '').trim();
    const ops = parseOps(raw);
    if (ops.length === 0) return;

    // 护栏：update/remove 的 id 必须在候选集内且非 pinned；add 走去重。
    const byId = new Map(candidates.map((c) => [c.id, c]));
    const adds: string[] = [];
    const updates: Array<{ id: number; text: string }> = [];
    for (const op of ops) {
      const text = typeof op.text === 'string' ? op.text.trim() : '';
      if (op.op === 'add') {
        if (text.length > 3) adds.push(text);
        continue;
      }
      const hit = typeof op.id === 'number' ? byId.get(op.id) : undefined;
      if (!hit || hit.pinned) continue; // 候选集外/pinned → 丢弃
      if (op.op === 'remove') deps.store.memoryDelete(hit.id);
      else if (text.length > 3) updates.push({ id: hit.id, text });
    }
    if (adds.length === 0 && updates.length === 0) return;

    const vectors = await deps.embed([...adds, ...updates.map((u) => u.text)]);
    for (let i = 0; i < updates.length; i++) {
      const v = vectors[adds.length + i];
      if (!v || v.length === 0) continue;
      deps.store.memoryUpdate(updates[i]!.id, updates[i]!.text, v, now());
    }
    // add 去重对「remove/update 落库后」的现状比（旧向量已被替换/删除）。
    const existing = deps.store.memoryVectors(cid);
    for (let i = 0; i < adds.length; i++) {
      const v = vectors[i];
      if (!v || v.length === 0) continue;
      const dup = existing.some((e) => e.vector.length > 0 && cosineSim(e.vector, v) > DEDUPE_COSINE);
      if (!dup) deps.store.memoryInsert(cid, adds[i]!, v, now());
    }
  }

  return {
    /** chat-service 轮末（stop）钩子；fire-and-forget，永不抛。 */
    async onTurnEnd(sessionId: string): Promise<void> {
      try {
        if (!deps.getPrefs()['privacy.longTermMemory']) return;
        const cid = deps.character().id;
        lastSession.set(cid, sessionId);
        const n = (counters.get(cid) ?? 0) + 1;
        if (n < every) {
          counters.set(cid, n);
          return;
        }
        counters.set(cid, 0);
        await extract(cid, sessionId);
      } catch (e) {
        console.warn('[memory] extract failed:', e);
      }
    },
    /**
     * ⑮ 触发收尾（spec §3）：当前角色有未提炼的轮 → 立即提炼并清零。挂 app 退出 /
     * 角色切换前 / 会话切换；60s 防抖（快速连续切换不连发 LLM，防抖跳过时计数保留）。
     */
    async flush(): Promise<void> {
      try {
        if (!deps.getPrefs()['privacy.longTermMemory']) return;
        const cid = deps.character().id;
        const sid = lastSession.get(cid);
        if ((counters.get(cid) ?? 0) <= 0 || !sid) return;
        const t = now();
        if (t - lastFlushAt < FLUSH_DEBOUNCE_MS) return;
        lastFlushAt = t;
        counters.set(cid, 0);
        await extract(cid, sid);
      } catch (e) {
        console.warn('[memory] flush failed:', e);
      }
    },
  };
}
