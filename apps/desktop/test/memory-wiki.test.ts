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
    expect(read(w, '.openpet/index.md')).toContain('[[profile]]');
    w.ensureLayout(CID);
    expect(read(w, 'user/profile.md')).toBe(before);
  });

  it('frontmatter 解析/序列化往返', () => {
    const raw = serializePage(
      {
        title: '年糕',
        aliases: ['年糕', '猫'],
        tags: [],
        summary: '用户的猫',
        updated: '2026-09-22',
        source: 'llm',
      },
      '## 正文\n\n是只橘猫',
    );
    const p = parseFrontmatter(raw)!;
    expect(p.fm).toEqual({
      title: '年糕',
      aliases: ['年糕', '猫'],
      tags: [],
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
        title: '年糕',
        aliases: ['猫'],
        tags: [],
        content: '用户的橘猫',
      },
      { op: 'append_timeline', date: '2026-09-20', text: '聊了猫' },
      { op: 'append_timeline', date: '2026-09-22', text: '聊了工作' },
    ];
    const { changed } = w.applyOps(ops, CID);
    expect(changed.sort()).toEqual([
      'characters/default/timeline.md',
      'user/people/年糕.md',
      'user/profile.md',
    ]);
    expect(read(w, 'user/profile.md')).toContain('## 工作学习\n\n在深圳做前端');
    expect(existsSync(path.join(w.root, 'user/profile.md.prev'))).toBe(true);
    expect(read(w, 'user/people/年糕.md')).toContain('summary: 用户的橘猫');
    expect(read(w, 'characters/default/timeline.md')).toMatch(
      /- 2026-09-22 聊了工作\n- 2026-09-20 聊了猫/,
    );
    expect(read(w, '.openpet/index.md')).toContain('[[年糕]]（人物）');
    expect(read(w, '.openpet/characters/default/index.md')).toContain('## 本角色');

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
            title: `t${i}`,
            aliases: [],
            tags: [],
            content: 'x',
          },
        ],
        CID,
      );
    expect(() =>
      w.applyOps(
        [{ op: 'create_page', kind: 'topics', title: 'o', aliases: [], tags: [], content: 'x' }],
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
          { op: 'create_page', kind: 'people', title: 'A', aliases: [], tags: [], content: 'x' },
          { op: 'upsert_section', page: 'user/profile.md', section: '幽灵节', content: 'x' },
        ],
        CID,
      ),
    ).toThrow(MemoryOpError);
    expect(read(w, 'user/profile.md')).toBe(before);
    expect(existsSync(path.join(w.root, 'user/people/A.md'))).toBe(false);
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
          title: 'openpet',
          aliases: ['桌宠'],
          tags: [],
          content: '项目',
        },
      ],
      CID,
    );
    const a = read(w, '.openpet/index.md');
    w.rebuildIndex();
    expect(read(w, '.openpet/index.md')).toBe(a);
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
          title: '小明',
          aliases: ['明哥'],
          tags: [],
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

const people = (title: string, aliases: string[] = [], content = `${title}的页`): MemoryOp => ({
  op: 'create_page',
  kind: 'people',
  title,
  aliases,
  tags: [],
  content,
});
const topic = (title: string, aliases: string[] = [], content = `${title}的页`): MemoryOp => ({
  op: 'create_page',
  kind: 'topics',
  title,
  aliases,
  tags: [],
  content,
});

