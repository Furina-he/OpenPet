import { describe, expect, it } from 'vitest';
import { activateLorebook, PackLorebookSchema, type PackLorebook } from '../src/lorebook.js';
import { CharacterManifestSchema } from '../src/character-manifest.js';

function book(over: Partial<PackLorebook> = {}): PackLorebook {
  return PackLorebookSchema.parse({
    entries: [
      { keys: ['Nyx 城'], content: 'Nyx 城建在悬崖上。' },
      { keys: ['王国'], content: '王国已亡三百年。', insertionOrder: 1 },
    ],
    ...over,
  });
}

describe('PackLorebookSchema', () => {
  it('缺省值：scanDepth=4 tokenBudget=1024 enabled=true constant=false', () => {
    const b = book();
    expect(b.scanDepth).toBe(4);
    expect(b.tokenBudget).toBe(1024);
    expect(b.entries[0]).toMatchObject({ enabled: true, constant: false, caseSensitive: false, insertionOrder: 100 });
  });
  it('manifest 灵魂层：lorebook + persona.greetings 可选且向后兼容', () => {
    const m = CharacterManifestSchema.parse({
      id: 'aqua', name: 'Aqua', version: '1.0', engine: 'vrm', model: 'a.vrm',
      persona: { systemPrompt: 'x', beginDialogs: [], greetings: ['你好 {{user}}'] },
      lorebook: { entries: [{ keys: ['k'], content: 'v' }] },
    });
    expect(m.persona?.greetings).toEqual(['你好 {{user}}']);
    expect(m.lorebook?.entries).toHaveLength(1);
    // 旧 manifest（无新字段）照常通过
    expect(() => CharacterManifestSchema.parse({ id: 'a', name: 'A', version: '1', engine: 'vrm', model: 'a.vrm' })).not.toThrow();
  });
});

describe('activateLorebook（最小子集：keys+scanDepth+预算）', () => {
  it('关键词命中（大小写不敏感）注入，未命中不注入', () => {
    expect(activateLorebook(book(), { history: [], current: '说说 nyx 城吧' })).toEqual(['Nyx 城建在悬崖上。']);
    expect(activateLorebook(book(), { history: [], current: '今天天气不错' })).toEqual([]);
  });
  it('caseSensitive 条目大小写敏感', () => {
    const b = PackLorebookSchema.parse({ entries: [{ keys: ['NYX'], content: 'x', caseSensitive: true }] });
    expect(activateLorebook(b, { history: [], current: 'nyx' })).toEqual([]);
    expect(activateLorebook(b, { history: [], current: 'NYX' })).toEqual(['x']);
  });
  it('constant 条目常驻；disabled 条目永不注入；空 keys 非 constant 永不命中', () => {
    const b = PackLorebookSchema.parse({
      entries: [
        { keys: [], content: '常驻', constant: true },
        { keys: ['k'], content: '禁用', enabled: false },
        { keys: [], content: '死条目' },
      ],
    });
    expect(activateLorebook(b, { history: [], current: 'k 什么都有' })).toEqual(['常驻']);
  });
  it('扫描窗 = 最近 scanDepth 条 history + 当前输入', () => {
    const b = book({ scanDepth: 2 });
    const history = ['提到 Nyx 城', '无关', '无关'];
    expect(activateLorebook(b, { history, current: '继续' })).toEqual([]); // Nyx 在窗外
    expect(activateLorebook(b, { history: history.slice(1), current: 'Nyx 城如何' })).toEqual(['Nyx 城建在悬崖上。']);
  });
  it('按 insertionOrder 升序；超预算截断但至少注入一条', () => {
    const both = activateLorebook(book(), { history: ['王国与 Nyx 城'], current: '嗯' });
    expect(both).toEqual(['王国已亡三百年。', 'Nyx 城建在悬崖上。']); // order 1 < 100
    const tiny = book({ tokenBudget: 50 }); // 预算 100 chars，仅够第一条
    const cut = activateLorebook(
      PackLorebookSchema.parse({ ...tiny, tokenBudget: 50, entries: [
        { keys: ['a'], content: 'x'.repeat(90), insertionOrder: 1 },
        { keys: ['a'], content: 'y'.repeat(90), insertionOrder: 2 },
      ] }),
      { history: [], current: 'a' },
    );
    expect(cut).toEqual(['x'.repeat(90)]);
  });
});
