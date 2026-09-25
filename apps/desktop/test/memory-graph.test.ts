import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { MemoryOp } from '@openpet/protocol';
import { buildMemoryGraph } from '../electron/main/memory-graph.js';
import { MemoryWiki } from '../electron/main/memory-wiki.js';

const cleanups: string[] = [];
afterEach(() => {
  for (const p of cleanups.splice(0)) rmSync(p, { recursive: true, force: true });
});
function makeWiki(): MemoryWiki {
  const d = mkdtempSync(path.join(tmpdir(), 'ds-graph-'));
  cleanups.push(d);
  return new MemoryWiki(d, { now: () => Date.UTC(2026, 8, 22, 12) });
}
const create = (
  kind: 'people' | 'topics',
  title: string,
  content: string,
  aliases: string[] = [],
): MemoryOp => ({ op: 'create_page', kind, title, aliases, tags: [], content });
const names: Record<string, string> = { furina: '芙宁娜', other: '另一位' };
const opts = (scope: 'current' | 'all' = 'current') => ({
  scope,
  currentCid: 'furina',
  characterName: (c: string) => names[c] ?? c,
});

describe('㉒ memory-graph 构建', () => {
  it('可读名 / 结构边（导航行）/ link 边 count 合并 / context / 自环丢弃 / ghost / stats', () => {
    const w = makeWiki();
    w.ensureLayout('furina');
    w.applyOps(
      [create('people', '王小明', '大学室友', ['小王']), create('topics', '爬山', '周末活动')],
      'furina',
    );
    // 用户手写：两次链到王小明、一个自环、一个悬空链接、一个 md 链接
    w.writeRaw(
      'user/topics/爬山.md',
      '---\ntitle: 爬山\n---\n\n- 和[[小王]]去香山\n- 又和[[王小明]]去了\n- 见[[爬山]]\n- 想去[[珠峰]]\n- [档案](../profile.md)',
    );
    const g = buildMemoryGraph(w.listAllPages(), opts());
    const byId = new Map(g.nodes.map((n) => [n.id, n]));
    expect(byId.get('user/profile.md')!.title).toBe('我');
    expect(byId.get('characters/furina/relationship.md')!.title).toBe('芙宁娜 · 关系');
    expect(byId.get('characters/furina/timeline.md')!).toMatchObject({
      title: '芙宁娜 · 经历',
      kind: 'timeline',
      characterId: 'furina',
      readonly: false,
    });
    expect(byId.get('user/people/王小明.md')).toMatchObject({ aliases: ['小王'], chars: 4 });
    const link = (s: string, t: string) =>
      g.edges.find((e) => e.kind === 'link' && e.source === s && e.target === t);
    expect(link('user/topics/爬山.md', 'user/people/王小明.md')).toMatchObject({
      count: 2,
      context: '和小王去香山',
    });
    expect(link('user/topics/爬山.md', 'user/topics/爬山.md')).toBeUndefined();
    expect(link('user/topics/爬山.md', 'user/profile.md')).toBeDefined();
    expect(link('characters/furina/relationship.md', 'user/profile.md')).toBeDefined();
    expect(link('characters/furina/relationship.md', 'characters/furina/timeline.md')).toBeDefined();
    expect(link('characters/furina/timeline.md', 'characters/furina/relationship.md')).toBeDefined();
    expect(byId.get('ghost:珠峰')).toMatchObject({ kind: 'ghost', title: '珠峰' });
    expect(link('user/topics/爬山.md', 'ghost:珠峰')).toBeDefined();
    expect(g.stats).toMatchObject({ pages: 5, ghosts: 1, orphans: 0 });
    expect(g.stats.links).toBe(g.edges.filter((e) => e.kind === 'link').length);
  });

  it('mention 边：正文提到标题 / 别名且无显式链接；链接里的文字不算；固定页不作目标', () => {
    const w = makeWiki();
    w.ensureLayout('furina');
    w.applyOps([create('people', '王小明', '室友', ['小王']), create('topics', '爬山', '活动')], 'furina');
    w.writeRaw('user/topics/爬山.md', '---\ntitle: 爬山\n---\n\n常和小王一起，[[王小明]]不算');
    w.writeRaw('user/people/王小明.md', '---\ntitle: 王小明\n---\n\n爱好爬山，也在用户档案里');
    const g = buildMemoryGraph(w.listAllPages(), opts());
    const m = g.edges.filter((e) => e.kind === 'mention');
    // 爬山→王小明 已有显式链接 → 无 mention；王小明→爬山 是未链接提及
    expect(m.map((e) => [e.source, e.target, e.context])).toEqual([
      ['user/people/王小明.md', 'user/topics/爬山.md', '爱好爬山，也在用户档案里'],
    ]);
  });

  it('scope：current 不含他角色页（指向它们的边丢弃、不算 ghost）；all 含只读他角色页；recall 只挂人物 / 话题', () => {
    const w = makeWiki();
    w.ensureLayout('furina');
    w.ensureLayout('other');
    w.applyOps([create('people', '王小明', '室友')], 'furina');
    w.writeRaw(
      'user/people/王小明.md',
      '---\ntitle: 王小明\n---\n\n见 [[characters/other/timeline|另一位的经历]]',
    );
    const cur = buildMemoryGraph(w.listAllPages(), {
      ...opts(),
      recall: new Map([
        ['user/people/王小明.md', { count: 3, lastAt: 100 }],
        ['user/profile.md', { count: 9, lastAt: 1 }],
      ]),
    });
    expect(cur.nodes.some((n) => n.characterId === 'other')).toBe(false);
    expect(cur.stats.ghosts).toBe(0);
    expect(cur.nodes.find((n) => n.id === 'user/people/王小明.md')!.recall).toEqual({
      count: 3,
      lastAt: 100,
    });
    expect(cur.nodes.find((n) => n.id === 'user/profile.md')!.recall).toBeUndefined();
    const all = buildMemoryGraph(w.listAllPages(), opts('all'));
    const otherTl = all.nodes.find((n) => n.id === 'characters/other/timeline.md')!;
    expect(otherTl).toMatchObject({ readonly: true, title: '另一位 · 经历' });
    expect(
      all.edges.some(
        (e) => e.source === 'user/people/王小明.md' && e.target === 'characters/other/timeline.md',
      ),
    ).toBe(true);
  });

  it('孤立页计入 orphans', () => {
    const w = makeWiki();
    w.ensureLayout('furina');
    w.applyOps([create('topics', '天气', '晴')], 'furina');
    const g = buildMemoryGraph(w.listAllPages(), opts());
    expect(g.stats.orphans).toBe(1);
  });
});

