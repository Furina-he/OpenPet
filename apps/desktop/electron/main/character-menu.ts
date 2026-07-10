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

import type { MenuLabels } from './menu-labels.js';

export interface MenuItemTpl {
  label?: string;
  type?: 'separator';
  enabled?: boolean;
  click?: () => void;
}

export function buildCharacterMenuTemplate(
  a: CharacterMenuActions,
  labels: MenuLabels,
): MenuItemTpl[] {
  return [
    { label: labels.chat, click: a.chat },
    { label: labels.switchCharacter, enabled: false }, // E1/V1 角色库后开放
    { type: 'separator' },
    { label: labels.clickThrough, click: a.toggleClickThrough },
    { label: labels.toggleVisible, click: a.toggleVisible },
    { type: 'separator' },
    { label: labels.settings, click: a.openHub },
  ];
}
