import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Prefs } from '@openpet/protocol';
import { MEMORY_QUOTAS } from '@openpet/protocol';
import { MemoryStore } from '../electron/main/db/index.js';
import { createMemoryService } from '../electron/main/memory-service.js';
import { MemoryWiki } from '../electron/main/memory-wiki.js';

const cleanups: string[] = [];
afterEach(() => {
  for (const p of cleanups.splice(0)) rmSync(p, { recursive: true, force: true });
});

/** 确定性向量：文本含「猫」→ [1,0]，否则 [0,1]；无 embedding 场景用 throwEmbed。 */
const embed = async (inputs: string[]): Promise<number[][]> =>
  inputs.map((t) => (t.includes('猫') ? [1, 0] : [0, 1]));
const throwEmbed = async (): Promise<number[][]> => {
  throw new Error('no embedding');
};

function make(opts: { ltm?: boolean; embed?: typeof embed; cid?: string } = {}) {
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
    getPrefs: () => ({ 'privacy.longTermMemory': opts.ltm ?? true }) as unknown as Prefs,
    character: () => ({ id: cid }),
  });
  return { store, wiki, svc, cid };
}

describe('⑲ memory-service 三路注入', () => {
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

  it('路 2 关键词：history 或当前输入命中 keys/title → 页注入（via keyword）；不命中 → 无', async () => {
    const { wiki, svc, cid } = make({ embed: throwEmbed });
    wiki.applyOps(
      [
        {
          op: 'create_page',
          kind: 'people',
          title: '小明',
          aliases: ['明哥'],
          tags: [],
          content: '用户的同事',
        },
      ],
      cid,
    );
    const hit = await svc.retrieveForChat('明哥最近怎么样');
    expect(hit.pages).toEqual([{ title: '小明', body: '用户的同事', via: 'keyword' }]);
    expect(hit.stats.keyword).toBe(1);
    const viaHistory = await svc.retrieveForChat('他呢', ['昨天小明来了']);
    expect(viaHistory.pages).toHaveLength(1);
    const miss = await svc.retrieveForChat('天气如何');
    expect(miss.pages).toEqual([]);
  });

  it('路 3 向量兜底：关键词不命中但向量相近 → 2 页；已命中页不重复；无 embedding 静默', async () => {
    const { wiki, svc, cid } = make();
    wiki.applyOps(
      [
        {
          op: 'create_page',
          kind: 'people',
          title: '年糕',
          aliases: [],
          tags: [],
          content: '橘猫，爱睡觉',
        },
        {
          op: 'create_page',
          kind: 'topics',
          title: '猫粮',
          aliases: ['猫粮'],
          tags: [],
          content: '猫吃的',
        },
        {
          op: 'create_page',
          kind: 'topics',
          title: '工作',
          aliases: ['上班'],
          tags: [],
          content: '写代码',
        },
      ],
      cid,
    );
    await svc.reindexVectors();
    const r = await svc.retrieveForChat('猫粮买了吗'); // 关键词命中「猫粮」；向量补「年糕」（猫）但排除猫粮
    expect(r.pages.map((p) => [p.title, p.via])).toEqual([
      ['猫粮', 'keyword'],
      ['年糕', 'vector'],
    ]);
    expect(r.stats.vector).toBe(1);
    const only = await svc.retrieveForChat('我家猫呢');
    expect(only.pages.map((p) => p.title)).toEqual(['年糕', '猫粮']); // 向量 top2（工作向量 [0,1] 排后）
    expect(only.pages.length).toBeLessThanOrEqual(MEMORY_QUOTAS.vectorPages);

    const noEmb = make({ embed: throwEmbed });
    noEmb.wiki.applyOps(
      [{ op: 'create_page', kind: 'topics', title: 'A', aliases: [], tags: [], content: '猫' }],
      noEmb.cid,
    );
    await noEmb.svc.reindexVectors();
    expect((await noEmb.svc.retrieveForChat('猫')).pages).toEqual([]);
  });

  it('预算截断顺序：常驻 > 关键词 > 向量；总字数 ≤ 2500', async () => {
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
        {
          op: 'create_page',
          kind: 'topics',
          title: '甲',
          aliases: ['甲'],
          tags: [],
          content: 'C'.repeat(1900),
        },
        {
          op: 'create_page',
          kind: 'topics',
          title: '乙',
          aliases: ['乙'],
          tags: [],
          content: 'D'.repeat(1900),
        },
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

    await svc['memory.clear']();
    expect(store.memoryCount(cid)).toBe(0);
    expect((await svc['memory.list']()).facts).toEqual([]);
    expect(wiki.readPage('user/profile.md')).not.toBeNull(); // 骨架重建
  });

  it('㉒ 注入产物无 [[：常驻 / 关键词 / 向量三路都是纯文本投影', async () => {
    const { wiki, svc, cid } = make();
    wiki.applyOps(
      [
        {
          op: 'create_page',
          kind: 'people',
          title: '王小明',
          aliases: ['小王'],
          tags: [],
          content: '大学室友，养猫',
        },
        { op: 'create_page', kind: 'topics', title: '爬山', aliases: [], tags: [], content: '和小王去' },
      ],
      cid,
    );
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

  it('㉒ memory.graph / memory.renamePage：图含可读名；重命名删旧向量行、重算新路径、通知变更', async () => {
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
    });
    wiki.applyOps(
      [
        { op: 'create_page', kind: 'people', title: '王小明', aliases: [], tags: [], content: '猫奴' },
        { op: 'create_page', kind: 'topics', title: '爬山', aliases: [], tags: [], content: '和王小明' },
      ],
      'default',
    );
    await svc.reindexVectors();
    const g = await svc['memory.graph']({ scope: 'current' });
    expect(g.nodes.find((n) => n.kind === 'relationship')!.title).toBe('阿芙 · 关系');
    expect(g.edges.some((e) => e.target === 'user/people/王小明.md' && e.kind === 'link')).toBe(true);
    const r = await svc['memory.renamePage']({ path: 'user/people/王小明.md', title: '王大明' });
    expect(r).toEqual({ ok: true, path: 'user/people/王大明.md' });
    expect(changed).toEqual([['user/people/王大明.md', 'user/topics/爬山.md']]);
    await new Promise((res) => setTimeout(res, 0));
    const paths = store.pageIndexList().map((x) => x.path);
    expect(paths).not.toContain('user/people/王小明.md');
    expect(paths).toContain('user/people/王大明.md');
  });
});
