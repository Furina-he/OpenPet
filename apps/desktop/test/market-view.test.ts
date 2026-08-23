import { describe, expect, it } from 'vitest';
import type { MarketItem } from '@openpet/protocol';
import {
  addSource,
  filterMarketCards,
  formatMarketSize,
  isValidSourceUrl,
  toMarketCard,
  type InstalledLike,
} from '../src/renderer/settings/market-view.js';

const item = (over: Partial<MarketItem> = {}): MarketItem =>
  ({
    id: 'sage',
    name: '贤者',
    version: '1.0.0',
    type: 'soul',
    license: 'CC0-1.0',
    downloadUrl: 'https://example.com/sage.dssoul',
    sha256: 'a'.repeat(64),
    ...over,
  }) as MarketItem;

const installed = (id: string, version: string): InstalledLike => ({
  characterId: id,
  manifest: { version },
});

describe('toMarketCard 已装比对', () => {
  it('未装 → new', () => {
    expect(toMarketCard(item(), [], '0.1.0').state).toBe('new');
  });

  it('同版本 → installed；索引版本更高 → updatable（带本地版本）', () => {
    expect(toMarketCard(item(), [installed('sage', '1.0.0')], '0.1.0').state).toBe('installed');
    const c = toMarketCard(item({ version: '1.2.0' }), [installed('sage', '1.0.0')], '0.1.0');
    expect(c.state).toBe('updatable');
    expect(c.localVersion).toBe('1.0.0');
  });

  it('本地版本更高 → 仍算 installed（不提示降级）', () => {
    expect(toMarketCard(item({ version: '0.9' }), [installed('sage', '1.0.0')], '0.1.0').state).toBe(
      'installed',
    );
  });

  it('minAppVersion 高于当前 app → needsUpgrade（优先于其他状态）', () => {
    expect(toMarketCard(item({ minAppVersion: '0.5.0' }), [], '0.1.0').state).toBe('needsUpgrade');
    expect(toMarketCard(item({ minAppVersion: '0.1.0' }), [], '0.1.0').state).toBe('new');
  });
});

describe('filterMarketCards', () => {
  const cards = [
    toMarketCard(item({ id: 'sage', name: '贤者', tags: ['fantasy'] }), [], '1.0.0'),
    toMarketCard(
      item({ id: 'miko', name: 'Miko', type: 'full', summary: 'shrine maiden' }),
      [],
      '1.0.0',
    ),
    toMarketCard(
      item({ id: 'aqua', name: 'Aqua', type: 'ref', modelSource: { name: 'b', url: 'https://b/' } }),
      [installed('aqua', '0.1')],
      '1.0.0',
    ),
  ];

  it('type 过滤', () => {
    expect(filterMarketCards(cards, { query: '', type: 'full' }).map((c) => c.item.id)).toEqual([
      'miko',
    ]);
    expect(filterMarketCards(cards, { query: '', type: 'all' })).toHaveLength(3);
  });

  it('搜索命中 name / id / tags / summary，大小写不敏感', () => {
    const ids = (q: string): string[] =>
      filterMarketCards(cards, { query: q, type: 'all' }).map((c) => c.item.id);
    expect(ids('贤者')).toEqual(['sage']);
    expect(ids('MIKO')).toEqual(['miko']);
    expect(ids('fantasy')).toEqual(['sage']);
    expect(ids('shrine')).toEqual(['miko']);
    expect(ids('无匹配')).toEqual([]);
  });

  it('排序：可更新 → 未安装 → 已安装', () => {
    const mixed = [
      toMarketCard(item({ id: 'b-installed' }), [installed('b-installed', '1.0.0')], '1.0.0'),
      toMarketCard(item({ id: 'a-new' }), [], '1.0.0'),
      toMarketCard(item({ id: 'c-upd', version: '2.0' }), [installed('c-upd', '1.0')], '1.0.0'),
    ];
    expect(filterMarketCards(mixed, { query: '', type: 'all' }).map((c) => c.item.id)).toEqual([
      'c-upd',
      'a-new',
      'b-installed',
    ]);
  });
});

describe('市场源工具', () => {
  it('formatMarketSize', () => {
    expect(formatMarketSize(undefined)).toBe('—');
    expect(formatMarketSize(0)).toBe('—');
    expect(formatMarketSize(512)).toBe('512 B');
    expect(formatMarketSize(2048)).toBe('2.0 KB');
    expect(formatMarketSize(5 * 1024 * 1024)).toBe('5.0 MB');
  });

  it('isValidSourceUrl 只放行 http(s)', () => {
    expect(isValidSourceUrl('https://a/index.json')).toBe(true);
    expect(isValidSourceUrl(' http://a/index.json ')).toBe(true);
    expect(isValidSourceUrl('file:///etc/passwd')).toBe(false);
    expect(isValidSourceUrl('not a url')).toBe(false);
    expect(isValidSourceUrl('')).toBe(false);
  });

  it('addSource 去重保序', () => {
    expect(addSource(['https://a/'], 'https://b/')).toEqual(['https://a/', 'https://b/']);
    expect(addSource(['https://a/'], ' https://a/ ')).toEqual(['https://a/']);
  });
});
