import { describe, expect, it } from 'vitest';
import type { MemoryGraph, MemorySource, MemoryTree } from '@openpet/protocol';
import { zhCN } from '../src/renderer/i18n/locales/zh-CN';
import {
  backlinksOf,
  buildGroups,
  filterGroups,
  ghostPageSkeleton,
  highlight,
  isDeletable,
  isDirty,
  linkResolverFor,
  listSections,
  sourceDate,
  sourceLine,
  sourceOpLabel,
  stripFrontmatter,
  toggleSectionLock,
} from '../src/renderer/settings/memory-view.js';

const node = (path: string, title: string, summary = '') => ({
  path,
  title,
  summary,
  updated: '2026-09-22',
  source: 'llm' as const,
  aliases: [],
  tags: [],
});
const tree: MemoryTree = {
  profile: node('user/profile.md', '用户档案'),
  people: [node('user/people/b.md', '小张', '同事'), node('user/people/a.md', '小明', '朋友')],
  topics: [node('user/topics/openpet.md', 'openpet', '桌宠项目')],
  relationship: node('characters/default/relationship.md', '我们的关系'),
  timeline: node('characters/default/timeline.md', '共同经历'),
};

describe('memory-view（F3 wiki 浏览器纯逻辑）', () => {
  it('buildGroups 五组固定顺序，people/topics 按 title 排序；filterGroups 子串过滤', () => {
    const g = buildGroups(tree);
    expect(g.map((x) => x.kind)).toEqual([
      'profile',
      'people',
      'topics',
      'relationship',
      'timeline',
    ]);
    expect(g[1]!.nodes.map((n) => n.title)).toEqual(['小明', '小张']); // 拼音序 ming < zhang
    const f = filterGroups(g, '桌宠');
    expect(f).toHaveLength(1);
    expect(f[0]!.nodes[0]!.path).toBe('user/topics/openpet.md');
    expect(filterGroups(g, '')).toBe(g);
  });

  it('highlight 切片（大小写不敏感）', () => {
    expect(highlight('Hello openpet, OPENPET!', 'openpet')).toEqual([
      { text: 'Hello ', hit: false },
      { text: 'openpet', hit: true },
      { text: ', ', hit: false },
      { text: 'OPENPET', hit: true },
      { text: '!', hit: false },
    ]);
    expect(highlight('x', '')).toEqual([{ text: 'x', hit: false }]);
  });

  it('listSections / toggleSectionLock 往返；CRLF 保留', () => {
    const raw = '---\ntitle: x\n---\n\n## 身份\n\n学生\n\n## 杂项\n\n<!-- locked -->\n手写';
    expect(listSections(raw)).toEqual([
      { name: '身份', locked: false },
      { name: '杂项', locked: true },
    ]);
    const locked = toggleSectionLock(raw, '身份');
    expect(listSections(locked)[0]).toEqual({ name: '身份', locked: true });
    expect(locked).toContain('## 身份\n\n<!-- locked -->\n学生');
    expect(toggleSectionLock(locked, '身份')).toBe(raw);
    const unlocked = toggleSectionLock(raw, '杂项');
    expect(listSections(unlocked)[1]).toEqual({ name: '杂项', locked: false });
    expect(unlocked).toContain('## 杂项\n\n手写');
    expect(toggleSectionLock(raw, '幽灵')).toBe(raw);
    const crlf = raw.replace(/\n/g, '\r\n');
    expect(toggleSectionLock(crlf, '身份')).toContain('\r\n<!-- locked -->\r\n');
  });

  it('isDirty 忽略行尾换行差异；stripFrontmatter；isDeletable 只对 people/topics', () => {
    expect(isDirty('a\n', 'a')).toBe(false);
    expect(isDirty('a\r\nb', 'a\nb')).toBe(false);
    expect(isDirty('a', 'b')).toBe(true);
    expect(stripFrontmatter('---\ntitle: x\n---\n\n正文')).toBe('正文');
    expect(stripFrontmatter('无 fm')).toBe('无 fm');
    expect(isDeletable('user/people/a.md')).toBe(true);
    expect(isDeletable('user/profile.md')).toBe(false);
    expect(isDeletable('characters/default/timeline.md')).toBe(false);
  });
});