describe('㉒ vault v2 文件层', () => {
  it('YAML 往返：Obsidian 块列表 / 未知键保留 / 数值 alias / v1 JSON 风格页；键序与块样式', () => {
    const w = makeWiki();
    w.ensureLayout(CID);
    const obsidian = [
      '---',
      'title: 王小明',
      'aliases:',
      '  - 小王',
      '  - 42',
      'tags:',
      '  - 同事',
      'cssclasses:',
      '  - wide',
      'updated: 2026-09-01',
      'source: user',
      'rating: 5',
      '---',
      '',
      '大学室友',
    ].join('\n');
    writeFileSync(path.join(w.root, 'user/people/王小明.md'), obsidian);
    const p = w.readPage('user/people/王小明.md')!;
    expect(p.frontmatter).toMatchObject({
      title: '王小明',
      aliases: ['小王', '42'],
      tags: ['同事'],
      cssclasses: ['wide'],
      rating: 5,
    });
    // 编译器改写该页：自定义属性仍在、键序 title → aliases → tags → … → 其余
    w.applyOps([{ op: 'upsert_section', page: p.path, section: '正文', content: '现在做后端' }], CID);
    const raw = read(w, 'user/people/王小明.md');
    expect(raw).toContain('cssclasses:\n  - wide');
    expect(raw).toContain('rating: 5');
    expect(raw).toMatch(/^---\ntitle: 王小明\naliases:\n {2}- 小王\n {2}- "42"\ntags:\n {2}- 同事\n/);
    expect(raw.indexOf('source:')).toBeLessThan(raw.indexOf('cssclasses:'));
    // v1 JSON 风格：keys 并入 aliases，写回只写 aliases
    writeFileSync(
      path.join(w.root, 'user/people/xiao-ming.md'),
      '---\ntitle: "小明"\nkeys: ["明哥"]\nsummary: "同事"\nupdated: 2026-09-01\nsource: llm\n---\n\n同事',
    );
    expect(w.readPage('user/people/xiao-ming.md')!.frontmatter.aliases).toEqual(['明哥']);
    w.applyOps([{ op: 'set_props', page: 'user/people/xiao-ming.md', tags: ['同事'] }], CID);
    const v2 = read(w, 'user/people/xiao-ming.md');
    expect(v2).toContain('aliases:\n  - 明哥');
    expect(v2).not.toContain('keys:');
  });

  it('create_page：中文文件名 + created；大小写冲突拒；配额照旧', () => {
    const w = makeWiki();
    w.ensureLayout(CID);
    w.applyOps([people('王小明', ['小王'])], CID);
    const p = w.readPage('user/people/王小明.md')!;
    expect(p.frontmatter).toMatchObject({ title: '王小明', aliases: ['小王'], created: '2026-09-22' });
    w.applyOps([people('a-b')], CID);
    // 规范化名不同、但文件名（A?B → A-B）大小写不敏感撞车 → 拒
    expect(() => w.applyOps([people('A?B')], CID)).toThrow(/已存在/);
  });

  it('撞名并入：别名撞名 / 标题撞名并入同类页，aliases / tags 并集，merged 回报；跨类不并', () => {
    const w = makeWiki();
    w.ensureLayout(CID);
    w.applyOps([people('王小明', ['小王'], '大学室友')], CID);
    const r = w.applyOps(
      [
        { ...people('小王', ['王工'], '现在做后端'), tags: ['同事'] } as MemoryOp,
        people('「王小明」', [], '喜欢爬山'),
        topic('小王', [], '一个话题'),
      ],
      CID,
    );
    expect(r.merged).toEqual([
      ['小王', 'user/people/王小明.md'],
      ['「王小明」', 'user/people/王小明.md'],
    ]);
    expect(existsSync(path.join(w.root, 'user/people/小王.md'))).toBe(false);
    expect(existsSync(path.join(w.root, 'user/topics/小王.md'))).toBe(true);
    const p = w.readPage('user/people/王小明.md')!;
    expect(p.frontmatter.aliases).toEqual(['小王', '王工']);
    expect(p.frontmatter.tags).toEqual(['同事']);
    expect(p.body.trim()).toBe('大学室友\n\n现在做后端\n\n喜欢爬山');
  });

  it('撞名并入后超页配额 → 整批拒', () => {
    const w = makeWiki();
    w.ensureLayout(CID);
    w.applyOps([people('王小明', ['小王'], 'x'.repeat(MEMORY_QUOTAS.pageChars - 10))], CID);
    const before = read(w, 'user/people/王小明.md');
    expect(() =>
      w.applyOps(
        [
          { op: 'upsert_section', page: 'user/profile.md', section: '身份', content: '学生' },
          people('小王', [], 'y'.repeat(50)),
        ],
        CID,
      ),
    ).toThrow(/配额/);
    expect(read(w, 'user/people/王小明.md')).toBe(before);
    expect(read(w, 'user/profile.md')).not.toContain('学生');
  });

  it('set_props：整组替换 aliases / tags / summary；title / created / 自定义键不动；护栏', () => {
    const w = makeWiki();
    w.ensureLayout(CID);
    w.applyOps([people('王小明', ['小王'])], CID);
    w.applyOps(
      [
        {
          op: 'set_props',
          page: 'user/people/王小明.md',
          aliases: ['王工'],
          tags: ['同事', '朋友'],
          summary: '大学室友',
        },
        { op: 'upsert_section', page: 'user/people/王小明.md', section: '正文', content: '后端' },
      ],
      CID,
    );
    const fm = w.readPage('user/people/王小明.md')!.frontmatter;
    expect(fm).toMatchObject({
      title: '王小明',
      aliases: ['王工'],
      tags: ['同事', '朋友'],
      summary: '大学室友',
      created: '2026-09-22',
    });
    const bad: MemoryOp[][] = [
      [{ op: 'set_props', page: 'user/people/不存在.md', tags: ['a'] }],
      [{ op: 'set_props', page: 'characters/other/relationship.md', summary: 'x' }],
      [
        { op: 'set_props', page: 'user/people/王小明.md', tags: ['a'] },
        { op: 'set_props', page: 'user/people/王小明.md', summary: 'b' },
      ],
    ];
    for (const b of bad) expect(() => w.applyOps(b, CID), JSON.stringify(b)).toThrow(MemoryOpError);
  });

  it('append_timeline 日期夹紧：晚于今天记为今天', () => {
    const w = makeWiki();
    w.ensureLayout(CID);
    w.applyOps([{ op: 'append_timeline', date: '2030-01-01', text: '未来的事' }], CID);
    expect(read(w, 'characters/default/timeline.md')).toContain('- 2026-09-22 未来的事');
  });

  it('LLM 写入规范化：别名 → 文件名、悬空降纯文本、漏写链接被补链、本批新建可链、不链自身', () => {
    const w = makeWiki();
    w.ensureLayout(CID);
    w.applyOps([people('王小明', ['小王']), topic('爬山', ['徒步'])], CID);
    w.applyOps(
      [
        {
          op: 'upsert_section',
          page: 'user/profile.md',
          section: '近况',
          content: '常和[[小王]]去[[火星]]，也喜欢徒步，最近认识了李雷',
        },
        people('李雷', [], '王小明介绍的朋友'),
        { op: 'append_timeline', date: '2026-09-22', text: '我陪 ta 聊到[[李雷]]和爬山' },
      ],
      CID,
    );
    expect(read(w, 'user/profile.md')).toContain(
      '常和[[王小明|小王]]去火星，也喜欢[[爬山|徒步]]，最近认识了[[李雷]]',
    );
    expect(read(w, 'user/people/李雷.md')).toContain('[[王小明]]介绍的朋友');
    expect(read(w, 'characters/default/timeline.md')).toContain(
      '- 2026-09-22 我陪 ta 聊到[[李雷]]和[[爬山]]',
    );
    // 页面不链自身
    w.applyOps(
      [{ op: 'upsert_section', page: 'user/people/李雷.md', section: '正文', content: '李雷是个好人' }],
      CID,
    );
    expect(read(w, 'user/people/李雷.md')).toContain('\n李雷是个好人');
  });

  it('用户保存（writeRaw）：只做别名 → 文件名；悬空保留；不补链；created 缺省补今天', () => {
    const w = makeWiki();
    w.ensureLayout(CID);
    w.applyOps([people('王小明', ['小王'])], CID);
    const page = w.writeRaw(
      'user/topics/爬山.md',
      '---\ntitle: 爬山\n---\n\n和[[小王]]去[[火星]]，王小明也在',
    );
    expect(page.body).toBe('和[[王小明|小王]]去[[火星]]，王小明也在');
    expect(page.frontmatter.created).toBe('2026-09-22');
  });

  it('timeline 前言（导航行）在 append / merge 后保留；固定页骨架带导航行与可读 aliases', () => {
    const w = makeWiki();
    w.ensureLayout(CID);
    expect(read(w, 'characters/default/relationship.md')).toContain(
      '> [[profile|用户档案]] · [[characters/default/timeline|共同经历]]',
    );
    expect(w.readPage('characters/default/relationship.md')!.frontmatter.aliases).toEqual([
      '我们的关系',
    ]);
    w.applyOps(
      [
        { op: 'append_timeline', date: '2026-09-01', text: 'a' },
        { op: 'append_timeline', date: '2026-09-10', text: 'b' },
      ],
      CID,
    );
    w.applyOps([{ op: 'merge_timeline', before: '2026-09-05', text: '早先' }], CID);
    const tl = read(w, 'characters/default/timeline.md');
    expect(tl).toContain('> [[characters/default/relationship|我们的关系]]\n\n- 2026-09-10 b');
    expect(tl).toContain('- 2026-09-05 （此前合并）早先');
    // 关系页 upsert 不动前言
    w.applyOps(
      [
        {
          op: 'upsert_section',
          page: 'characters/default/relationship.md',
          section: '称呼',
          content: '阿芙',
        },
      ],
      CID,
    );
    expect(read(w, 'characters/default/relationship.md')).toContain('> [[profile|用户档案]]');
  });

  it('固定页损坏时 tree() 不抛：broken 占位节点；节点带 aliases / tags', () => {
    const w = makeWiki();
    w.ensureLayout(CID);
    w.applyOps([{ ...people('王小明', ['小王']), tags: ['同事'] } as MemoryOp], CID);
    writeFileSync(path.join(w.root, 'user/profile.md'), '---\ntitle: [坏\n---\n');
    const t = w.tree(CID);
    expect(t.profile).toMatchObject({ path: 'user/profile.md', broken: true, title: '用户档案' });
    expect(t.people[0]).toMatchObject({ aliases: ['小王'], tags: ['同事'] });
    expect(t.relationship.broken).toBeUndefined();
  });

  it('注入视图无 [[：resident / lorebook；lorebook keys = aliases ∪ title ∪ 文件名；search 覆盖 aliases / tags', () => {
    const w = makeWiki();
    w.ensureLayout(CID);
    w.applyOps([{ ...people('王小明', ['小王'], '做后端'), tags: ['同事'] } as MemoryOp], CID);
    w.applyOps(
      [
        {
          op: 'upsert_section',
          page: 'user/profile.md',
          section: '一句话档案',
          content: '程序员，朋友王小明',
        },
        {
          op: 'upsert_section',
          page: 'characters/default/relationship.md',
          section: '称呼',
          content: '叫小王的朋友是王小明',
        },
        { op: 'append_timeline', date: '2026-09-22', text: '聊到王小明' },
        topic('爬山', [], '和小王一起'),
      ],
      CID,
    );
    expect(read(w, 'user/profile.md')).toContain('[[王小明]]');
    for (const b of w.residentBlocks(CID)) expect(b).not.toContain('[[');
    expect(w.residentBlocks(CID).join('\n')).toContain('朋友王小明');
    const book = w.projectToLorebook(CID);
    for (const e of book.entries) expect(e.content).not.toContain('[[');
    expect(book.entries.find((e) => e.name === 'user/people/王小明.md')!.keys).toEqual([
      '小王',
      '王小明',
    ]);
    expect(book.entries.find((e) => e.name === 'user/topics/爬山.md')!.content).toContain(
      '和小王一起',
    );
    expect(w.search('同事', CID)[0]?.path).toBe('user/people/王小明.md');
  });
});
