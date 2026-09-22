/**
 * 模型供应商工作台纯逻辑（照 AstrBot useProviderSources / ProviderSourceDialog / ProviderModelsPanel；
 * 无 Vue 依赖，便于单测）。页面 SFC 只做渲染与 RPC 转发。
 */
import type { ModelCaps, ModelEntry, ProviderSource, ProviderTemplate } from '@openpet/protocol';

// ---------- 草稿 / 脏判定（AstrBot isSourceModified）----------

/** 深拷成纯对象——Vue 反应式代理（尤其嵌套 config）无法经 IPC 结构化克隆，必须先拆。 */
export function plain<T>(o: T): T {
  return JSON.parse(JSON.stringify(o)) as T;
}

/** 规范化后比较（省略 undefined / 空 config / 空 headers）。 */
export function normalizeSource(s: ProviderSource): ProviderSource {
  const out: ProviderSource = {
    id: s.id,
    adapter: s.adapter,
    capability: s.capability,
    apiBase: s.apiBase.trim(),
    key: s.key,
    enabled: s.enabled,
  };
  if (s.name) out.name = s.name;
  if (s.icon) out.icon = s.icon;
  const cfg = Object.fromEntries(
    Object.entries(s.config ?? {}).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  );
  if (Object.keys(cfg).length) out.config = cfg;
  if (typeof s.timeoutMs === 'number' && s.timeoutMs > 0) out.timeoutMs = s.timeoutMs;
  if (s.proxy && s.proxy.trim()) out.proxy = s.proxy.trim();
  if (s.headers && Object.keys(s.headers).length) out.headers = s.headers;
  if (typeof s.ollamaDisableThinking === 'boolean')
    out.ollamaDisableThinking = s.ollamaDisableThinking;
  return out;
}

export function sourceEquals(a: ProviderSource, b: ProviderSource): boolean {
  return JSON.stringify(normalizeSource(a)) === JSON.stringify(normalizeSource(b));
}

// ---------- 新建供应商弹窗（AstrBot ProviderSourceDialog）----------

/** AstrBot 首屏优先顺序（其余按模板表原序）。 */
export const PREFERRED_TEMPLATE_IDS = [
  'openai',
  'openai_responses',
  'gemini',
  'anthropic',
  'deepseek',
  'moonshot',
  'kimi',
  'minimax',
  'zhipu',
  'xiaomi',
  'xai',
  'longcat',
];

export interface TemplateCard {
  template: ProviderTemplate;
  label: string;
  /** 副标题 = Base URL 主机名（AstrBot 显示 domain）；本地/自托管显示空串由渲染处兜底。 */
  subtitle: string;
}

export function hostOf(url: string): string {
  try {
    return url ? new URL(url).host : '';
  } catch {
    return url;
  }
}

/** 当前能力的模板 → 搜索过滤 + 优先排序。 */
export function templateCards(
  templates: ProviderTemplate[],
  capability: ProviderTemplate['capability'],
  query: string,
): TemplateCard[] {
  const q = query.trim().toLowerCase();
  const list = templates.filter((t) => t.capability === capability);
  const rank = (t: ProviderTemplate): number => {
    const i = PREFERRED_TEMPLATE_IDS.indexOf(t.id);
    return i < 0 ? PREFERRED_TEMPLATE_IDS.length : i;
  };
  return list
    .map((template) => ({ template, label: template.name, subtitle: hostOf(template.apiBase) }))
    .filter((c) => !q || `${c.template.id} ${c.label} ${c.subtitle}`.toLowerCase().includes(q))
    .sort((a, b) => rank(a.template) - rank(b.template));
}

// ---------- 模型面板（AstrBot ProviderModelsPanel）----------

export type WorkbenchEntry =
  | { type: 'configured'; entry: ModelEntry }
  | { type: 'available'; model: string };

/** 已配置在前 + 未配置的可用模型；搜索同时匹配显示 ID 与模型名。 */
export function workbenchEntries(
  configured: ModelEntry[],
  available: string[],
  query: string,
): WorkbenchEntry[] {
  const q = query.trim().toLowerCase();
  const have = new Set(configured.map((m) => m.model));
  const all: WorkbenchEntry[] = [
    ...configured.map((entry) => ({ type: 'configured' as const, entry })),
    ...available
      .filter((m) => !have.has(m))
      .map((model) => ({ type: 'available' as const, model })),
  ];
  if (!q) return all;
  return all.filter((e) =>
    e.type === 'configured'
      ? e.entry.id.toLowerCase().includes(q) || e.entry.model.toLowerCase().includes(q)
      : e.model.toLowerCase().includes(q),
  );
}

export interface CapBadge {
  key: keyof ModelCaps;
  enabled: boolean;
}

/** 能力徽标（AstrBot image/audio/tool_use/reasoning；已配置行显示全部四个并按开关明暗）。 */
export function capBadges(caps: ModelCaps): CapBadge[] {
  return (['vision', 'audio', 'tool', 'reasoning'] as const).map((key) => ({
    key,
    enabled: Boolean(caps[key]),
  }));
}

export function formatContextLimit(ctx?: number): string {
  if (!ctx || typeof ctx !== 'number') return '';
  if (ctx >= 1_000_000) return `${Math.round(ctx / 1_000_000)}M`;
  if (ctx >= 1_000) return `${Math.round(ctx / 1_000)}K`;
  return `${ctx}`;
}

/** 自定义模型弹窗预览：`源ID/模型ID`。 */
export function manualModelPreview(sourceId: string, modelId: string): string {
  const m = modelId.trim();
  return sourceId && m ? `${sourceId}/${m}` : '';
}

/** 新建模型条目（AstrBot buildModelProviderConfig；无 metadata 时默认全开）。 */
export function buildModelEntry(sourceId: string, model: string): ModelEntry {
  return {
    id: `${sourceId}/${model}`,
    sourceId,
    model,
    enabled: true,
    caps: { vision: true, audio: true, tool: true },
  };
}
