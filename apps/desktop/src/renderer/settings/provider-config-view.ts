/** Provider 工作台的纯视图计算（无 Vue 依赖，便于单测）。对齐 AstrBot useProviderSources。 */
import type { Capability, ModelCaps, ModelEntry, PrefKey, ProviderSource } from '@desksoul/protocol';

export function sourcesForTab(sources: ProviderSource[], cap: Capability): ProviderSource[] {
  return sources.filter((s) => s.capability === cap);
}

export function modelsForSource(models: ModelEntry[], sourceId: string): ModelEntry[] {
  return models.filter((m) => m.sourceId === sourceId);
}

export type MergedEntry =
  | { type: 'configured'; model: string; entry: ModelEntry }
  | { type: 'available'; model: string };

/** 已配置在前 + 尚未配置的可用模型（对齐 AstrBot mergedModelEntries）。 */
export function mergedModelEntries(configured: ModelEntry[], available: string[]): MergedEntry[] {
  const have = new Set(configured.map((m) => m.model));
  return [
    ...configured.map((entry) => ({ type: 'configured' as const, model: entry.model, entry })),
    ...available.filter((m) => !have.has(m)).map((model) => ({ type: 'available' as const, model })),
  ];
}

export function formatContextLimit(ctx?: number): string {
  if (!ctx || typeof ctx !== 'number') return '';
  if (ctx >= 1_000_000) return `${Math.round(ctx / 1_000_000)}M`;
  if (ctx >= 1_000) return `${Math.round(ctx / 1_000)}K`;
  return `${ctx}`;
}

/** 能力徽标顺序：vision/audio/tool/reasoning + 上下文。 */
export function capsBadges(caps: ModelCaps, contextTokens?: number): string[] {
  const out: string[] = [];
  if (caps.vision) out.push('vision');
  if (caps.audio) out.push('audio');
  if (caps.tool) out.push('tool');
  if (caps.reasoning) out.push('reasoning');
  const ctx = formatContextLimit(contextTokens);
  if (ctx) out.push(ctx);
  return out;
}

const DEFAULT_KEYS: Record<Capability, PrefKey> = {
  chat: 'model.defaultChatModelId',
  agent_runner: 'model.defaultAgentModelId',
  stt: 'model.defaultSttModelId',
  tts: 'model.defaultTtsModelId',
  embedding: 'model.defaultEmbeddingModelId',
  rerank: 'model.defaultRerankModelId',
};

export function defaultPrefKeyFor(cap: Capability): PrefKey {
  return DEFAULT_KEYS[cap];
}

/** 拉取模型结果 → 用户可见提示（成功计数 / 0 命中提示 / 错误分级）。纯函数，便于单测。 */
export function fetchOutcomeMessage(outcome: { count: number } | { error: unknown }): string {
  if ('error' in outcome) {
    const e = outcome.error;
    const raw = e instanceof Error ? e.message : String(e);
    // 跨 IPC（Main→renderer）后自定义 status 丢失、message 被包成
    // "Error invoking remote method '...': Error: HTTP 403: <body>"——从 message 兜底解析状态码 + 剥包装。
    const matched = /HTTP (\d{3})/.exec(raw)?.[1];
    const status = (e as { status?: number }).status ?? (matched ? Number(matched) : undefined);
    const detail = raw
      .replace(/Error invoking remote method '[^']*':\s*/g, '')
      .replace(/^Error:\s*/, '')
      .trim()
      .slice(0, 160);
    if (status === 401 || status === 403) {
      return `拉取失败：HTTP ${status}（鉴权被拒 / 地区受限：确认 API Key 已点「保存」且有效；OpenAI 官方端点在中国大陆会 403，请改用可达的中转站 Base URL 或国内 provider）。${detail}`;
    }
    if (status) return `拉取失败：HTTP ${status} — ${detail}`;
    return `拉取失败：${detail}`;
  }
  return outcome.count
    ? `拉取到 ${outcome.count} 个模型`
    : '未找到模型（确认 API Key 已点「保存」、Base URL 正确）';
}

export const CAPABILITY_TABS: { value: Capability; label: string }[] = [
  { value: 'chat', label: '对话模型' },
  { value: 'agent_runner', label: 'Agent' },
  { value: 'stt', label: '语音转文字' },
  { value: 'tts', label: '文字转语音' },
  { value: 'embedding', label: '向量 Embedding' },
  { value: 'rerank', label: '重排 Rerank' },
];
