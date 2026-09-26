import { describe, expect, it } from 'vitest';
import {
  Methods,
  canonicalName,
  isMemoryPagePath,
  linkifyMentions,
  memoryFileStem,
  memoryLinkName,
  memoryPageKind,
  memoryPageStem,
  normalizeLinks,
  parseWikilinks,
  resolveLink,
  rewriteLinkTarget,
  toPlainText,
  type MemoryLinkPage,
} from '../src/index.js';

const page = (path: string, title: string, aliases: string[] = []): MemoryLinkPage => ({
  path,
  title,
  aliases,
});

const PAGES: MemoryLinkPage[] = [
  page('user/profile.md', '用户档案', ['用户档案']),
  page('user/people/王小明.md', '王小明', ['小王', '王工']),
  page('user/people/Alice.md', 'Alice', []),
  page('user/topics/爬山.md', '爬山', ['徒步']),
  page('user/topics/苹果.md', '苹果', []),
  page('user/people/苹果.md', '苹果', []),
  page('characters/furina/relationship.md', '我们的关系', ['我们的关系']),
  page('characters/furina/timeline.md', '共同经历', ['共同经历']),
];

describe('㉒ memoryFileStem', () => {
  it('非法字符换 -、折叠、去首尾点与空白', () => {
    expect(memoryFileStem('  a/b:c*d?  ')).toBe('a-b-c-d-');
    expect(memoryFileStem('王 小  明')).toBe('王 小 明');
    expect(memoryFileStem('[[x]]#^|')).toBe('-x-');
    expect(memoryFileStem('..hidden.')).toBe('hidden');
    expect(memoryFileStem('a\u0001b\tc')).toBe('a-b-c');
  });
  it('保留名加 _（含扩展名形式、大小写不敏感）', () => {
    expect(memoryFileStem('con')).toBe('con_');
    expect(memoryFileStem('LPT3')).toBe('LPT3_');
    expect(memoryFileStem('Nul.txt')).toBe('Nul_.txt');
    expect(memoryFileStem('console')).toBe('console');
  });
  it('截 60 个 UTF-16 单元且不切断代理对；空串回退「未命名」', () => {
    expect(memoryFileStem('字'.repeat(80))).toHaveLength(60);
    const emoji = 'a'.repeat(59) + '😀';
    expect(memoryFileStem(emoji)).toBe('a'.repeat(59));
    expect(memoryFileStem('   ')).toBe('未命名');
    expect(memoryFileStem('...')).toBe('未命名');
  });
  it('已安全的串不变（幂等）', () => {
    for (const s of ['王小明', 'xiao-ming', 'Alice Bob', 'con', '字'.repeat(80), '[a]'])
      expect(memoryFileStem(memoryFileStem(s))).toBe(memoryFileStem(s));
    expect(memoryFileStem('王小明')).toBe('王小明');
    expect(memoryFileStem('xiao-ming')).toBe('xiao-ming');
  });
  it('NFC 规范化', () => {
    expect(memoryFileStem('Café')).toBe('Café');
  });
});

describe('㉒ isMemoryPagePath', () => {
  it('固定页与中文 / 旧 slug 人物话题页通过', () => {
    for (const p of [
      'user/profile.md',
      'characters/furina/relationship.md',
      'characters/furina/timeline.md',
      'user/people/王小明.md',
      'user/topics/爬山 徒步.md',
      'user/people/xiao-ming.md',
      'user/people/Alice.md',
    ])
      expect(isMemoryPagePath(p), p).toBe(true);
  });
  it('穿越 / 点开头 / 控制字符 / 非安全 stem / 其他目录拒', () => {
    for (const p of [
      'user/people/../profile.md',
      'user/people/.hidden.md',
      'user/people/a\\b.md',
      'user/people/a\u0001.md',
      'user/people/a:b.md',
      'user/people/ 王.md',
      'user/people/con.md',
      'user/other/x.md',
      'characters/Furina/timeline.md',
      'characters/furina/notes.md',
      'user/people/x.txt',
      '../x.md',
      'user/people/.md',
    ])
      expect(isMemoryPagePath(p), p).toBe(false);
  });
  it('kind / stem', () => {
    expect(memoryPageKind('user/profile.md')).toBe('profile');
    expect(memoryPageKind('user/people/a.md')).toBe('people');
    expect(memoryPageKind('user/topics/a.md')).toBe('topics');
    expect(memoryPageKind('characters/x/timeline.md')).toBe('timeline');
    expect(memoryPageKind('characters/x/relationship.md')).toBe('relationship');
    expect(memoryPageStem('user/people/王小明.md')).toBe('王小明');
  });
});

