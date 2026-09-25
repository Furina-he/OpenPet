/**
 * ㉒ 记忆页 markdown 渲染（spec 2026-09-24-memory-graph-design §4.5；纯 TS 可测）。
 *
 * marked 扩展：`[[双链]]`（含 `|显示` / `#节` / `![[嵌入]]` 按链接渲染）→ `<a class="ds-wikilink"
 * data-target>`（未建页面加 `is-ghost` + data-ghost）；行内 `#标签` → chip；`<!-- locked -->` → 🔒 徽标；
 * 指向 `.md` 的标准链接同样按双链处理。
 *
 * **安全**（Hub 窗无 CSP，页面内容源自对话 / IM 群聊）：html token 一律转义输出（锁定标记除外）；
 * 链接只放行 http(s): / mailto: 与内部双链，其余降级为纯文本；图片不渲染（显示 alt 文本）；所有属性值
 * 经完整转义（含引号），杜绝属性逃逸。
 */
import { Marked, type Tokens } from 'marked';
import { MEMORY_LOCKED_MARK, memoryPageStem } from '@openpet/protocol';

/** 链接目标 → 页路径；null = 未建页面。markdown = 标准 md 链接（相对当前页解析）。 */
export type MemoryLinkResolver = (target: string, markdown: boolean) => string | null;

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const SAFE_HREF_RE = /^(?:https?:|mailto:)/i;
/** Obsidian 标签字符：无空白与常见标点；不可纯数字（在 tokenizer 里判）。 */
const TAG_RE = /^#([^\s#,.;:!?()[\]{}"'`<>，。；：！？（）【】「」『』“”‘’、]+)/;

interface WikiToken {
  type: 'wikilink';
  raw: string;
  target: string;
  heading: string;
  display: string;
}
interface TagToken {
  type: 'memtag';
  raw: string;
  tag: string;
}

function wikiAnchor(
  resolve: MemoryLinkResolver,
  target: string,
  heading: string,
  display: string,
  markdown: boolean,
): string {
  const path = resolve(target, markdown);
  const shown =
    display || `${memoryPageStem(target.replace(/\\/g, '/'))}${heading ? ` › ${heading}` : ''}`;
  const attrs = path
    ? `data-target="${escapeHtml(path)}"`
    : `data-ghost="${escapeHtml(memoryPageStem(target.replace(/\\/g, '/')))}"`;
  return `<a class="ds-wikilink${path ? '' : ' is-ghost'}" href="#" ${attrs}>${escapeHtml(shown)}</a>`;
}

function build(resolve: MemoryLinkResolver): Marked {
  const m = new Marked({ gfm: true, breaks: false });
  m.use({
    extensions: [
      {
        name: 'wikilink',
        level: 'inline',
        start: (src: string) => {
          const i = src.search(/!?\[\[/);
          return i < 0 ? undefined : i;
        },
        tokenizer(src: string): WikiToken | undefined {
          const cap = /^!?\[\[([^[\]\n]+?)\]\]/.exec(src);
          if (!cap) return undefined;
          const inner = cap[1]!;
          const bar = /\\?\|/.exec(inner);
          const head = bar ? inner.slice(0, bar.index) : inner;
          const display = bar ? inner.slice(bar.index + bar[0].length).trim() : '';
          const hash = head.indexOf('#');
          return {
            type: 'wikilink',
            raw: cap[0],
            target: (hash < 0 ? head : head.slice(0, hash)).trim(),
            heading: hash < 0 ? '' : head.slice(hash + 1).trim(),
            display,
          };
        },
        renderer(token) {
          const t = token as unknown as WikiToken;
          if (!t.target) return escapeHtml(t.display || t.heading);
          return wikiAnchor(resolve, t.target, t.heading, t.display, false);
        },
      },
      {
        name: 'memtag',
        level: 'inline',
        start: (src: string) => {
          const m2 = /(^|\s)#[^\s#]/.exec(src);
          return m2 ? m2.index + m2[1]!.length : undefined;
        },
        tokenizer(src: string): TagToken | undefined {
          const cap = TAG_RE.exec(src);
          if (!cap || /^\d+$/.test(cap[1]!)) return undefined;
          return { type: 'memtag', raw: cap[0], tag: cap[1]! };
        },
        renderer(token) {
          const t = token as unknown as TagToken;
          return `<span class="ds-tag-chip" data-tag="${escapeHtml(t.tag)}">#${escapeHtml(t.tag)}</span>`;
        },
      },
    ],
    renderer: {
      html(token: Tokens.HTML | Tokens.Tag): string {
        const text = token.text;
        if (text.trim() === MEMORY_LOCKED_MARK)
          return `<span class="ds-lock-badge" title="locked">🔒</span>${token.block ? '\n' : ''}`;
        // 锁定标记后跟正文（同一 html 块）：徽标 + 其余转义
        if (text.trimStart().startsWith(MEMORY_LOCKED_MARK)) {
          const rest = text.trimStart().slice(MEMORY_LOCKED_MARK.length);
          return `<span class="ds-lock-badge" title="locked">🔒</span>${escapeHtml(rest)}`;
        }
        const out = escapeHtml(text);
        return token.block ? `<p>${out}</p>\n` : out;
      },
      link(token: Tokens.Link): string {
        const inner = this.parser.parseInline(token.tokens);
        const href = token.href.trim();
        if (SAFE_HREF_RE.test(href))
          return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${inner}</a>`;
        if (/\.md(?:#.*)?$/i.test(href) && !/^[a-z][a-z0-9+.-]*:/i.test(href)) {
          let target = href.replace(/#.*$/, '');
          try {
            target = decodeURIComponent(target);
          } catch {
            /* 原串 */
          }
          const heading = /#(.*)$/.exec(href)?.[1] ?? '';
          return wikiAnchor(resolve, target, heading, token.text, true);
        }
        return inner; // 其余协议（javascript: / data: / file: …）降级为纯文本
      },
      image(token: Tokens.Image): string {
        return escapeHtml(token.text);
      },
    },
  });
  return m;
}

/** 渲染记忆页正文（不含 frontmatter）→ 安全 HTML 串。 */
export function renderMemoryMarkdown(md: string, resolve: MemoryLinkResolver): string {
  return build(resolve).parse(md, { async: false }) as string;
}
