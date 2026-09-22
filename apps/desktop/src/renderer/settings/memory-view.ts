/**
 * F3 记忆页（⑲ wiki 浏览器）纯逻辑：树构建 / 搜索高亮 / 节锁定 toggle / 脏判定 / 相对时间。
 * SFC 薄渲染；此处可测。节锁定标记与 Main 侧 memory-wiki.ts 同源（MEMORY_LOCKED_MARK）。
 */
import { MEMORY_LOCKED_MARK, type MemoryTree, type MemoryTreeNode } from '@openpet/protocol';

export interface TreeGroup {
  /** i18n key 片段：profile | people | topics | relationship | timeline */
  kind: 'profile' | 'people' | 'topics' | 'relationship' | 'timeline';
  nodes: MemoryTreeNode[];
}

/** 左栏五组固定顺序（spec §5）；people/topics 按 title 排序。 */
export function buildGroups(tree: MemoryTree): TreeGroup[] {
  const byTitle = (a: MemoryTreeNode, b: MemoryTreeNode): number =>
    a.title.localeCompare(b.title, 'zh');
  return [
    { kind: 'profile', nodes: [tree.profile] },
    { kind: 'people', nodes: [...tree.people].sort(byTitle) },
    { kind: 'topics', nodes: [...tree.topics].sort(byTitle) },
    { kind: 'relationship', nodes: [tree.relationship] },
    { kind: 'timeline', nodes: [tree.timeline] },
  ];
}

/** 子串过滤（title / summary / path）；空串返回全部。 */
export function filterGroups(groups: TreeGroup[], q: string): TreeGroup[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return groups;
  return groups
    .map((g) => ({
      kind: g.kind,
      nodes: g.nodes.filter(
        (n) =>
          n.title.toLowerCase().includes(needle) ||
          n.summary.toLowerCase().includes(needle) ||
          n.path.toLowerCase().includes(needle),
      ),
    }))
    .filter((g) => g.nodes.length > 0);
}

/** 把文本按 needle 切成 [普通, 命中, 普通…] 片段（渲染处 v-for 交替加粗）。 */
export function highlight(text: string, q: string): Array<{ text: string; hit: boolean }> {
  const needle = q.trim();
  if (!needle) return [{ text, hit: false }];
  const out: Array<{ text: string; hit: boolean }> = [];
  const lower = text.toLowerCase();
  const n = needle.toLowerCase();
  let i = 0;
  for (;;) {
    const j = lower.indexOf(n, i);
    if (j < 0) break;
    if (j > i) out.push({ text: text.slice(i, j), hit: false });
    out.push({ text: text.slice(j, j + n.length), hit: true });
    i = j + n.length;
  }
  if (i < text.length) out.push({ text: text.slice(i), hit: false });
  return out;
}

/** 编辑器全文里的 `## 节` 列表（frontmatter 之后）；locked = 节首行是锁定标记。 */
export function listSections(raw: string): Array<{ name: string; locked: boolean }> {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const out: Array<{ name: string; locked: boolean }> = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^##\s+(.+?)\s*$/.exec(lines[i]!);
    if (!m) continue;
    let j = i + 1;
    while (j < lines.length && lines[j]!.trim() === '') j++;
    out.push({ name: m[1]!, locked: (lines[j] ?? '').trim().startsWith(MEMORY_LOCKED_MARK) });
  }
  return out;
}

/** 插入/移除某节的锁定标记（节首行）；节不存在原样返回。 */
export function toggleSectionLock(raw: string, section: string): string {
  const nl = raw.includes('\r\n') ? '\r\n' : '\n';
  const lines = raw.split(/\r?\n/);
  const idx = lines.findIndex((l) => /^##\s+(.+?)\s*$/.exec(l)?.[1] === section);
  if (idx < 0) return raw;
  let j = idx + 1;
  while (j < lines.length && lines[j]!.trim() === '') j++;
  if ((lines[j] ?? '').trim().startsWith(MEMORY_LOCKED_MARK)) {
    const rest = lines[j]!.replace(MEMORY_LOCKED_MARK, '').trim();
    if (rest) lines[j] = rest;
    else lines.splice(j, 1);
  } else if (j >= lines.length) {
    lines.push('', MEMORY_LOCKED_MARK);
  } else {
    lines.splice(j, 0, MEMORY_LOCKED_MARK); // 紧贴节内容首行之前（保留标题后的空行）
  }
  return lines.join(nl);
}

export function isDirty(original: string, draft: string): boolean {
  return original.replace(/\r\n/g, '\n').trimEnd() !== draft.replace(/\r\n/g, '\n').trimEnd();
}

/** 去掉 frontmatter 只留正文（预览用；Main 侧 readPage.page.body 同义，这里对编辑中草稿算）。 */
export function stripFrontmatter(raw: string): string {
  const text = raw.replace(/\r\n/g, '\n');
  if (!text.startsWith('---\n')) return text;
  const end = text.indexOf('\n---', 4);
  if (end < 0) return text;
  return text.slice(end + 4).replace(/^\n+/, '');
}

export function kindOfPath(p: string): TreeGroup['kind'] {
  if (p === 'user/profile.md') return 'profile';
  if (p.startsWith('user/people/')) return 'people';
  if (p.startsWith('user/topics/')) return 'topics';
  return p.endsWith('/timeline.md') ? 'timeline' : 'relationship';
}

/** 固定页不可删（删 = 重置骨架，UI 不暴露）；只有 people/topics 可删。 */
export function isDeletable(p: string): boolean {
  const k = kindOfPath(p);
  return k === 'people' || k === 'topics';
}
