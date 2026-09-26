import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { MemoryOp, Prefs } from '@openpet/protocol';
import { MEMORY_QUOTAS } from '@openpet/protocol';
import { MemoryStore } from '../electron/main/db/index.js';
import { assembleContext } from '../electron/main/context-assembler.js';
import { createMemoryService, TIMELINE_UNIT_TITLE } from '../electron/main/memory-service.js';
import { MemoryWiki } from '../electron/main/memory-wiki.js';

const cleanups: string[] = [];
afterEach(() => {
  for (const p of cleanups.splice(0)) rmSync(p, { recursive: true, force: true });
});

/**
 * 确定性向量：文本含「猫」或「喵」→ [1,0]，否则 [0,1]（「喵」让向量路命中而 BM25 不中）；
 * 无 embedding 场景用 throwEmbed。
 */
const embed = async (inputs: string[]): Promise<number[][]> =>
  inputs.map((t) => (/[猫喵]/.test(t) ? [1, 0] : [0, 1]));
const throwEmbed = async (): Promise<number[][]> => {
  throw new Error('no embedding');
};

function make(
  opts: {
    ltm?: boolean;
    embed?: typeof embed;
    cid?: string;
    key?: string;
    minScore?: number;
  } = {},
) {
  const dir = mkdtempSync(path.join(tmpdir(), 'ds-msvc-'));
  cleanups.push(dir);
  const store = new MemoryStore();
  const wiki = new MemoryWiki(dir, { now: () => Date.UTC(2026, 8, 22, 12) });
  const cid = opts.cid ?? 'default';
  wiki.ensureLayout(cid);
  const svc = createMemoryService({
    store,
    wiki,
    embed: opts.embed ?? embed,
    getPrefs: () =>
      ({
        'privacy.longTermMemory': opts.ltm ?? true,
        'memory.recallMinScore': opts.minScore ?? 0.25,
      }) as unknown as Prefs,
    character: () => ({ id: cid }),
    embedModelKey: () => opts.key ?? 'src|m1',
  });
  return { store, wiki, svc, cid };
}

const topic = (title: string, content: string, aliases: string[] = []): MemoryOp => ({
  op: 'create_page',
  kind: 'topics',
  title,
  aliases,
  tags: [],
  content,
});
const person = (title: string, content: string, aliases: string[] = []): MemoryOp => ({
  op: 'create_page',
  kind: 'people',
  title,
  aliases,
  tags: [],
  content,
});

