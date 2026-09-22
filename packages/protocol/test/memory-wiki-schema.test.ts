import { describe, expect, it } from 'vitest';
import {
  MEMORY_PAGE_PATH_RE,
  MEMORY_QUOTAS,
  MEMORY_SLUG_RE,
  MemoryOpsSchema,
  MemoryPageFrontmatterSchema,
  MemoryPageSchema,
  Methods,
} from '../src/index.js';

describe('⑲ memory wiki schema', () => {
  it('slug 边界：小写字母数字连字符、≤41 字、首字符非连字符', () => {
    expect(MEMORY_SLUG_RE.test('a')).toBe(true);
    expect(MEMORY_SLUG_RE.test('xiao-ming-2')).toBe(true);
    expect(MEMORY_SLUG_RE.test('a'.repeat(41))).toBe(true);
    expect(MEMORY_SLUG_RE.test('a'.repeat(42))).toBe(false);
    expect(MEMORY_SLUG_RE.test('-abc')).toBe(false);
    expect(MEMORY_SLUG_RE.test('小明')).toBe(false);
    expect(MEMORY_SLUG_RE.test('Abc')).toBe(false);
  });

  it('页面路径白名单：五类合法；越界/穿越拒绝', () => {
    for (const p of [
      'user/profile.md',
      'user/people/xiao-ming.md',
      'user/topics/openpet.md',
      'characters/default/relationship.md',
      'characters/furina-1/timeline.md',
    ])
      expect(MEMORY_PAGE_PATH_RE.test(p), p).toBe(true);
    for (const p of [
      '../user/profile.md',
      'user/../secrets.kc',
      'user/people/Bad.md',
      'user/other.md',
      'characters/default/profile.md',
      'index.md',
      'user/people/x.txt',
    ])
      expect(MEMORY_PAGE_PATH_RE.test(p), p).toBe(false);
  });

  it('frontmatter：缺 title/updated 拒绝；keys>20 拒绝；缺省 keys/summary/source', () => {
    const ok = MemoryPageFrontmatterSchema.parse({ title: '小明', updated: '2026-09-22' });
    expect(ok).toEqual({ title: '小明', keys: [], summary: '', updated: '2026-09-22', source: 'llm' });
    expect(() => MemoryPageFrontmatterSchema.parse({ updated: '2026-09-22' })).toThrow();
    expect(() => MemoryPageFrontmatterSchema.parse({ title: 'x' })).toThrow();
    expect(() => MemoryPageFrontmatterSchema.parse({ title: 'x', updated: '2026/09/22' })).toThrow();
    expect(() =>
      MemoryPageFrontmatterSchema.parse({
        title: 'x',
        updated: '2026-09-22',
        keys: Array.from({ length: 21 }, (_, i) => `k${i}`),
      }),
    ).toThrow();
    expect(() => MemoryPageSchema.parse({ path: 'x.md', frontmatter: ok, body: '' })).toThrow();
  });

  it('ops：五种合法；越界 page / 未知 op / 超长 / create_page 非 people|topics / >5 个拒绝', () => {
    const ops = MemoryOpsSchema.parse([
      { op: 'upsert_section', page: 'user/profile.md', section: '工作学习', content: '在深圳做前端' },
      { op: 'append_timeline', date: '2026-09-22', text: '一起聊了猫' },
      {
        op: 'create_page',
        kind: 'people',
        slug: 'nian-gao',
        title: '年糕',
        keys: ['年糕'],
        content: '用户的猫',
      },
      { op: 'remove_line', page: 'user/profile.md', section: '近况', match: '考试' },
      { op: 'merge_timeline', before: '2026-01-01', text: '年初我们常聊天' },
    ]);
    expect(ops).toHaveLength(5);
    expect(ops[2]).toMatchObject({ keys: ['年糕'] });
    const bad: unknown[] = [
      [{ op: 'upsert_section', page: '../x.md', section: 'a', content: 'b' }],
      [{ op: 'nuke' }],
      [
        {
          op: 'upsert_section',
          page: 'user/profile.md',
          section: 'a',
          content: 'x'.repeat(MEMORY_QUOTAS.sectionChars + 1),
        },
      ],
      [
        {
          op: 'append_timeline',
          date: '2026-09-22',
          text: 'x'.repeat(MEMORY_QUOTAS.timelineEntryChars + 1),
        },
      ],
      [{ op: 'create_page', kind: 'profile', slug: 'a', title: 'a', content: 'a' }],
      [{ op: 'create_page', kind: 'people', slug: 'Bad Slug', title: 'a', content: 'a' }],
      Array.from({ length: 6 }, () => ({ op: 'append_timeline', date: '2026-09-22', text: 'x' })),
    ];
    for (const b of bad) expect(MemoryOpsSchema.safeParse(b).success, JSON.stringify(b)).toBe(false);
  });

  it('RPC 面：新方法注册 + readPage 路径校验 + memory.changed 通知', () => {
    for (const m of [
      'memory.tree',
      'memory.readPage',
      'memory.writePage',
      'memory.deletePage',
      'memory.compileNow',
      'memory.openFolder',
      'memory.search',
      'memory.status',
      'memory.changed',
    ] as const)
      expect(Methods[m]).toBeDefined();
    expect(() => Methods['memory.readPage'].params.parse({ path: '../etc' })).toThrow();
    expect(Methods['memory.changed'].params.parse({ pages: ['user/profile.md'] })).toEqual({
      pages: ['user/profile.md'],
    });
    expect(
      Methods['memory.status'].result.parse({
        enabled: true,
        pageCount: 3,
        lastCompile: null,
        migration: null,
        legacyFacts: 0,
      }).pageCount,
    ).toBe(3);
  });
});
