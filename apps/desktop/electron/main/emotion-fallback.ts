/**
 * ⑬ 表情分类兜底（SillyTavern 融合③）：模型整轮未吐 <emo:/> 时，轮末用一次
 * 轻量 LLM 单发把干净回复分类进角色表情词表，广播 behavior.applyEmotion。
 * 镜像 memory-extractor：Main 直调 openai 兼容单发（stream:false + bearer），
 * 全链路静默失败（兜底是增益不是依赖）；adapter 非 'openai' 本期跳过（follow-up 同修）。
 * 词表与行为标签 prompt 同源（manifest.emotions 键 ?? DEFAULT_EMOTIONS）；
 * neutral/未命中 → no-op（宁可不动脸不做错表情）。
 */
import type { Prefs } from '@openpet/protocol';
import type { FetchLike } from './rerank-client.js';

export const MIN_TEXT_CHARS = 6;
const MAX_TEXT_CHARS = 800;

export interface EmotionFallbackDeps {
  fetchImpl: FetchLike;
  resolveTarget: () => { apiBase: string; model: string; key: string; adapter: string } | null;
  getPrefs: () => Prefs;
  /** 分类词表（与行为标签 prompt 同源）；空表跳过。 */
  emotions: () => readonly string[];
  broadcast: (channel: string, params: unknown) => void;
}

export function buildClassifyMessages(
  text: string,
  emotions: readonly string[],
): Array<{ role: 'system' | 'user'; content: string }> {
  return [
    {
      role: 'system',
      content:
        '你是情绪分类器。判断下面这句角色回复的主导情绪，只能输出以下词中的一个：' +
        `${emotions.join(', ')}, neutral。拿不准或情绪平淡就输出 neutral。只输出一个词。`,
    },
    { role: 'user', content: text.slice(0, MAX_TEXT_CHARS) },
  ];
}

/** 解析分类输出：词表命中（大小写/引号/标点容错）→ 表情名；neutral/未命中 → null。 */
export function parseEmotionLabel(raw: string, emotions: readonly string[]): string | null {
  const word = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z_-]/g, '');
  if (word.length === 0 || word === 'neutral') return null;
  return emotions.find((e) => e.toLowerCase() === word) ?? null;
}

export function createEmotionFallback(deps: EmotionFallbackDeps) {
  return {
    /** ChatService 轮末钩子（整轮零 <emo:/> 时被调）；fire-and-forget，永不抛。 */
    async onTurnEnd(_sessionId: string, cleanText: string): Promise<void> {
      try {
        if (!deps.getPrefs()['general.emotionFallback']) return;
        if (cleanText.trim().length < MIN_TEXT_CHARS) return;
        const target = deps.resolveTarget();
        if (!target || target.adapter !== 'openai') return;
        const emotions = deps.emotions();
        if (emotions.length === 0) return;
        const res = await deps.fetchImpl(`${target.apiBase}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(target.key ? { authorization: `Bearer ${target.key}` } : {}),
          },
          body: JSON.stringify({
            model: target.model,
            stream: false,
            temperature: 0,
            messages: buildClassifyMessages(cleanText, emotions),
          }),
        });
        if (!res.ok) return;
        const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
        const label = parseEmotionLabel(json.choices?.[0]?.message?.content ?? '', emotions);
        if (label) deps.broadcast('behavior.applyEmotion', { name: label, weight: 1 });
      } catch (e) {
        console.warn('[emotion-fallback] classify failed:', e);
      }
    },
  };
}