describe('⑲ memory-service 常驻 + 名字路', () => {
  it('路 1 常驻：profile 一句话档案 + relationship + timeline 最近 3 条；开关关 → 空', async () => {
    const { wiki, svc, cid } = make();
    wiki.applyOps(
      [
        {
          op: 'upsert_section',
          page: 'user/profile.md',
          section: '一句话档案',
          content: '深圳前端，养猫',
        },
        {
          op: 'upsert_section',
          page: `characters/${cid}/relationship.md`,
          section: '称呼',
          content: '叫我阿芙',
        },
        { op: 'append_timeline', date: '2026-09-01', text: '第一天' },
        { op: 'append_timeline', date: '2026-09-02', text: '第二天' },
        { op: 'append_timeline', date: '2026-09-03', text: '第三天' },
      ],
      cid,
    );
    wiki.applyOps([{ op: 'append_timeline', date: '2026-09-04', text: '第四天' }], cid);
    const r = await svc.retrieveForChat('随便聊聊');
    expect(r.resident).toHaveLength(3);
    expect(r.resident[0]).toContain('深圳前端');
    expect(r.resident[1]).toContain('叫我阿芙');
    expect(r.resident[2]).toContain('第四天');
    expect(r.resident[2]).not.toContain('第一天');
    expect(r.stats.resident).toBe(3);

    const off = make({ ltm: false });
    off.wiki.applyOps(
      [{ op: 'upsert_section', page: 'user/profile.md', section: '一句话档案', content: 'x' }],
      off.cid,
    );
    expect(await off.svc.retrieveForChat('x')).toMatchObject({ resident: [], pages: [] });
  });

  it('路 2 名字：history 或当前输入命中 title / 别名 → 整页（via keyword）；不命中 → 无', async () => {
    const { wiki, svc, cid } = make({ embed: throwEmbed });
    wiki.applyOps([person('小明', '用户的同事', ['明哥'])], cid);
    const hit = await svc.retrieveForChat('明哥最近怎么样');
    expect(hit.pages).toEqual([
      { path: 'user/people/小明.md', title: '小明', body: '用户的同事', via: 'keyword' },
    ]);
    expect(hit.stats.keyword).toBe(1);
    const viaHistory = await svc.retrieveForChat('他呢', ['昨天小明来了']);
    expect(viaHistory.pages).toHaveLength(1);
    const miss = await svc.retrieveForChat('天气如何');
    expect(miss.pages).toEqual([]);
  });

  it('预算截断顺序：常驻 > 名字 > 块混合；总字数 ≤ 2500', async () => {
    const { wiki, svc, cid } = make({ embed: throwEmbed });
    wiki.applyOps(
      [
        {
          op: 'upsert_section',
          page: 'user/profile.md',
          section: '一句话档案',
          content: 'A'.repeat(600),
        },
        {
          op: 'upsert_section',
          page: `characters/${cid}/relationship.md`,
          section: '约定',
          content: 'B'.repeat(390),
        },
        topic('甲', 'C'.repeat(1900), ['甲']),
        topic('乙', 'D'.repeat(1900), ['乙']),
      ],
      cid,
    );
    const r = await svc.retrieveForChat('甲 乙');
    expect(r.resident).toHaveLength(2);
    expect(r.resident[0]!.length).toBeGreaterThanOrEqual(600);
    expect(r.stats.chars).toBeLessThanOrEqual(MEMORY_QUOTAS.injectBudgetChars + 20);
    expect(r.pages.length).toBeGreaterThanOrEqual(1);
    const total = r.resident.join('').length + r.pages.reduce((n, p) => n + p.body.length, 0);
    expect(total).toBeLessThanOrEqual(MEMORY_QUOTAS.injectBudgetChars + 20);
  });

  it('兼容 RPC：add 写杂项节 / list 行视图 / clear 清 wiki + 旧表 + 索引；wiki RPC：tree/read/write/delete/search', async () => {
    const { store, wiki, svc, cid } = make({ embed: throwEmbed });
    store.memoryInsert(cid, '旧事实', [], 1);
    await svc['memory.add']({ text: '用户养了只猫' });
    const list = await svc['memory.list']();
    expect(list.facts.map((f) => f.text)).toEqual(['杂项：- 用户养了只猫']);
    expect(wiki.readPage('user/profile.md')!.frontmatter.source).toBe('user');

    const tree = await svc['memory.tree']();
    expect(tree.profile.path).toBe('user/profile.md');
    expect(tree.relationship.path).toBe(`characters/${cid}/relationship.md`);
    const page = await svc['memory.readPage']({ path: 'user/profile.md' });
    expect(page.raw).toContain('---\ntitle:');
    await svc['memory.writePage']({
      path: 'user/topics/openpet.md',
      content: '---\ntitle: openpet\nkeys: ["桌宠"]\n---\n\n桌面伙伴项目',
    });
    expect((await svc['memory.search']({ q: '桌宠' })).hits[0]?.path).toBe(
      'user/topics/openpet.md',
    );
    await expect(
      svc['memory.writePage']({ path: 'characters/other/relationship.md', content: 'x' }),
    ).rejects.toThrow();
    await expect(svc['memory.readPage']({ path: 'user/topics/nope.md' })).rejects.toThrow();
    await svc['memory.deletePage']({ path: 'user/topics/openpet.md' });
    expect((await svc['memory.tree']()).topics).toEqual([]);

    store.chunkIndexUpsert(
      [
        {
          id: 'user/topics/x.md#page',
          path: 'user/topics/x.md',
          hash: 'h',
          model: 'm',
          vector: [1],
        },
      ],
      1,
    );
    await svc['memory.clear']();
    expect(store.memoryCount(cid)).toBe(0);
    expect(store.chunkIndexList()).toEqual([]);
    expect((await svc['memory.list']()).facts).toEqual([]);
    expect(wiki.readPage('user/profile.md')).not.toBeNull(); // 骨架重建
  });
});