describe('㉒ renamePage', () => {
  it('全库改写链接（保留 #节 / |显示 / 路径形式 / md 链接）；旧标题并入 aliases；.prev 随迁', () => {
    const w = makeWiki();
    w.ensureLayout('furina');
    w.applyOps([create('people', '王小明', '室友', ['小王']), create('topics', '爬山', '活动')], 'furina');
    w.writeRaw(
      'user/topics/爬山.md',
      '---\ntitle: 爬山\n---\n\n[[王小明]] [[王小明#近况]] [[王小明|他]] [[user/people/王小明|室友]] [x](../people/王小明.md) [[小明]]',
    );
    w.writeRaw('user/people/王小明.md', '---\ntitle: 王小明\n---\n\n自己：[[王小明]]');
    const r = w.renamePage('user/people/王小明.md', '王大明');
    expect(r.path).toBe('user/people/王大明.md');
    expect(r.changed).toEqual(['user/topics/爬山.md']);
    expect(w.readPage('user/people/王小明.md')).toBeNull();
    const p = w.readPage('user/people/王大明.md')!;
    expect(p.frontmatter.title).toBe('王大明');
    expect(p.frontmatter.aliases).toContain('王小明');
    expect(p.body.trim()).toBe('自己：[[王大明]]');
    expect(existsSync(path.join(w.root, 'user/people/王大明.md.prev'))).toBe(true);
    expect(existsSync(path.join(w.root, 'user/people/王小明.md.prev'))).toBe(false);
    expect(w.readPage('user/topics/爬山.md')!.body.trim()).toBe(
      '[[王大明]] [[王大明#近况]] [[王大明|他]] [[user/people/王大明|室友]] [x](../people/王大明.md) [[小明]]',
    );
    // 图谱不断线
    const g = buildMemoryGraph(w.listAllPages(), opts());
    expect(
      g.edges.find((e) => e.source === 'user/topics/爬山.md' && e.target === 'user/people/王大明.md')!
        .count,
    ).toBe(5);
  });

  it('新文件名撞到他类同名页：原本指向那一页的文件名链接改成路径形式钉住', () => {
    const w = makeWiki();
    w.ensureLayout('furina');
    w.applyOps([create('topics', '苹果', '水果'), create('people', '阿杰', '朋友')], 'furina');
    w.writeRaw('user/profile.md', '---\ntitle: 用户档案\n---\n\n## 杂项\n\n爱吃[[苹果]]，朋友[[阿杰]]');
    w.renamePage('user/people/阿杰.md', '苹果');
    const body = w.readPage('user/profile.md')!.body;
    expect(body).toContain('爱吃[[user/topics/苹果|苹果]]');
    expect(body).toContain('朋友[[user/people/苹果|苹果]]');
  });

  it('冲突拒 / 固定页拒 / 失败不落盘', () => {
    const w = makeWiki();
    w.ensureLayout('furina');
    w.applyOps([create('people', '王小明', '室友'), create('people', '李雷', '同学')], 'furina');
    const before = w.readRaw('user/people/王小明.md');
    expect(() => w.renamePage('user/people/王小明.md', '李雷')).toThrow(/已存在/);
    expect(() => w.renamePage('user/profile.md', 'x')).toThrow(/固定页/);
    expect(w.readRaw('user/people/王小明.md')).toBe(before);
    // 只改大小写 / 同文件名只改标题
    w.renamePage('user/people/李雷.md', '李雷');
    expect(w.readPage('user/people/李雷.md')!.frontmatter.title).toBe('李雷');
  });
});
