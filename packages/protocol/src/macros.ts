/**
 * ⑫ ST 兼容宏子集（SillyTavern 融合⑤）：{{char}} {{user}} {{time}} {{date}} {{random:…}}。
 * 大小写不敏感；未知宏原样保留（不吞正文）。时钟/随机源可注入（测试定值）。
 * 应用点：context-assembler（persona/开场白/世界书）与切换问候，DB 永存原文。
 */
export interface MacroContext {
  char: string;
  user: string;
  /** 注入时钟/随机源；缺省 new Date() / Math.random。 */
  now?: Date;
  random?: () => number;
  /** BCP-47（{{time}}/{{date}} 格式化）；缺省 zh-CN。 */
  locale?: string;
  hour12?: boolean;
}

export function expandMacros(text: string, ctx: MacroContext): string {
  const now = ctx.now ?? new Date();
  const locale = ctx.locale ?? 'zh-CN';
  const rand = ctx.random ?? Math.random;
  return text
    .replace(/\{\{char\}\}/gi, () => ctx.char)
    .replace(/\{\{user\}\}/gi, () => ctx.user)
    .replace(/\{\{time\}\}/gi, () =>
      now.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: ctx.hour12 ?? false }),
    )
    .replace(/\{\{date\}\}/gi, () =>
      now.toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' }),
    )
    .replace(/\{\{random:([^{}]*)\}\}/gi, (_m, raw: string) => {
      const opts = raw
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (opts.length === 0) return '';
      return opts[Math.floor(rand() * opts.length)] ?? '';
    });
}