describe('㉔ 块级混合检索（spec §3）', () => {
  function seedTimeline(wiki: MemoryWiki, cid: string): void {
    wiki.applyOps(
      [
        {
          op: 'append_timeline',
          date: '2026-03-01',
          text: '我们第一次一起去爬山，ta 爬到一半就累了',
        },
        { op: 'append_timeline', date: '2026-04-01', text: '聊到了 ta 的新工作' },
        { op: 'append_timeline', date: '2026-09-18', text: '最近一' },
        { op: 'append_timeline', date: '2026-09-19', text: '最近二' },
        { op: 'append_timeline', date: '2026-09-20', text: '最近三' },
      ],
      cid,
    );
  }

  it('档案「一句话档案」以外的节与更早的经历能被想起（纯 BM25，无 embedding）', async () => {
    const { wiki, svc, cid } = make({ embed: throwEmbed });
    wiki.applyOps(
      [
        {
          op: 'upsert_section',
          page: 'user/profile.md',
          section: '喜好厌恶',
          content: '不吃香菜，喜欢辣',
        },
        { op: 'upsert_section', page: 'user/profile.md', section: '习惯作息', content: '晚睡' },
      ],
      cid,
    );
    seedTimeline(wiki, cid);
    const r = await svc.retrieveForChat('我讨厌香菜');
    expect(r.pages).toEqual([
      {
        path: 'user/profile.md',
        title: '用户档案 · 喜好厌恶',
        body: '不吃香菜，喜欢辣',
        via: 'text',
      },
    ]);
    const tl = await svc.retrieveForChat('还想去爬山');
    expect(tl.pages).toEqual([
      {
        path: `characters/${cid}/timeline.md`,
        title: TIMELINE_UNIT_TITLE,
        body: '- 2026-03-01 我们第一次一起去爬山，ta 爬到一半就累了',
        via: 'text',
      },
    ]);
    expect(tl.stats.text).toBe(1);
    // 常驻的最近 3 条不出块
    expect((await svc.retrieveForChat('最近一')).pages).toEqual([]);
  });

  it('名字路命中的页不再被块路重复；块路补上别的页（向量），路线标记', async () => {
    const { wiki, svc, cid } = make();
    wiki.applyOps(
      [
        person('年糕', '橘猫，爱睡觉'),
        topic('猫粮', '猫吃的', ['猫粮']),
        topic('工作', '写代码', ['上班']),
      ],
      cid,
    );
    await svc.reindexVectors();
    // 名字命中「猫粮」；块路补「年糕」（「猫」字与向量都中 = hybrid），「猫粮」不重复
    const r = await svc.retrieveForChat('猫粮买了吗');
    expect(r.pages.map((p) => [p.title, p.via])).toEqual([
      ['猫粮', 'keyword'],
      ['年糕', 'hybrid'],
    ]);
    expect(r.pages[1]!.score).toBeCloseTo(1);
    expect(r.stats).toMatchObject({ keyword: 1, vector: 0, text: 0, hybrid: 1 });
    // 只有向量中（字面不重合）= vector
    const v = await svc.retrieveForChat('喵星人');
    expect(v.pages.find((p) => p.title === '年糕')?.via).toBe('vector');
  });

  it('两路都中 = hybrid；无关输入 / 无实词输入只剩常驻', async () => {
    const { wiki, svc, cid } = make();
    wiki.applyOps(
      [
        person('年糕', '橘猫，爱睡觉'),
        topic('工作', '写代码'),
        topic('读书', '在读三体'),
        topic('跑步', '每周三次'),
        topic('做饭', '会做红烧肉'),
      ],
      cid,
    );
    await svc.reindexVectors();
    const r = await svc.retrieveForChat('橘猫今天睡了一天');
    expect(r.pages.map((p) => [p.title, p.via])).toEqual([['年糕', 'hybrid']]);
    expect((await svc.retrieveForChat('今天天气不错')).pages).toEqual([]);
    expect((await svc.retrieveForChat('是吗？')).pages).toEqual([]);
  });

  it('相似度门：块数 ≥ 5 时取 max(最低分, 中位数 + 0.12)——整体偏高的相似度不放行', async () => {
    // 所有块与查询都「挺像」（0.8 上下）：中位数 + 0.12 以上才算明显相关
    const flat = async (inputs: string[]): Promise<number[][]> =>
      inputs.map((t) => (t.includes('猫') ? [1, 0.3] : [1, 0.6]));
    const { wiki, svc, cid } = make({ embed: flat });
    wiki.applyOps(
      [
        person('年糕', '橘猫'),
        topic('工作', '写代码'),
        topic('读书', '三体'),
        topic('跑步', '每周'),
        topic('做饭', '红烧肉'),
      ],
      cid,
    );
    await svc.reindexVectors();
    const r = await svc.retrieveForChat('聊聊我家那位');
    expect(r.pages).toEqual([]); // 全部 0.95–0.99 左右，中位数 + 0.12 > 1
    const loose = make({ embed: flat, minScore: 0 });
    loose.wiki.applyOps([person('年糕', '橘猫')], loose.cid);
    await loose.svc.reindexVectors();
    // 块数 < 5：门 = 最低分 + 0.12 = 0.12 → 放行
    expect((await loose.svc.retrieveForChat('聊聊我家那位')).pages.map((p) => p.title)).toEqual([
      '年糕',
    ]);
  });

  it('块混合最多 3 个单元；更早的经历合并成一个单元并算一个', async () => {
    const { wiki, svc, cid } = make({ embed: throwEmbed });
    wiki.applyOps(
      [topic('爬山装备', '登山杖'), topic('爬山路线', '香山'), person('驴友老张', '一起爬山')],
      cid,
    );
    wiki.applyOps(
      [
        { op: 'append_timeline', date: '2026-02-01', text: '第一次爬山' },
        { op: 'append_timeline', date: '2026-02-02', text: '第二次爬山' },
        { op: 'append_timeline', date: '2026-09-18', text: 'a' },
        { op: 'append_timeline', date: '2026-09-19', text: 'b' },
        { op: 'append_timeline', date: '2026-09-20', text: 'c' },
      ],
      cid,
    );
    const r = await svc.retrieveForChat('周末爬山');
    expect(r.pages).toHaveLength(MEMORY_QUOTAS.recallUnits);
    const tl = r.pages.find((p) => p.title === TIMELINE_UNIT_TITLE);
    if (tl) expect(tl.body).toBe('- 2026-02-02 第二次爬山\n- 2026-02-01 第一次爬山');
  });

  it('被想起只记人物 / 话题（档案节 / 经历单元不记）', async () => {
    const { store, wiki, svc, cid } = make({ embed: throwEmbed });
    wiki.applyOps(
      [
        { op: 'upsert_section', page: 'user/profile.md', section: '喜好厌恶', content: '不吃香菜' },
        topic('香菜', '一种香料'),
      ],
      cid,
    );
    await svc.retrieveForChat('香菜');
    expect(store.pageStatsList().map((r) => r.path)).toEqual(['user/topics/香菜.md']);
  });
});

