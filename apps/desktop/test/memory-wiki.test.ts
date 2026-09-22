import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { activateLorebook, MEMORY_QUOTAS, type MemoryOp } from '@openpet/protocol';
import {
  MemoryOpError,
  MemoryWiki,
  parseFrontmatter,
  serializePage,
  splitSections,
} from '../electron/main/memory-wiki.js';

const cleanups: string[] = [];
function makeWiki(now = () => Date.UTC(2026, 8, 22, 12)): MemoryWiki {
  const d = mkdtempSync(path.join(tmpdir(), 'ds-wiki-'));
  cleanups.push(d);
  return new MemoryWiki(d, { now });
}
afterEach(() => {
  for (const p of cleanups.splice(0)) rmSync(p, { recursive: true, force: true });
});
const CID = 'default';
const read = (w: MemoryWiki, rel: string): string => readFileSync(path.join(w.root, rel), 'utf8');

describe('⑲ memory-wiki 文件层', () => {
  it('ensureLayout 幂等：profile 固定节 + relationship/timeline 空页 + index.md', () => {
    const w = makeWiki();
    w.ensureLayout(CID);
    const before = read(w, 'user/profile.md');
    expect(before).toContain('## 身份');
    expect(before).toContain('## 杂项');
    expect(existsSync(path.join(w.root, 'characters/default/relationship.md'))).toBe(true);
    expect(existsSync(path.join(w.root, 'characters/default/timeline.md'))).toBe(true);
    expect(read(w, 'index.md')).toContain('user/profile.md');
    w.ensureLayout(CID);
    expect(read(w, 'user/profile.md')).toBe(before);
  });

  it('frontmatter 解析/序列化往返', () => {
    const raw = serializePage(
      {
        title: '年糕',
        keys: ['年糕', '猫'],
        summary: '用户的猫',
        updated: '2026-09-22',
        source: 'llm',
      },
      '## 正文\n\n是只橘猫',
    );
    const p = parseFrontmatter(raw)!;
    expect(p.fm).toEqual({
      title: '年糕',
      keys: ['年糕', '猫'],
      summary: '用户的猫',
      updated: '2026-09-22',
      source: 'llm',
    });
    expect(p.body.trim()).toBe('## 正文\n\n是只橘猫');
    expect(parseFrontmatter('no fm')).toBeNull();
    expect(splitSections('自由文本').sections).toEqual([{ name: '正文', body: '自由文本' }]);
  });

  it('五种 op 各一例落盘 + .prev + index 重生成', () => {
    const w = makeWiki();
    w.ensureLayout(CID);
    const ops: MemoryOp[] = [
      {
        op: 'upsert_section',
        page: 'user/profile.md',
        section: '工作学习',
        content: '在深圳做前端',
      },
      {
        op: 'create_page',
        kind: 'people',
        slug: 'nian-gao',
        title: '年糕',
        keys: ['猫'],
        content: '用户的橘猫',
      },
      { op: 'append_timeline', date: '2026-09-20', text: '聊了猫' },
      { op: 'append_timeline', date: '2026-09-22', text: '聊了工作' },
    ];
    const { changed } = w.applyOps(ops, CID);
    expect(changed.sort()).toEqual([
      'characters/default/timeline.md',
      'user/people/nian-gao.md',
      'user/profile.md',
    ]);
    expect(read(w, 'user/profile.md')).toContain('## 工作学习\n\n在深圳做前端');
    expect(existsSync(path.join(w.root, 'user/profile.md.prev'))).toBe(true);
    expect(read(w, 'user/people/nian-gao.md')).toContain('summary: "用户的橘猫"');
    expect(read(w, 'characters/default/timeline.md')).toMatch(
      /- 2026-09-22 聊了工作\n- 2026-09-20 聊了猫/,
    );
    expect(read(w, 'index.md')).toContain('[年糕](user/people/nian-gao.md)');
    expect(read(w, 'characters/default/index.md')).toContain('## 本角色');

    w.applyOps(
      [{ op: 'remove_line', page: 'user/profile.md', section: '工作学习', match: '深圳' }],
      CID,
    );
    expect(read(w, 'user/profile.md')).not.toContain('深圳');
    w.applyOps([{ op: 'merge_timeline', before: '2026-09-21', text: '九月中旬聊猫' }], CID);
    const tl = read(w, 'characters/default/timeline.md');
    expect(tl).toContain('（此前合并）九月中旬聊猫');
    expect(tl).not.toContain('聊了猫');
    expect(tl).toContain('聊了工作');
  });

  it('护栏：锁定节 / 未知节 / 他角色页 / 同批同节重复 / 页数配额 / 页面超配额 → 拒绝', () => {
    const w = makeWiki();
    w.ensureLayout(CID);
    w.writeRaw(
      'user/profile.md',
      read(w, 'user/profile.md').replace('## 杂项\n', '## 杂项\n\n<!-- locked -->\n用户手写'),
    );
    const bad: MemoryOp[][] = [
      [{ op: 'upsert_section', page: 'user/profile.md', section: '杂项', content: 'x' }],
      [{ op: 'remove_line', page: 'user/profile.md', section: '杂项', match: '用户' }],
      [{ op: 'upsert_section', page: 'user/profile.md', section: '不存在', content: 'x' }],
      [
        {
          op: 'upsert_section',
          page: 'characters/other/relationship.md',
          section: '称呼',
          content: 'x',
        },
      ],
      [
        { op: 'upsert_section', page: 'user/profile.md', section: '身份', content: 'a' },
        { op: 'upsert_section', page: 'user/profile.md', section: '身份', content: 'b' },
      ],
      [
        {
          op: 'upsert_section',
          page: 'user/profile.md',
          section: '身份',
          content: '<!-- locked --> x',
        },
      ],
      [{ op: 'merge_timeline', before: '2026-01-01', text: 'x' }],
    ];
    for (const b of bad) expect(() => w.applyOps(b, CID), JSON.stringify(b)).toThrow(MemoryOpError);
    expect(read(w, 'user/profile.md')).toContain('用户手写');
    // 页数配额
    for (let i = 0; i < MEMORY_QUOTAS.pagesPerKind; i++)
      w.applyOps(
        [
          {
            op: 'create_page',
            kind: 'topics',
            slug: `t${i}`,
            title: `t${i}`,
            keys: [],
            content: 'x',
          },
        ],
        CID,
      );
    expect(() =>
      w.applyOps(
        [{ op: 'create_page', kind: 'topics', slug: 'over', title: 'o', keys: [], content: 'x' }],
        CID,
      ),
    ).toThrow(/配额/);
    // profile 超配额：五节各塞 700 字（单节 ≤2000 合法，总量 3500 > 3000）
    const secs = ['身份', '工作学习', '习惯作息', '喜好厌恶', '近况'];
    expect(() =>
      w.applyOps(
        secs.map((s) => ({
          op: 'upsert_section' as const,
          page: 'user/profile.md',
          section: s,
          content: 'x'.repeat(700),
        })),
        CID,
      ),
    ).toThrow(/配额/);
  });

  it('整批原子性：第 3 个 op 非法 → 前 2 个不落盘、.prev 不产生', () => {
    const w = makeWiki();
    w.ensureLayout(CID);
    const before = read(w, 'user/profile.md');
    expect(() =>
      w.applyOps(
        [
          { op: 'upsert_section', page: 'user/profile.md', section: '身份', content: '学生' },
          { op: 'create_page', kind: 'people', slug: 'a', title: 'A', keys: [], content: 'x' },
          { op: 'upsert_section', page: 'user/profile.md', section: '幽灵节', content: 'x' },
        ],
        CID,
      ),
    ).toThrow(MemoryOpError);
    expect(read(w, 'user/profile.md')).toBe(before);
    expect(existsSync(path.join(w.root, 'user/people/a.md'))).toBe(false);
    expect(existsSync(path.join(w.root, 'user/profile.md.prev'))).toBe(false);
  });

  it('.prev 只保留上一版（覆盖语义）', () => {
    const w = makeWiki();
    w.ensureLayout(CID);
    w.applyOps(
      [{ op: 'upsert_section', page: 'user/profile.md', section: '身份', content: 'v1' }],
      CID,
    );
    w.applyOps(
      [{ op: 'upsert_section', page: 'user/profile.md', section: '身份', content: 'v2' }],
      CID,
    );
    expect(read(w, 'user/profile.md.prev')).toContain('v1');
    expect(read(w, 'user/profile.md')).toContain('v2');
  });

  it('index 确定性：两次 rebuild 逐字节相等；writeRaw 校验 + source:user', () => {
    const w = makeWiki();
    w.ensureLayout(CID);
    w.applyOps(
      [
        {
          op: 'create_page',
          kind: 'topics',
          slug: 'openpet',
          title: 'openpet',
          keys: ['桌宠'],
          content: '项目',
        },
      ],
      CID,
    );
    const a = read(w, 'index.md');
    w.rebuildIndex();
    expect(read(w, 'index.md')).toBe(a);
    expect(() => w.writeRaw('user/topics/openpet.md', 'no frontmatter')).toThrow(MemoryOpError);
    const p = w.writeRaw(
      'user/topics/openpet.md',
      '---\ntitle: openpet\nkeys: ["桌宠","pet"]\n---\n\n改过了',
    );
    expect(p.frontmatter.source).toBe('user');
    expect(p.frontmatter.updated).toBe('2026-09-22');
    expect(read(w, 'user/topics/openpet.md')).toContain('source: user');
    expect(w.search('pet', CID)[0]?.path).toBe('user/topics/openpet.md');
    expect(w.tree(CID).topics).toHaveLength(1);
    w.deletePage('user/topics/openpet.md', CID);
    expect(w.tree(CID).topics).toHaveLength(0);
  });

  it('lorebook 投影：keys 含 title、activateLorebook 命中；resident 视图三块 + 长度上限；锁定标记不外泄', () => {
    const w = makeWiki();
    w.ensureLayout(CID);
    w.applyOps(
      [
        {
          op: 'create_page',
          kind: 'people',
          slug: 'xiao-ming',
          title: '小明',
          keys: ['明哥'],
          content: '用户的同事',
        },
        {
          op: 'upsert_section',
          page: 'user/profile.md',
          section: '一句话档案',
          content: 'x'.repeat(1000),
        },
        {
          op: 'upsert_section',
          page: 'characters/default/relationship.md',
          section: '称呼',
          content: '叫我阿芙',
        },
        { op: 'append_timeline', date: '2026-09-22', text: '第一次聊天' },
      ],
      CID,
    );
    writeFileSync(
      path.join(w.root, 'characters/default/relationship.md'),
      read(w, 'characters/default/relationship.md').replace(
        '叫我阿芙',
        '<!-- locked -->\n叫我阿芙',
      ),
    );
    const book = w.projectToLorebook(CID);
    expect(book.entries[0]!.keys).toEqual(['明哥', '小明']);
    expect(activateLorebook(book, { history: [], current: '小明今天来了' })[0]).toContain(
      '用户的同事',
    );
    expect(activateLorebook(book, { history: [], current: '无关' })).toEqual([]);
    const blocks = w.residentBlocks(CID);
    expect(blocks).toHaveLength(3);
    expect(blocks[0]!.length).toBeLessThanOrEqual(MEMORY_QUOTAS.residentProfileChars + 20);
    expect(blocks[1]).toContain('称呼：叫我阿芙');
    expect(blocks[1]).not.toContain('locked');
    expect(blocks[2]).toContain('2026-09-22 第一次聊天');
  });
});