describe('㉒ canonicalName', () => {
  it('括号 / 引号 / 首尾标点 / 大小写 / 空白', () => {
    expect(canonicalName(' 「小王」 ')).toBe('小王');
    expect(canonicalName('《三体》。')).toBe('三体');
    expect(canonicalName('(Alice)')).toBe('alice');
    expect(canonicalName('“王 小  明”,')).toBe('王 小 明');
    expect(canonicalName('【爬山】')).toBe('爬山');
    expect(canonicalName('Bob Smith')).toBe(canonicalName('bob   smith'));
  });
});

describe('㉒ parseWikilinks', () => {
  it('四种写法 + 嵌入 + md 链接', () => {
    const md =
      '见 [[王小明]]、[[王小明|小王]]、[[王小明#近况]]、[[王小明#近况|他]]、![[爬山]]、[档案](../profile.md)、[外](https://x.com/a.md)';
    const ls = parseWikilinks(md);
    expect(ls.map((l) => [l.target, l.heading, l.display, l.embed, l.markdown])).toEqual([
      ['王小明', undefined, undefined, false, false],
      ['王小明', undefined, '小王', false, false],
      ['王小明', '近况', undefined, false, false],
      ['王小明', '近况', '他', false, false],
      ['爬山', undefined, undefined, true, false],
      ['../profile.md', undefined, '档案', false, true],
    ]);
    expect(md.slice(ls[1]!.start, ls[1]!.end)).toBe('[[王小明|小王]]');
  });
  it('跳过 fenced code 与行内 code', () => {
    const md = '`[[a]]` 与\n```\n[[b]]\n```\n~~~\n[[c]]\n~~~\n[[d]]';
    expect(parseWikilinks(md).map((l) => l.target)).toEqual(['d']);
  });
  it('表格里的 \\| 分隔显示名；md 链接 URL 解码', () => {
    expect(parseWikilinks('[[王小明\\|小王]]')[0]).toMatchObject({
      target: '王小明',
      display: '小王',
    });
    expect(parseWikilinks('[x](user/people/%E7%8E%8B.md)')[0]!.target).toBe('user/people/王.md');
  });
});

describe('㉒ resolveLink', () => {
  it('文件名大小写不敏感；不按别名解析；ghost = null', () => {
    expect(resolveLink('alice', 'user/profile.md', PAGES)).toBe('user/people/Alice.md');
    expect(resolveLink('小王', 'user/profile.md', PAGES)).toBeNull();
    expect(resolveLink('不存在', 'user/profile.md', PAGES)).toBeNull();
  });
  it('同名：同目录优先 → people → topics', () => {
    expect(resolveLink('苹果', 'user/topics/爬山.md', PAGES)).toBe('user/topics/苹果.md');
    expect(resolveLink('苹果', 'user/profile.md', PAGES)).toBe('user/people/苹果.md');
    expect(resolveLink('timeline', 'characters/furina/relationship.md', PAGES)).toBe(
      'characters/furina/timeline.md',
    );
  });
  it('路径形式（补 .md / 后缀匹配）与 md 链接（相对当前文件，再试根）', () => {
    expect(resolveLink('user/topics/苹果', 'user/profile.md', PAGES)).toBe('user/topics/苹果.md');
    expect(resolveLink('characters/furina/timeline', 'user/profile.md', PAGES)).toBe(
      'characters/furina/timeline.md',
    );
    expect(resolveLink('furina/timeline', 'user/profile.md', PAGES)).toBe(
      'characters/furina/timeline.md',
    );
    expect(resolveLink('王小明.md', 'user/people/Alice.md', PAGES, { markdown: true })).toBe(
      'user/people/王小明.md',
    );
    expect(resolveLink('../profile.md', 'user/people/Alice.md', PAGES, { markdown: true })).toBe(
      'user/profile.md',
    );
    expect(resolveLink('user/topics/爬山.md', 'user/profile.md', PAGES, { markdown: true })).toBe(
      'user/topics/爬山.md',
    );
  });
  it('memoryLinkName：同名人物 / 话题用路径形式；角色页永远路径形式', () => {
    expect(memoryLinkName('user/people/王小明.md', PAGES)).toBe('王小明');
    expect(memoryLinkName('user/topics/苹果.md', PAGES)).toBe('user/topics/苹果');
    expect(memoryLinkName('characters/furina/timeline.md', PAGES)).toBe(
      'characters/furina/timeline',
    );
  });
});

