import { describe, it, expect, vi } from 'vitest';
import { buildTrayMenuTemplate } from '../electron/main/tray-service';
import { menuLabels } from '../electron/main/menu-labels';

const actions = () => ({
  chat: vi.fn(),
  toggleVisible: vi.fn(),
  toggleClickThrough: vi.fn(),
  toggleDnd: vi.fn(),
  openHub: vi.fn(),
  quit: vi.fn(),
});

describe('tray 菜单模板（§14.1）', () => {
  it('含核心项，点击触发注入动作', () => {
    const a = actions();
    const tpl = buildTrayMenuTemplate(a, { version: '0.1.0', connected: true }, menuLabels('zh-CN'));
    const labels = tpl.filter((t) => t.label).map((t) => t.label);
    expect(labels).toEqual(
      expect.arrayContaining([
        '跟小灵聊聊',
        '显示 / 隐藏角色',
        '鼠标穿透',
        '不打扰',
        '打开 Hub',
        '退出',
      ]),
    );
    tpl.find((t) => t.label === '退出')!.click!();
    expect(a.quit).toHaveBeenCalled();
  });

  it('㉓「角色大小 ▸」（穿透开启时的入口）：档位 / 勾选 / 点击持久化', () => {
    const set = vi.fn();
    const tpl = buildTrayMenuTemplate(
      actions(),
      { version: '0.1.0', connected: true },
      menuLabels('zh-CN'),
      { current: 0.5, presets: [0.5, 0.75, 1, 1.25, 1.5, 2], maxScale: 2, pixelSnap: false, dpr: 1, set },
    );
    const size = tpl.find((t) => t.submenu)!;
    expect(size.label).toBe('角色大小');
    expect(size.submenu!.find((i) => i.checked)!.label).toBe('50%');
    size.submenu!.find((i) => i.label === '200%')!.click!();
    expect(set).toHaveBeenCalledWith(2);
  });

  it('㉓ 当前值不在预设上：父项「角色大小（当前 N%）」；en 同理', () => {
    const scale = {
      current: 1.15,
      presets: [0.5, 0.75, 1, 1.25, 1.5, 2],
      maxScale: 2,
      pixelSnap: false,
      dpr: 1,
      set: vi.fn(),
    };
    const zh = buildTrayMenuTemplate(actions(), { version: '0.1.0', connected: false }, menuLabels('zh-CN'), scale);
    expect(zh.find((t) => t.submenu)!.label).toBe('角色大小（当前 115%）');
    const en = buildTrayMenuTemplate(actions(), { version: '0.1.0', connected: false }, menuLabels('en'), scale);
    expect(en.find((t) => t.submenu)!.label).toBe('Character size (now 115%)');
  });

  it('不传大小模型时不出子菜单（向后兼容）', () => {
    const tpl = buildTrayMenuTemplate(actions(), { version: '0.1.0', connected: true }, menuLabels('zh-CN'));
    expect(tpl.some((t) => t.submenu)).toBe(false);
  });
});