describe('㉔ 块向量索引（spec §3.3）', () => {
  it('每批 10 条逐批落库；中途失败已算的不丢；未配置嵌入模型直接跳过', async () => {
    const batches: number[] = [];
    let failAt = -1;
    const counting = async (inputs: string[]): Promise<number[][]> => {
      batches.push(inputs.length);
      if (batches.length === failAt) throw new Error('boom');
      return inputs.map(() => [1, 0]);
    };
    const { store, wiki, svc, cid } = make({ embed: counting });
    wiki.applyOps(
      Array.from({ length: 5 }, (_, i) => topic(`话题${i}`, `内容${i}`)),
      cid,
    );
    wiki.applyOps(
      Array.from({ length: 5 }, (_, i) => person(`人物${i}`, `内容${i}`)),
      cid,
    );
    wiki.applyOps(
      Array.from({ length: 5 }, (_, i) => topic(`话题${i + 5}`, `内容${i + 5}`)),
      cid,
    );
    wiki.applyOps(
      Array.from({ length: 5 }, (_, i) => topic(`话题${i + 10}`, `内容${i + 10}`)),
      cid,
    );
    wiki.applyOps(
      [topic('话题99', '内容99'), topic('话题98', '内容98'), topic('话题97', '内容97')],
      cid,
    );
    failAt = 2;
    await svc.reindexVectors();
    expect(batches).toEqual([10, 10]);
    expect(store.chunkIndexList()).toHaveLength(10); // 第一批已落库
    batches.length = 0;
    failAt = -1;
    await svc.reindexVectors(); // 增量：只补没算的 13 块
    expect(batches).toEqual([10, 3]);
    expect(store.chunkIndexList()).toHaveLength(23);
    batches.length = 0;
    await svc.reindexVectors();
    expect(batches).toEqual([]); // 全部最新

    const noKey = make({ embed: counting, key: '' });
    noKey.wiki.applyOps([topic('甲', '乙')], noKey.cid);
    batches.length = 0;
    await noKey.svc.reindexVectors();
    expect(batches).toEqual([]);
    expect(noKey.store.chunkIndexList()).toEqual([]); // 不写空指纹行
  });

  it('删行只删当前角色可见范围：他角色的经历块向量保留；死块删除', async () => {
    const { store, wiki, svc, cid } = make();
    wiki.applyOps([topic('甲', '内容')], cid);
    const other = {
      id: 'characters/other/timeline.md#2026-01-01#abcd1234',
      path: 'characters/other/timeline.md',
      hash: 'h',
      model: 'src|m1',
      vector: [1, 0],
    };
    const dead = { ...other, id: 'user/topics/已删.md#page', path: 'user/topics/已删.md' };
    store.chunkIndexUpsert([other, dead], 1);
    await svc.reindexVectors();
    const ids = store.chunkIndexList().map((r) => r.id);
    expect(ids).toContain(other.id);
    expect(ids).not.toContain(dead.id);
    expect(ids).toContain('user/topics/甲.md#page');
  });

  it('写入带指纹；换模型后旧行不参与检索并触发后台全量重算', async () => {
    const key = { v: 'src|m1' };
    const dir = mkdtempSync(path.join(tmpdir(), 'ds-msvc-'));
    cleanups.push(dir);
    const store = new MemoryStore();
    const wiki = new MemoryWiki(dir, { now: () => Date.UTC(2026, 8, 22, 12) });
    wiki.ensureLayout('default');
    const svc = createMemoryService({
      store,
      wiki,
      embed,
      getPrefs: () => ({ 'privacy.longTermMemory': true }) as unknown as Prefs,
      character: () => ({ id: 'default' }),
      embedModelKey: () => key.v,
    });
    wiki.applyOps([person('年糕', '橘猫'), topic('工作', '写代码', ['上班'])], 'default');
    await svc.reindexVectors();
    expect(new Set(store.chunkIndexList().map((r) => r.model))).toEqual(new Set(['src|m1']));
    expect((await svc.retrieveForChat('我家的小猫呢')).pages.map((p) => p.title)).toContain('年糕');
    key.v = 'src|m2'; // 同维度不同模型：也判不一致
    const r = await svc.retrieveForChat('我家的小猫呢');
    expect(r.pages.filter((p) => p.via === 'vector' || p.via === 'hybrid')).toEqual([]);
    const flush = () => new Promise((res) => setTimeout(res, 0));
    await flush();
    await flush();
    expect(new Set(store.chunkIndexList().map((x) => x.model))).toEqual(new Set(['src|m2']));
    expect((await svc.retrieveForChat('我家的小猫呢')).pages.map((p) => p.title)).toContain('年糕');
  });

  it('内容变了（hash 不一致）的旧向量行不参与检索', async () => {
    const { store, wiki, svc, cid } = make();
    wiki.applyOps([person('年糕', '橘猫')], cid);
    await svc.reindexVectors();
    const row = store.chunkIndexList()[0]!;
    store.chunkIndexUpsert([{ ...row, hash: 'stale' }], 2);
    expect((await svc.retrieveForChat('我家的小猫呢')).pages).toEqual([]);
  });
});