describe('㉒ normalizeLinks', () => {
  it('别名 / 标题 → [[文件名|原文]]；文件名链接不动', () => {
    const out = normalizeLinks('和[[小王]]、[[王工|老王]]、[[王小明]]、[[徒步#路线]]', PAGES, {
      dropUnresolved: true,
    });
    expect(out).toBe('和[[王小明|小王]]、[[王小明|老王]]、[[王小明]]、[[爬山#路线|徒步]]');
  });
  it('命中标题但同名人物 / 话题 → 路径形式', () => {
    const pages = [...PAGES, page('user/topics/Pomme.md', '法语苹果', [])];
    expect(normalizeLinks('[[法语苹果]]', pages, { dropUnresolved: true })).toBe(
      '[[Pomme|法语苹果]]',
    );
    const clash = [page('user/people/阿杰.md', '阿杰', []), page('user/topics/阿杰.md', '阿杰', [])];
    // 文件名直接命中（同名二者）→ 保持原样
    expect(normalizeLinks('[[阿杰]]', clash, { dropUnresolved: true })).toBe('[[阿杰]]');
    const byAlias = [...clash, page('user/topics/别处.md', '别处', ['杰哥'])];
    expect(normalizeLinks('[[杰哥]]', byAlias, { dropUnresolved: true })).toBe('[[别处|杰哥]]');
  });
  it('悬空：LLM 写入降为纯文本；用户保存保留', () => {
    const md = '去[[火星]]看[[外星人|ET]]，[[王小明]]同行';
    expect(normalizeLinks(md, PAGES, { dropUnresolved: true })).toBe('去火星看ET，[[王小明]]同行');
    expect(normalizeLinks(md, PAGES, { dropUnresolved: false })).toBe(md);
  });
  it('code 内不动；md 链接不动', () => {
    const md = '`[[小王]]` [档案](../profile.md)';
    expect(normalizeLinks(md, PAGES, { dropUnresolved: true })).toBe(md);
  });
});

describe('㉒ linkifyMentions', () => {
  it('每节首次出现补链；原文 = 文件名写 [[x]]，别名写 [[x|别名]]', () => {
    const md = '## 近况\n\n和王小明去爬山，王小明很累。\n\n## 杂项\n\n小王喜欢徒步';
    expect(linkifyMentions(md, PAGES)).toBe(
      '## 近况\n\n和[[王小明]]去[[爬山]]，王小明很累。\n\n## 杂项\n\n[[王小明|小王]]喜欢[[爬山|徒步]]',
    );
  });
  it('长词优先（王小明 先于 小明）', () => {
    const pages = [page('user/people/王小明.md', '王小明'), page('user/people/小明.md', '小明')];
    expect(linkifyMentions('王小明和小明', pages)).toBe('[[王小明]]和[[小明]]');
  });
  it('纯 ASCII 词需词边界、大小写不敏感；1 字名不补', () => {
    const pages = [page('user/people/Al.md', 'Al'), page('user/people/王.md', '王')];
    expect(linkifyMentions('Also al and AL', pages)).toBe('Also [[Al|al]] and AL');
    expect(linkifyMentions('王来了', pages)).toBe('王来了');
    expect(linkifyMentions('我和alice', PAGES)).toBe('我和[[Alice|alice]]');
  });
  it('跳过 code / 已有链接 / 锁定节 / 标题行 / 自身 / frontmatter；节内已链过则跳过', () => {
    const md = [
      '---',
      'title: 王小明',
      '---',
      '## 王小明',
      '',
      '`王小明` [[小王的事|王小明]] 爬山',
      '',
      '## 锁定',
      '',
      '<!-- locked -->',
      '王小明',
      '',
      '## 已链',
      '',
      '[[王小明|他]]，王小明',
    ].join('\n');
    const out = linkifyMentions(md, PAGES, { self: 'user/topics/爬山.md' });
    expect(out).toContain('title: 王小明\n---');
    expect(out).toContain('## 王小明\n\n`王小明` [[小王的事|王小明]] 爬山');
    expect(out).toContain('<!-- locked -->\n王小明');
    expect(out).toContain('[[王小明|他]]，王小明');
  });
  it('固定页不作目标；幂等', () => {
    const md = '用户档案里写了共同经历，也提到王小明和苹果';
    const once = linkifyMentions(md, PAGES);
    // 同名人物 / 话题：人物优先，且写路径形式
    expect(once).toBe('用户档案里写了共同经历，也提到[[王小明]]和[[user/people/苹果|苹果]]');
    expect(linkifyMentions(once, PAGES)).toBe(once);
  });
});

