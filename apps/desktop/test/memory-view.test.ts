import { describe, expect, it } from 'vitest';
import type { MemoryTree } from '@openpet/protocol';
import {
  buildGroups,
  filterGroups,
  highlight,
  isDeletable,
  isDirty,
  listSections,
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