describe('㉔ recall（recall_memory 工具执行体）', () => {
  it('名字路 + 块混合，单元上限与总字数上限；纯文本无 [[；record 才记被想起', async () => {
    const { store, wiki, svc, cid } = make({ embed: throwEmbed });
    wiki.applyOps([person('王小明', '大学室友，常去爬山', ['小王'])], cid);
    wiki.applyOps(
      [
        topic('爬山', '和[[王小明]]去香山'),
        { op: 'upsert_section', page: 'user/profile.md', section: '喜好厌恶', content: '喜欢爬山' },
      ],
      cid,
    );
    const units = await svc.recall('小王 爬山');
    expect(units.map((u) => [u.title, u.via])).toEqual([
      ['王小明', 'keyword'],
      ['爬山', 'keyword'],
      ['用户档案 · 喜好厌恶', 'text'],
    ]);
    expect(units.map((u) => u.body).join('\n')).not.toContain('[[');
    expect(store.pageStatsList()).toEqual([]);
    const capped = await svc.recall('小王 爬山', { units: 2, chars: 20, record: true });
    expect(capped.length).toBeLessThanOrEqual(2);
    expect(capped.reduce((n, u) => n + u.title.length + u.body.length + 5, 0)).toBeLessThanOrEqual(
      20 + 5 + 3,
    );
    expect(store.pageStatsList().map((r) => r.path)).toContain('user/people/王小明.md');
    expect(await svc.recall('哈哈')).toEqual([]);
  });

  it('relatedPagePaths：块排名映射回人物 / 话题页（无门，档案 / 经历不算）', async () => {
    const { wiki, svc, cid } = make({ embed: throwEmbed });
    wiki.applyOps(
      [
        topic('爬山', '香山'),
        { op: 'upsert_section', page: 'user/profile.md', section: '喜好厌恶', content: '喜欢爬山' },
      ],
      cid,
    );
    expect(await svc.relatedPagePaths(cid, '周末爬山')).toEqual(['user/topics/爬山.md']);
  });
});

