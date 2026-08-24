import { describe, expect, it } from 'vitest';
import { BodyPackSchema } from '@openpet/protocol';
import {
  bodiesAsInstalled,
  isCrossEngine,
  swapTargets,
  toBodyCard,
} from '../src/renderer/settings/body-view.js';
import { toMarketCard } from '../src/renderer/settings/market-view.js';

const body = (over: Record<string, unknown> = {}) =>
  BodyPackSchema.parse({
    id: 'knight',
    name: '骑士',
    version: '1.0',
    engine: 'vrm',
    model: 'k.vrm',
    ...over,
  });

const installed = (over: Record<string, unknown> = {}) => ({
  body: body(over),
  sizeBytes: 2048,
  installedAt: 1700000000000,
});

describe('⑰ toBodyCard', () => {
  it('preview 走 asset:// 形象库根；缺省 null（UI 用首字占位）', () => {
    expect(toBodyCard(installed({ preview: 'p.png' })).previewUrl).toBe('asset://knight/p.png');
    expect(toBodyCard(installed()).previewUrl).toBeNull();
  });

  it('元数据缺省归 null / 空表，尺寸与安装时间透传', () => {
    const c = toBodyCard(installed());
    expect(c).toMatchObject({ id: 'knight', engine: 'vrm', license: null, author: null, tags: [] });
    expect(c.sizeBytes).toBe(2048);
    expect(c.installedAt).toBe(1700000000000);
    const full = toBodyCard(installed({ license: 'CC0-1.0', author: 'a', tags: ['x'] }));
    expect(full).toMatchObject({ license: 'CC0-1.0', author: 'a', tags: ['x'] });
  });
});

describe('⑰ swapTargets（换形象目标）', () => {
  const items = [
    { characterId: 'default', builtin: true, manifest: { name: '小灵', engine: 'vrm' } },
    { characterId: 'sage', builtin: false, manifest: { name: '贤者', engine: 'vrm' } },
    { characterId: 'doll', builtin: false, manifest: { name: '人偶', engine: 'live2d' } },
  ];

  it('只列导入角色（内置只读，须复制后编辑）', () => {
    expect(swapTargets(items).map((t) => t.id)).toEqual(['sage', 'doll']);
  });

  it('全是内置 → 空表（UI 走「先复制一份」引导）', () => {
    expect(swapTargets(items.filter((c) => c.builtin))).toEqual([]);
  });

  it('跨引擎判定（弹窗多一句词表换代提示）', () => {
    expect(isCrossEngine({ manifest: { engine: 'vrm' } }, { engine: 'live2d' })).toBe(true);
    expect(isCrossEngine({ manifest: { engine: 'vrm' } }, { engine: 'vrm' })).toBe(false);
    expect(isCrossEngine(null, { engine: 'vrm' })).toBe(false);
  });
});

describe('⑰ 市场 body 型「已装」判定走形象库池子', () => {
  const item = {
    id: 'knight',
    name: '骑士',
    version: '1.0',
    type: 'body' as const,
    license: 'CC0-1.0',
    downloadUrl: 'https://e.com/knight.dsbody',
    sha256: 'a'.repeat(64),
  };

  it('形象库里有同 id 同版本 → 已安装；索引更高 → 可更新', () => {
    const bodies = bodiesAsInstalled([installed()]);
    expect(toMarketCard(item, [], '1.0.0', bodies).state).toBe('installed');
    expect(toMarketCard({ ...item, version: '2.0' }, [], '1.0.0', bodies).state).toBe('updatable');
  });

  it('同 id 的角色不算「已装形象」（两个库互不串味）', () => {
    const chars = [{ characterId: 'knight', manifest: { version: '1.0' } }];
    expect(toMarketCard(item, chars, '1.0.0', []).state).toBe('new');
    // 灵魂/完整包照旧比角色库
    expect(toMarketCard({ ...item, type: 'soul' }, chars, '1.0.0', []).state).toBe('installed');
  });
});
