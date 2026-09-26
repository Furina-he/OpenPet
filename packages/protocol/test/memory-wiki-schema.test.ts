import { describe, expect, it } from 'vitest';
import {
  MEMORY_QUOTAS,
  MEMORY_TAG_RE,
  MemoryOpsSchema,
  MemoryPageFrontmatterSchema,
  MemoryPageSchema,
  Methods,
} from '../src/index.js';

describe('⑲ / ㉒ memory wiki schema', () => {
  it('frontmatter：缺 title/updated 拒绝；aliases>20 拒绝；缺省 aliases/tags/summary/source', () => {
    const ok = MemoryPageFrontmatterSchema.parse({ title: '小明', updated: '2026-09-22' });
    expect(ok).toEqual({
      title: '小明',
      aliases: [],
      tags: [],
      summary: '',
      updated: '2026-09-22',
      source: 'llm',
    });
    expect(() => MemoryPageFrontmatterSchema.parse({ updated: '2026-09-22' })).toThrow();
    expect(() => MemoryPageFrontmatterSchema.parse({ title: 'x' })).toThrow();
    expect(() => MemoryPageFrontmatterSchema.parse({ title: 'x', updated: '2026/09/22' })).toThrow();
    expect(() =>
      MemoryPageFrontmatterSchema.parse({
        title: 'x',
        updated: '2026-09-22',
        aliases: Array.from({ length: 21 }, (_, i) => `k${i}`),
      }),
    ).toThrow();
    expect(() => MemoryPageSchema.parse({ path: 'x.md', frontmatter: ok, body: '' })).toThrow();
  });

  it('frontmatter v2：keys 并入 aliases、单值 / 数值 / null 兼容、tag 去 #、未知键保留', () => {
    const fm = MemoryPageFrontmatterSchema.parse({
      title: 2024,
      keys: ['小王'],
      aliases: '王工',
      tags: ['#同事', 7, 'a b'],
      summary: null,
      created: '2026-09-01',
      updated: '2026-09-22',
      cssclasses: ['wide'],
    });
    expect(fm).toMatchObject({
      title: '2024',
      aliases: ['王工', '小王'],
      tags: ['同事'],
      summary: '',
      created: '2026-09-01',
      cssclasses: ['wide'],
    });
    expect('keys' in fm).toBe(false);
    // 数值 alias 强转字符串
    expect(
      MemoryPageFrontmatterSchema.parse({ title: 'x', updated: '2026-09-22', aliases: [42] })
        .aliases,
    ).toEqual(['42']);
  });

  it('tag 规则：无空白与 # ,、不可纯数字、允许 / 嵌套', () => {
    for (const t of ['同事', 'work/project', 'a1', '2024年']) expect(MEMORY_TAG_RE.test(t), t).toBe(true);
    for (const t of ['a b', '#a', 'a,b', '123', '']) expect(MEMORY_TAG_RE.test(t), t).toBe(false);
  });

  it('页面路径：中文人物页合法；越界/穿越拒绝', () => {
    const fm = { title: 'x', updated: '2026-09-22' };
    for (const p of [
      'user/profile.md',
      'user/people/王小明.md',
      'user/topics/openpet.md',
      'characters/default/relationship.md',
      'characters/furina-1/timeline.md',
    ])
      expect(MemoryPageSchema.safeParse({ path: p, frontmatter: fm, body: '' }).success, p).toBe(
        true,
      );
    for (const p of ['../user/profile.md', 'user/../secrets.kc', 'index.md', 'user/other.md'])
      expect(MemoryPageSchema.safeParse({ path: p, frontmatter: fm, body: '' }).success, p).toBe(
        false,
      );
  });

  it('ops：六种合法；越界 page / 未知 op / 超长 / create_page 非 people|topics / >5 个拒绝', () => {
    const ops = MemoryOpsSchema.parse([
      { op: 'upsert_section', page: 'user/profile.md', section: '工作学习', content: '在深圳做前端' },
      { op: 'append_timeline', date: '2026-09-22', text: '一起聊了猫' },
      {
        op: 'create_page',
        kind: 'people',
        title: '年糕',
        aliases: ['年糕'],
        tags: ['宠物'],
        content: '用户的猫',
      },
      { op: 'remove_line', page: 'user/profile.md', section: '近况', match: '考试' },
      { op: 'merge_timeline', before: '2026-01-01', text: '年初我们常聊天' },
    ]);
    expect(ops).toHaveLength(5);
    expect(ops[2]).toMatchObject({ aliases: ['年糕'], tags: ['宠物'] });
    expect(
      MemoryOpsSchema.parse([
        { op: 'set_props', page: 'user/people/年糕.md', tags: ['宠物', '猫'] },
      ])[0],
    ).toEqual({ op: 'set_props', page: 'user/people/年糕.md', tags: ['宠物', '猫'] });
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
      [{ op: 'create_page', kind: 'profile', title: 'a', content: 'a' }],
      [{ op: 'create_page', kind: 'people', title: '   ', content: 'a' }],
      [{ op: 'create_page', kind: 'people', title: 'a', tags: ['a b'], content: 'a' }],
      [{ op: 'set_props', page: 'user/people/a.md' }],
      [{ op: 'set_props', page: '../a.md', summary: 'x' }],
      Array.from({ length: 6 }, () => ({ op: 'append_timeline', date: '2026-09-22', text: 'x' })),
    ];
    for (const b of bad) expect(MemoryOpsSchema.safeParse(b).success, JSON.stringify(b)).toBe(false);
  });

  it('create_page v1 兼容：slug 被忽略、keys 并入 aliases', () => {
    const [op] = MemoryOpsSchema.parse([
      {
        op: 'create_page',
        kind: 'people',
        slug: 'xiao-ming',
        title: '小明',
        keys: ['明哥'],
        content: '同事',
      },
    ]);
    expect(op).toEqual({
      op: 'create_page',
      kind: 'people',
      title: '小明',
      aliases: ['明哥'],
      tags: [],
      content: '同事',
    });
  });

  it('RPC 面：方法注册 + readPage 路径校验 + memory.changed 通知；废弃方法已删', () => {
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
    expect('memory.delete' in Methods).toBe(false);
    expect('memory.setPinned' in Methods).toBe(false);
    expect(() => Methods['memory.readPage'].params.parse({ path: '../etc' })).toThrow();
    expect(Methods['memory.readPage'].params.parse({ path: 'user/people/王小明.md' })).toEqual({
      path: 'user/people/王小明.md',
    });
    expect(Methods['memory.changed'].params.parse({ pages: ['user/profile.md'] })).toEqual({
      pages: ['user/profile.md'],
    });
    expect(
      Methods['memory.status'].result.parse({
        enabled: true,
        pageCount: 3,
        lastCompile: { at: 1, ok: true, ops: 1, merged: [['小王', 'user/people/王小明.md']] },
        migration: null,
        legacyFacts: 0,
      }).pageCount,
    ).toBe(3);
  });
});