describe('㉒ 图谱 / 被想起 / 来源 / 试一句', () => {
  it('㉒ 注入产物无 [[：常驻 / 名字 / 块混合都是纯文本投影', async () => {
    const { wiki, svc, cid } = make();
    wiki.applyOps([person('王小明', '大学室友，养猫', ['小王']), topic('爬山', '和小王去')], cid);
    wiki.applyOps(
      [
        {
          op: 'upsert_section',
          page: 'user/profile.md',
          section: '一句话档案',
          content: '朋友王小明，爱爬山',
        },
        { op: 'append_timeline', date: '2026-09-20', text: '聊到[[小王]]的猫' },
      ],
      cid,
    );
    expect(wiki.readRaw('user/profile.md')).toContain('[[王小明]]');
    await svc.reindexVectors();
    const r = await svc.retrieveForChat('小王和爬山，还有猫');
    expect(r.pages.length).toBeGreaterThan(0);
    const all = [...r.resident, ...r.pages.map((p) => `${p.title}\n${p.body}`)].join('\n');
    expect(all).not.toContain('[[');
    expect(all).toContain('朋友王小明');
    expect(all).toContain('聊到小王的猫');
  });

  it('㉒ memory.graph / memory.renamePage：图含可读名；重命名删旧块向量、重算新路径、通知变更', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ds-msvc-'));
    cleanups.push(dir);
    const store = new MemoryStore();
    const wiki = new MemoryWiki(dir, { now: () => Date.UTC(2026, 8, 22, 12) });
    wiki.ensureLayout('default');
    const changed: string[][] = [];
    const svc = createMemoryService({
      store,
      wiki,
      embed,
      getPrefs: () => ({ 'privacy.longTermMemory': true }) as unknown as Prefs,
      character: () => ({ id: 'default' }),
      characterName: () => '阿芙',
      onChanged: (p) => changed.push(p),
      embedModelKey: () => 'src|m1',
    });
    wiki.applyOps([person('王小明', '猫奴'), topic('爬山', '和王小明')], 'default');
    await svc.reindexVectors();
    const g = await svc['memory.graph']({ scope: 'current' });
    expect(g.nodes.find((n) => n.kind === 'relationship')!.title).toBe('阿芙 · 关系');
    expect(g.edges.some((e) => e.target === 'user/people/王小明.md' && e.kind === 'link')).toBe(
      true,
    );
    const r = await svc['memory.renamePage']({ path: 'user/people/王小明.md', title: '王大明' });
    expect(r).toEqual({ ok: true, path: 'user/people/王大明.md' });
    expect(changed).toEqual([['user/people/王大明.md', 'user/topics/爬山.md']]);
    await new Promise((res) => setTimeout(res, 0));
    const paths = store.chunkIndexList().map((x) => x.path);
    expect(paths).not.toContain('user/people/王小明.md');
    expect(paths).toContain('user/people/王大明.md');
  });

  it('被想起：只记真正注入的人物 / 话题页；常驻页不记；probe 不记；重命名迁移；删页删行；清空清表', async () => {
    let t = 1000;
    const dir = mkdtempSync(path.join(tmpdir(), 'ds-msvc-'));
    cleanups.push(dir);
    const store = new MemoryStore();
    const wiki = new MemoryWiki(dir, { now: () => Date.UTC(2026, 8, 22, 12) });
    wiki.ensureLayout('default');
    const svc = createMemoryService({
      store,
      wiki,
      embed: throwEmbed,
      getPrefs: () => ({ 'privacy.longTermMemory': true }) as unknown as Prefs,
      character: () => ({ id: 'default' }),
      now: () => ++t,
    });
    wiki.applyOps([person('年糕', '橘猫'), topic('工作', '写代码', ['上班'])], 'default');
    wiki.applyOps(
      [{ op: 'upsert_section', page: 'user/profile.md', section: '一句话档案', content: '程序员' }],
      'default',
    );
    await svc.retrieveForChat('上班好累');
    await svc.retrieveForChat('又要上班');
    await svc['memory.probe']({ text: '上班' });
    expect(store.pageStatsList()).toEqual([
      { path: 'user/topics/工作.md', count: 2, lastAt: 1002 },
    ]);
    const g = await svc['memory.graph']({ scope: 'current' });
    expect(g.nodes.find((n) => n.id === 'user/topics/工作.md')!.recall).toEqual({
      count: 2,
      lastAt: 1002,
    });
    expect(g.nodes.find((n) => n.id === 'user/profile.md')!.recall).toBeUndefined();
    await svc['memory.renamePage']({ path: 'user/topics/工作.md', title: '职场' });
    expect(store.pageStatsList().map((x) => [x.path, x.count])).toEqual([
      ['user/topics/职场.md', 2],
    ]);
    await svc['memory.deletePage']({ path: 'user/topics/职场.md' });
    expect(store.pageStatsList()).toEqual([]);
    await svc.retrieveForChat('年糕呢');
    expect(store.pageStatsList()).toHaveLength(1);
    await svc['memory.clear']();
    expect(store.pageStatsList()).toEqual([]);
  });

  it('㉔ 来源日志随页走：重命名迁移路径、删页删日志；清空记忆连带清便签与日志', async () => {
    const { store, wiki, svc, cid } = make({ embed: throwEmbed });
    wiki.applyOps([topic('工作', '写代码', ['上班'])], cid);
    const row = (p: string) => ({
      at: 1,
      characterId: cid,
      sessionId: 's1',
      msgFrom: 0,
      msgTo: 4,
      path: p,
      op: 'upsert_section',
      detail: 'x',
    });
    store.opLogAdd([row('user/topics/工作.md'), row('user/profile.md')]);
    await svc['memory.renamePage']({ path: 'user/topics/工作.md', title: '职场' });
    expect(store.opLogForPath('user/topics/工作.md', 10)).toEqual([]);
    expect(store.opLogForPath('user/topics/职场.md', 10)).toHaveLength(1);
    await svc['memory.deletePage']({ path: 'user/topics/职场.md' });
    expect(store.opLogForPath('user/topics/职场.md', 10)).toEqual([]);
    store.memoryNoteAdd(cid, 's1', '记住', 1);
    await svc['memory.clear']();
    expect(store.opLogForPath('user/profile.md', 10)).toEqual([]);
    expect(store.memoryNotes(cid, 's1')).toEqual([]);
  });

  it('memory.probe：命中结构 + 预算 + 注入原文与组装链记忆块逐字一致', async () => {
    const { store, wiki, svc, cid } = make();
    wiki.applyOps([person('年糕', '橘猫'), topic('工作', '写代码', ['上班'])], cid);
    wiki.applyOps(
      [
        {
          op: 'upsert_section',
          page: 'user/profile.md',
          section: '一句话档案',
          content: '程序员，和[[年糕]]住',
        },
      ],
      cid,
    );
    await svc.reindexVectors();
    const probe = await svc['memory.probe']({ text: '上班路上想起猫' });
    expect(probe.resident).toEqual([{ title: '用户档案', chars: expect.any(Number) }]);
    expect(probe.pages.map((p) => [p.path, p.via])).toEqual([
      ['user/topics/工作.md', 'keyword'],
      ['user/people/年糕.md', 'hybrid'],
    ]);
    expect(probe.pages[1]!.score).toBeCloseTo(1);
    expect(probe.budget).toBe(MEMORY_QUOTAS.injectBudgetChars);
    expect(probe.preview).not.toContain('[[');
    const r = await svc.retrieveForChat('上班路上想起猫');
    const req = assembleContext({
      store,
      character: { id: cid, name: '阿芙' },
      sessionId: 's',
      userText: 'x',
      memory: r,
    });
    expect(req.messages[0]!.content).toContain(`\n\n${probe.preview}`);
    expect(probe.preview).toContain('与当前对话冲突时以当前为准');
    expect(probe.injectedChars).toBe(r.stats.chars);
  });
});

