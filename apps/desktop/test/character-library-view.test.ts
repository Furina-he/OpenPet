import { describe, expect, it } from 'vitest';
import type { CharacterManifest } from '@openpet/protocol';
import {
  toCardVm,
  sortCards,
  formatBytes,
  personaSourceOf,
  drawerMenuItems,
  cardContextMenuItems,
} from '../src/renderer/settings/character-library-view.js';

const m = (over: Partial<CharacterManifest> = {}): CharacterManifest =>
  ({
    id: 'miko',
    name: '巫女',
    version: '1.0.0',
    engine: 'vrm',
    model: 'model.vrm',
    ...over,
  }) as CharacterManifest;

describe('character-library-view（E1）', () => {
  it('toCardVm：preview → asset URL；无 preview → null；persona/cues 计入', () => {
    const vm = toCardVm({
      characterId: 'miko',
      manifest: m({
        preview: 'img/card.png',
        persona: { systemPrompt: 'x', beginDialogs: [] },
        cues: [{ on: 'tap.head' }],
      }),
      builtin: false,
      active: true,
    });
    expect(vm).toMatchObject({
      id: 'miko',
      name: '巫女',
      engine: 'vrm',
      builtin: false,
      active: true,
      previewUrl: 'asset://miko/img/card.png',
      hasPersona: true,
      cueCount: 1,
    });
    expect(
      toCardVm({ characterId: 'a', manifest: m({ id: 'a' }), builtin: true, active: false })
        .previewUrl,
    ).toBeNull();
  });
  it('sortCards：当前优先 → 内置优先 → 名称', () => {
    const cards = [
      { id: 'b', name: 'B', active: false, builtin: false },
      { id: 'c', name: 'C', active: true, builtin: false },
      { id: 'a', name: 'A', active: false, builtin: true },
    ];
    expect(sortCards(cards as never[]).map((c) => (c as { id: string }).id)).toEqual([
      'c',
      'a',
      'b',
    ]);
  });
});

describe('⑩.7 E2 详情视图逻辑', () => {
  it('formatBytes：无值 —；KB/MB 换算', () => {
    expect(formatBytes(undefined)).toBe('—');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
  it('personaSourceOf：绑定 > 包声明 > 用户默认 > 内置；失效绑定顺位下落', () => {
    const all = {
      personas: [{ id: 'p1' }],
      defaultId: 'p1',
      bindings: { miko: 'p1' },
    };
    const packed = m({ persona: { systemPrompt: 'x', beginDialogs: [] } });
    expect(personaSourceOf('miko', packed, all)).toBe('binding');
    expect(personaSourceOf('other', packed, all)).toBe('pack');
    expect(personaSourceOf('other', m(), all)).toBe('default');
    expect(personaSourceOf('other', m(), { personas: [], defaultId: '', bindings: {} })).toBe(
      'builtin',
    );
    // 绑定指向已删 persona → 落到包声明
    expect(
      personaSourceOf('miko', packed, { personas: [], defaultId: '', bindings: { miko: 'p1' } }),
    ).toBe('pack');
  });
  it('抽屉 ⋮ 菜单：内置禁 重命名/重置映射/卸载；userData 全可用', () => {
    const builtin = Object.fromEntries(
      drawerMenuItems({ builtin: true }).map((x) => [x.key, x.disabled ?? false]),
    );
    expect(builtin['rename']).toBe(true);
    expect(builtin['resetEmotions']).toBe(true);
    expect(builtin['remove']).toBe(true);
    expect(builtin['duplicate']).toBe(false);
    expect(builtin['export']).toBe(false);
    expect(builtin['reveal']).toBe(false);
    const user = drawerMenuItems({ builtin: false });
    expect(user.every((x) => !x.disabled)).toBe(true);
    expect(user.find((x) => x.key === 'remove')?.danger).toBe(true);
  });
  it('卡片右键菜单：设为当前（active 禁用）+ 编辑/复制/导出/显示/卸载', () => {
    const items = cardContextMenuItems({ builtin: false, active: true });
    expect(items.map((x) => x.key)).toEqual([
      'activate',
      'edit',
      'duplicate',
      'export',
      'reveal',
      'remove',
    ]);
    expect(items.find((x) => x.key === 'activate')?.disabled).toBe(true);
    // 内置：编辑 = 复制后编辑（editAsCopy 标记），卸载禁用
    const b = cardContextMenuItems({ builtin: true, active: false });
    expect(b.find((x) => x.key === 'edit')?.editAsCopy).toBe(true);
    expect(b.find((x) => x.key === 'remove')?.disabled).toBe(true);
  });
});