describe('㉒ rewriteLinkTarget', () => {
  it('保留 #节 / |显示 / ! 与写法（文件名 / 路径 / md 链接）', () => {
    const md =
      '[[王小明]] [[王小明#近况]] [[王小明|小王]] ![[王小明]] [[user/people/王小明|他]] [x](王小明.md) [[王小明明]]';
    expect(rewriteLinkTarget(md, 'user/people/王小明.md', 'user/people/王大明.md')).toBe(
      '[[王大明]] [[王大明#近况]] [[王大明|小王]] ![[王大明]] [[user/people/王大明|他]] [x](王大明.md) [[王小明明]]',
    );
  });
  it('自定义判定：同名话题页链接不受影响', () => {
    const md = '[[苹果]]';
    const out = rewriteLinkTarget(
      md,
      'user/people/苹果.md',
      'user/people/红苹果.md',
      (l) => resolveLink(l.target, 'user/topics/爬山.md', PAGES) === 'user/people/苹果.md',
    );
    expect(out).toBe(md);
  });
});

describe('㉒ toPlainText', () => {
  it('双链 / 嵌入 / md 链接 / 锁定标记投影成纯文本', () => {
    expect(
      toPlainText(
        '<!-- locked -->\n和[[王小明|小王]]去[[爬山#路线]]，![[苹果]]，[[characters/furina/timeline|共同经历]]，[[user/topics/苹果]]，[档案](../profile.md)',
      ),
    ).toBe('和小王去爬山，苹果，共同经历，苹果，档案');
  });
  it('无链接原样', () => {
    expect(toPlainText('普通文本 [外链](https://a.com)')).toBe('普通文本 [外链](https://a.com)');
  });
});

describe('㉒ 新 RPC 形状', () => {
  it('memory.graph / renamePage / probe 已注册且参数校验', () => {
    expect(Methods['memory.graph'].params.safeParse({ scope: 'all' }).success).toBe(true);
    expect(Methods['memory.graph'].params.safeParse({ scope: 'x' }).success).toBe(false);
    expect(
      Methods['memory.renamePage'].params.safeParse({ path: 'user/people/王.md', title: '王五' })
        .success,
    ).toBe(true);
    expect(
      Methods['memory.renamePage'].params.safeParse({ path: '../x.md', title: '王五' }).success,
    ).toBe(false);
    expect(Methods['memory.probe'].params.safeParse({ text: 'a'.repeat(501) }).success).toBe(false);
    expect(
      Methods['memory.probe'].result.safeParse({
        resident: [{ title: '用户档案', chars: 10 }],
        pages: [{ path: 'user/people/王.md', title: '王', via: 'vector', score: 0.8, chars: 20 }],
        injectedChars: 30,
        budget: 2500,
        preview: '## 记忆',
      }).success,
    ).toBe(true);
  });
});
