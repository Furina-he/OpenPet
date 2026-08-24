import { describe, expect, it } from 'vitest';
import {
  compareVersion,
  DEFAULT_MARKET_SOURCES,
  MarketItemSchema,
  parseMarketIndex,
  PrefsSchema,
  SoulPackSchema,
} from '../src/index.js';

const SHA = 'a'.repeat(64);
const base = {
  id: 'furina',
  name: '芙宁娜',
  version: '1.0.0',
  type: 'soul' as const,
  license: 'CC-BY-4.0',
  downloadUrl: 'https://example.com/packs/furina.dssoul',
  sha256: SHA,
};

describe('⑯ MarketItemSchema', () => {
  it('接受最小合法条目', () => {
    expect(MarketItemSchema.parse(base).id).toBe('furina');
  });

  it('license / sha256 必填，sha256 必须是 64 位 hex', () => {
    const { license, ...noLicense } = base;
    void license;
    expect(MarketItemSchema.safeParse(noLicense).success).toBe(false);
    expect(MarketItemSchema.safeParse({ ...base, sha256: 'deadbeef' }).success).toBe(false);
  });

  it('id 走 CHARACTER_ID_RE（禁大写/禁空格）', () => {
    expect(MarketItemSchema.safeParse({ ...base, id: 'Furina' }).success).toBe(false);
    expect(MarketItemSchema.safeParse({ ...base, id: 'my char' }).success).toBe(false);
  });

  it('downloadUrl / preview 必须是绝对 URL', () => {
    expect(MarketItemSchema.safeParse({ ...base, downloadUrl: 'packs/x.dssoul' }).success).toBe(
      false,
    );
    expect(MarketItemSchema.safeParse({ ...base, preview: 'p.png' }).success).toBe(false);
  });

  it('ref 型必须带 modelSource；soul/full 型可无', () => {
    expect(MarketItemSchema.safeParse({ ...base, type: 'ref' }).success).toBe(false);
    const ok = MarketItemSchema.safeParse({
      ...base,
      type: 'ref',
      modelSource: { name: 'Booth 原作页', url: 'https://booth.pm/items/1' },
    });
    expect(ok.success).toBe(true);
    expect(MarketItemSchema.safeParse({ ...base, type: 'full' }).success).toBe(true);
  });

  it('⑰ body 型（.dsbody 肉体包）是合法商品型；未知型仍拒', () => {
    const b = MarketItemSchema.safeParse({
      ...base,
      type: 'body',
      downloadUrl: 'https://example.com/bodies/knight.dsbody',
    });
    expect(b.success).toBe(true);
    // ST 卡等外部格式不流通（市场白名单 = .dspack/.dssoul/.dsbody，spec §5）
    expect(MarketItemSchema.safeParse({ ...base, type: 'stcard' }).success).toBe(false);
  });
});

describe('⑯ parseMarketIndex 容错', () => {
  it('接受 {version:1, items}', () => {
    const r = parseMarketIndex({ version: 1, updatedAt: 1, items: [base] });
    expect(r.items).toHaveLength(1);
    expect(r.dropped).toBe(0);
  });

  it('接受裸数组（照 plugins.marketFetch 口径）', () => {
    expect(parseMarketIndex([base]).items).toHaveLength(1);
  });

  it('坏条目逐条丢弃，不整份失败', () => {
    const r = parseMarketIndex({
      version: 1,
      items: [base, { id: 'bad' }, null, { ...base, id: 'other', sha256: 'zz' }],
    });
    expect(r.items.map((i) => i.id)).toEqual(['furina']);
    expect(r.dropped).toBe(3);
  });

  it('version 字段缺失/错版仍尽力取 items', () => {
    expect(parseMarketIndex({ items: [base] }).items).toHaveLength(1);
    expect(parseMarketIndex({ version: 2, items: [base] }).items).toHaveLength(1);
  });

  it('完全不是索引形状 → 空结果不抛', () => {
    expect(parseMarketIndex(null)).toEqual({ items: [], dropped: 0 });
    expect(parseMarketIndex('nope')).toEqual({ items: [], dropped: 0 });
    expect(parseMarketIndex({ items: 'x' })).toEqual({ items: [], dropped: 0 });
  });
});

describe('⑯ compareVersion', () => {
  it('数字段逐段比', () => {
    expect(compareVersion('1.0.1', '1.0.0')).toBe(1);
    expect(compareVersion('1.2.0', '1.10.0')).toBe(-1);
    expect(compareVersion('2.0', '2.0.0')).toBe(0);
  });

  it('前缀 v / 非法段按 0 / 预发布后缀忽略', () => {
    expect(compareVersion('v1.1.0', '1.0.9')).toBe(1);
    expect(compareVersion('1.x.0', '1.0.0')).toBe(0);
    expect(compareVersion('1.0.0-beta', '1.0.0')).toBe(0);
    expect(compareVersion('', '0')).toBe(0);
  });
});

describe('⑯ SoulPackSchema', () => {
  const soul = {
    id: 'furina',
    name: '芙宁娜',
    version: '1.0',
    persona: { systemPrompt: '你是芙宁娜。', beginDialogs: [] },
  };

  it('最小灵魂包合法（persona 必填）', () => {
    expect(SoulPackSchema.parse(soul).persona.systemPrompt).toBe('你是芙宁娜。');
    const { persona, ...noPersona } = soul;
    void persona;
    expect(SoulPackSchema.safeParse(noPersona).success).toBe(false);
  });

  it('lorebook 复用 PackLorebookSchema（默认值照常补齐）', () => {
    const parsed = SoulPackSchema.parse({
      ...soul,
      lorebook: { entries: [{ keys: ['枫丹'], content: '枫丹是水之国。' }] },
    });
    expect(parsed.lorebook?.scanDepth).toBe(4);
    expect(parsed.lorebook?.entries[0]?.enabled).toBe(true);
  });
});

describe('⑯ prefs market.sources', () => {
  it('默认预置 jsDelivr + GitHub raw 两条', () => {
    const p = PrefsSchema.parse({});
    expect(p['market.sources']).toEqual([...DEFAULT_MARKET_SOURCES]);
    expect(p['market.sources']).toHaveLength(2);
  });

  it('默认值不共享引用（改一次实例不污染下一次 parse）', () => {
    const a = PrefsSchema.parse({});
    a['market.sources'].push('https://evil.example/index.json');
    expect(PrefsSchema.parse({})['market.sources']).toHaveLength(2);
  });

  it('可整表覆盖（用户增删源）', () => {
    expect(PrefsSchema.shape['market.sources'].parse(['https://a/index.json'])).toEqual([
      'https://a/index.json',
    ]);
  });
});
