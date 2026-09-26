import { describe, it, expect, vi } from 'vitest';
import {
  buildCharacterMenuTemplate,
  buildScaleMenuItem,
  type MenuItemTpl,
  type ScaleMenu,
} from '../electron/main/character-menu';
import { menuLabels } from '../electron/main/menu-labels';

const actions = () => ({
  chat: vi.fn(),
  toggleClickThrough: vi.fn(),
  toggleVisible: vi.fn(),
  openHub: vi.fn(),
});

function scaleMenu(over: Partial<ScaleMenu> = {}): ScaleMenu {
  return {
    current: 1,
    presets: [0.5, 0.75, 1, 1.25, 1.5, 2],
    maxScale: 2,
    pixelSnap: false,
    dpr: 1,
    set: vi.fn(),
    ...over,
  };
}

const findSize = (tpl: MenuItemTpl[]): MenuItemTpl =>
  tpl.find((t) => t.submenu !== undefined)!;

describe('character-menu 模板（A1 右键 / J1 托盘复用）', () => {
  it('给出标准动作项，点击触发注入动作', () => {
    const a = actions();
    const tpl = buildCharacterMenuTemplate(a, menuLabels('zh-CN'), scaleMenu());
    const labels = tpl.filter((t) => t.label).map((t) => t.label);
    expect(labels).toEqual(
      expect.arrayContaining(['跟小灵聊聊', '鼠标穿透', '显示 / 隐藏角色', '设置']),
    );
    tpl.find((t) => t.label === '跟小灵聊聊')!.click!();
    expect(a.chat).toHaveBeenCalled();
  });
});

describe('㉓「大小 ▸」子菜单', () => {
  it('六档单选 + 分隔线 + 恢复 100%；当前值命中预设 → 勾选、父项就叫「大小」', () => {
    const size = findSize(buildCharacterMenuTemplate(actions(), menuLabels('zh-CN'), scaleMenu()));
    expect(size.label).toBe('大小');
    const sub = size.submenu!;
    expect(sub.map((i) => i.label ?? i.type)).toEqual([
      '50%',
      '75%',
      '100%',
      '125%',
      '150%',
      '200%',
      'separator',
      '恢复 100%',
    ]);
    expect(sub.slice(0, 6).every((i) => i.type === 'radio')).toBe(true);
    expect(sub.filter((i) => i.checked).map((i) => i.label)).toEqual(['100%']);
  });

  it('点击档位 / 恢复 100% → set（调用方持久化）', () => {
    const m = scaleMenu({ current: 1.25 });
    const sub = buildScaleMenuItem(m, menuLabels('zh-CN'), 'size').submenu!;
    sub.find((i) => i.label === '150%')!.click!();
    sub.find((i) => i.label === '恢复 100%')!.click!();
    expect(m.set).toHaveBeenNthCalledWith(1, 1.5);
    expect(m.set).toHaveBeenNthCalledWith(2, 1);
  });

  it('当前值不在预设上：不勾任何档，父项标「大小（当前 115%）」', () => {
    const item = buildScaleMenuItem(scaleMenu({ current: 1.15 }), menuLabels('zh-CN'), 'size');
    expect(item.label).toBe('大小（当前 115%）');
    expect(item.submenu!.some((i) => i.checked)).toBe(false);
  });

  it('超过 maxScale 的档置灰（小屏幕）', () => {
    const sub = buildScaleMenuItem(
      scaleMenu({ maxScale: 728 / 480 }),
      menuLabels('zh-CN'),
      'size',
    ).submenu!;
    const enabled = Object.fromEntries(
      sub.filter((i) => i.type === 'radio').map((i) => [i.label, i.enabled !== false]),
    );
    expect(enabled).toEqual({
      '50%': true,
      '75%': true,
      '100%': true,
      '125%': true,
      '150%': true,
      '200%': false,
    });
  });

  it('像素精灵：直接列清晰档「k×（N%）」', () => {
    const sub = buildScaleMenuItem(
      scaleMenu({ pixelSnap: true, presets: [0.6667, 1.3333, 2], current: 1.3333, dpr: 1.5 }),
      menuLabels('zh-CN'),
      'size',
    ).submenu!;
    expect(sub.filter((i) => i.type === 'radio').map((i) => i.label)).toEqual([
      '1×（67%）',
      '2×（133%）',
      '3×（200%）',
    ]);
    expect(sub.find((i) => i.checked)!.label).toBe('2×（133%）');
  });

  it('en 文案', () => {
    const item = buildScaleMenuItem(scaleMenu({ current: 1.15 }), menuLabels('en'), 'size');
    expect(item.label).toBe('Size (now 115%)');
    expect(item.submenu!.at(-1)!.label).toBe('Reset to 100%');
    const px = buildScaleMenuItem(
      scaleMenu({ pixelSnap: true, presets: [1, 2], current: 2 }),
      menuLabels('en'),
      'size',
    );
    expect(px.submenu!.filter((i) => i.type === 'radio').map((i) => i.label)).toEqual([
      '1× (100%)',
      '2× (200%)',
    ]);
  });
});
