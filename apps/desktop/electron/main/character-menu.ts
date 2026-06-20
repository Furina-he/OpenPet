/**
 * 桌面动作菜单模板（A1 右键 + J1 托盘复用）。返回 Electron MenuItemConstructorOptions[]，
 * 动作注入便于测；切角色（E1/V1）暂禁用占位。
 */
export interface CharacterMenuActions {
  chat: () => void;
  toggleClickThrough: () => void;
  toggleVisible: () => void;
  openHub: () => void;
}

export interface MenuItemTpl {
  label?: string;
  type?: 'separator';
  enabled?: boolean;
  click?: () => void;
}

export function buildCharacterMenuTemplate(a: CharacterMenuActions): MenuItemTpl[] {
  return [
    { label: '跟小灵聊聊', click: a.chat },
    { label: '切换角色', enabled: false }, // E1/V1 角色库后开放
    { type: 'separator' },
    { label: '鼠标穿透', click: a.toggleClickThrough },
    { label: '显示 / 隐藏', click: a.toggleVisible },
    { type: 'separator' },
    { label: '设置', click: a.openHub },
  ];
}
