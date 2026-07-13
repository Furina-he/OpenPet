/**
 * ⑭ 拟人化对话（SillyTavern 融合收线批次）纯函数集：
 * 句分段（自然节奏）/ 打字延迟 / 口癖正则（笔记⑦，clean-room）/ 时长人话 / 内置风格锚。
 */
import { z } from 'zod';

/** 句边界：终止标点序列（吸附随后的闭合引号/括号）或换行。 */
const BOUNDARY = /(?:[。！？!?…；;]+[”"』」】）)]*|\n+)/;

export function splitCompleteSegments(buf: string): { segments: string[]; rest: string } {
  const segments: string[] = [];
  let rest = buf;
  for (;;) {
    const m = BOUNDARY.exec(rest);
    if (!m) break;
    const end = m.index + m[0].length;
    const seg = rest.slice(0, end).trim();
    if (seg.length > 0) segments.push(seg);
    rest = rest.slice(end);
  }
  return { segments, rest };
}

export interface TypingCfg {
  charMs: number;
  minMs: number;
  maxMs: number;
}

export function typingDelayMs(chars: number, cfg: TypingCfg): number {
  return Math.min(cfg.maxMs, Math.max(cfg.minMs, Math.round(chars * cfg.charMs)));
}

export const RegexRuleSchema = z.object({
  id: z.string().min(1),
  name: z.string().max(60).default(''),
  // find 允许空串：D2 新增行未填写时是 no-op（applyRegexRules 跳过），不炸 per-key 校验。
  find: z.string().max(200),
  replace: z.string().max(200).default(''),
  ignoreCase: z.boolean().default(true),
  enabled: z.boolean().default(true),
});
export type RegexRule = z.infer<typeof RegexRuleSchema>;

/** 逐条应用（非法正则/超时风险靠长度上限+try/catch 兜底）；只做输出侧（spec §3）。 */
export function applyRegexRules(text: string, rules: readonly RegexRule[]): string {
  let out = text;
  for (const r of rules) {
    if (!r.enabled || r.find.length === 0) continue;
    try {
      out = out.replace(new RegExp(r.find, r.ignoreCase ? 'gi' : 'g'), r.replace);
    } catch {
      /* 非法正则跳过 */
    }
  }
  return out.trim();
}

/** 内置口癖预置库（激进项默认关）。 */
export const REGEX_PRESETS: RegexRule[] = [
  RegexRuleSchema.parse({
    id: 'preset-ai-self',
    name: '剥 AI 自称句',
    find: '作为(一个)?(AI|人工智能|大?语言模型|智能助手|助手|机器人)[^。！？!?\\n]*[。！？!?\\n]?',
    replace: '',
  }),
  RegexRuleSchema.parse({
    id: 'preset-helpful',
    name: '剥「希望有帮助」客套',
    find: '希望(这|以上|这些)?(对你|能)?[^。！？!?\\n]*帮(助|到)[^。！？!?\\n]*[。！？!?\\n]?',
    replace: '',
  }),
  RegexRuleSchema.parse({
    id: 'preset-okay-opener',
    name: '剥「好的/当然」开场（激进）',
    find: '^(好的|当然|没问题)[，,、！!]?\\s*',
    replace: '',
    enabled: false,
  }),
];

export function formatIdleDuration(ms: number): string {
  if (ms < 60_000) return '刚刚';
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} 分钟`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)} 小时`;
  return `${Math.round(ms / 86_400_000)} 天`;
}

/** 内置默认风格锚（spec §1；空 chat.styleAnchorText 时启用）。 */
export const DEFAULT_STYLE_ANCHOR =
  '（风格提醒：你在日常闲聊，不是写文章。回复要短，通常一两句话，像即时消息；' +
  '口语化，有自己的情绪和立场；可以反问、可以不接话茬；绝不自称 AI/助手/模型，' +
  '不用「有什么可以帮您」式客服腔；不要列点、不要总结陈词。）';