describe('㉔ 试一句预览随缓存友好布局', () => {
  it('开 = 常驻块 + 相关记忆块（与组装链前缀 / 句尾逐字一致）；关 = 旧合并块', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ds-msvc-'));
    cleanups.push(dir);
    const store = new MemoryStore();
    const wiki = new MemoryWiki(dir, { now: () => Date.UTC(2026, 8, 22, 12) });
    wiki.ensureLayout('default');
    let on = true;
    const svc = createMemoryService({
      store,
      wiki,
      embed: throwEmbed,
      getPrefs: () =>
        ({ 'privacy.longTermMemory': true, 'chat.cacheFriendlyContext': on }) as unknown as Prefs,
      character: () => ({ id: 'default' }),
    });
    wiki.applyOps(
      [
        { op: 'upsert_section', page: 'user/profile.md', section: '一句话档案', content: '程序员' },
        topic('工作', '写代码', ['上班']),
      ],
      'default',
    );
    const probe = await svc['memory.probe']({ text: '上班好累' });
    const [resident, recall] = probe.preview.split('\n\n## 相关记忆');
    expect(resident).toMatch(/^## 记忆（关于用户与我们的过往/);
    expect(resident).not.toContain('写代码');
    expect(`## 相关记忆${recall}`).toContain('### 工作\n写代码');
    const r = await svc.retrieveForChat('上班好累');
    const req = assembleContext({
      store,
      character: { id: 'default', name: '阿芙' },
      sessionId: 's',
      userText: 'x',
      memory: r,
      cacheFriendly: true,
    });
    expect(req.messages[0]!.content).toContain(`\n\n${resident}`);
    expect(req.messages.at(-2)!.content).toContain(`## 相关记忆${recall}`);
    on = false;
    const old = await svc['memory.probe']({ text: '上班好累' });
    expect(old.preview).not.toContain('## 相关记忆');
    expect(old.preview).toContain('程序员\n\n### 工作\n写代码');
  });
});
