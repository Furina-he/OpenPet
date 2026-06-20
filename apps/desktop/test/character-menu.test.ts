import { describe, it, expect, vi } from 'vitest';
import { buildCharacterMenuTemplate } from '../electron/main/character-menu';

describe('character-menu 模板（A1 右键 / J1 托盘复用）', () => {
  it('给出标准动作项，点击触发注入动作', () => {
    const actions = {
      chat: vi.fn(),
      toggleClickThrough: vi.fn(),
      toggleVisible: vi.fn(),
      openHub: vi.fn(),
    };
    const tpl = buildCharacterMenuTemplate(actions);
    const labels = tpl.filter((t) => t.label).map((t) => t.label);
    expect(labels).toEqual(
      expect.arrayContaining(['跟小灵聊聊', '鼠标穿透', '显示 / 隐藏', '设置']),
    );
    tpl.find((t) => t.label === '跟小灵聊聊')!.click!();
    expect(actions.chat).toHaveBeenCalled();
  });
});
