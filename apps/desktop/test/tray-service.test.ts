import { describe, it, expect, vi } from 'vitest';
import { buildTrayMenuTemplate } from '../electron/main/tray-service';
import { menuLabels } from '../electron/main/menu-labels';

describe('tray 菜单模板（§14.1）', () => {
  it('含核心项，点击触发注入动作', () => {
    const a = {
      chat: vi.fn(),
      toggleVisible: vi.fn(),
      toggleClickThrough: vi.fn(),
      toggleDnd: vi.fn(),
      openHub: vi.fn(),
      quit: vi.fn(),
    };
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
});