describe('㉒ memory-view：反向链接 / 未建页面建页 / 预览解析器', () => {
  const graph: MemoryGraph = {
    nodes: [
      { id: 'user/profile.md', title: '我', kind: 'profile', tags: [], aliases: [], chars: 1, readonly: false },
      { id: 'user/people/王小明.md', title: '王小明', kind: 'people', tags: [], aliases: [], chars: 1, readonly: false },
      { id: 'user/topics/爬山.md', title: '爬山', kind: 'topics', tags: [], aliases: [], chars: 1, readonly: false },
      { id: 'ghost:珠峰', title: '珠峰', kind: 'ghost', tags: [], aliases: [], chars: 0, readonly: false },
    ],
    edges: [
      { source: 'user/topics/爬山.md', target: 'user/people/王小明.md', kind: 'link', count: 2, context: '和小王去香山' },
      { source: 'user/profile.md', target: 'user/people/王小明.md', kind: 'link', count: 1 },
      { source: 'user/profile.md', target: 'user/topics/爬山.md', kind: 'mention', count: 1 },
    ],
    stats: { pages: 3, links: 2, ghosts: 1, orphans: 0 },
  };

  it('backlinksOf 只算 link 边、按标题（拼音）排序、带 context', () => {
    expect(backlinksOf(graph, 'user/people/王小明.md')).toEqual([
      { path: 'user/topics/爬山.md', title: '爬山', context: '和小王去香山', count: 2 },
      { path: 'user/profile.md', title: '我', context: '', count: 1 },
    ]);
    expect(backlinksOf(graph, 'user/topics/爬山.md')).toEqual([]);
    expect(backlinksOf(null, 'x')).toEqual([]);
  });

  it('ghostPageSkeleton：文件名安全化 + JSON 串标题（合法 YAML）', () => {
    expect(ghostPageSkeleton('珠峰', 'topics')).toEqual({
      path: 'user/topics/珠峰.md',
      content: '---\ntitle: "珠峰"\n---\n\n',
    });
    expect(ghostPageSkeleton('a: b', 'people').path).toBe('user/people/a- b.md');
  });

  it('linkResolverFor：以图谱非 ghost 节点为目录、相对当前页', () => {
    const r = linkResolverFor(graph, 'user/topics/爬山.md');
    expect(r('王小明', false)).toBe('user/people/王小明.md');
    expect(r('珠峰', false)).toBeNull();
    expect(r('../profile.md', true)).toBe('user/profile.md');
  });
});

describe('㉔ 来源追溯文案（阅读栏「来源」）', () => {
  // 用真词条渲染：zh-CN 模板 + 最小插值（{name} → 参数）
  const zh = (zhCN as unknown as { settings: { memory: { src: Record<string, string> } } }).settings
    .memory.src;
  const t = (key: string, params: Record<string, unknown> = {}): string => {
    const leaf = key.replace('settings.memory.src.', '');
    const tpl = zh[leaf] ?? key;
    return tpl.replace(/\{(\w+)\}/g, (_m, k: string) => String(params[k] ?? ''));
  };
  const now = new Date(2026, 8, 27, 12).getTime();
  const base: MemorySource = {
    at: new Date(2026, 8, 22, 21).getTime(),
    characterId: 'default',
    characterName: '小灵',
    sessionId: 'default',
    sessionTitle: '周末计划',
    ops: [
      { op: 'upsert_section', detail: '近况' },
      { op: 'append_timeline', detail: '2026-09-22' },
      { op: 'append_timeline', detail: '2026-09-21' },
    ],
    viewable: true,
  };

  it('日期 · 会话 · 操作（同类去重）', () => {
    expect(sourceLine(base, t, now)).toBe('9 月 22 日 · 与小灵的「周末计划」 · 改写「近况」、新增经历');
  });

  it('跨年带年份；迁移 / 会话已删；各操作文案', () => {
    expect(sourceDate(new Date(2025, 11, 31).getTime(), t, now)).toBe('2025 年 12 月 31 日');
    expect(
      sourceLine({ ...base, sessionId: null, sessionTitle: null, ops: [{ op: 'create_page', detail: '王小明' }] }, t, now),
    ).toBe('9 月 22 日 · 旧记忆迁移 · 新建此页');
    expect(sourceLine({ ...base, sessionTitle: null, ops: [] }, t, now)).toBe(
      '9 月 22 日 · 与小灵的对话（已删除）',
    );
    const label = (op: string, detail: string | null = '甲') => sourceOpLabel({ op, detail }, t);
    expect(
      ['remove_line', 'merge_page', 'set_props', 'merge_timeline', 'mystery'].map((o) => label(o)),
    ).toEqual(['删减「甲」', '并入「甲」', '更新属性', '合并旧经历', 'mystery']);
  });
});
