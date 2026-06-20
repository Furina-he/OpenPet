/** J1 托盘：菜单模板（纯，注入动作可测）+ createTray（Electron Tray 接线，懒加载 electron）。 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { trayIconKey, type TrayIconKey } from './tray-icon.js';

export interface TrayActions {
  chat: () => void;
  toggleVisible: () => void;
  toggleClickThrough: () => void;
  toggleDnd: () => void;
  openHub: () => void;
  quit: () => void;
}
export interface MenuItemTpl {
  label?: string;
  type?: 'separator';
  enabled?: boolean;
  click?: () => void;
}

export function buildTrayMenuTemplate(
  a: TrayActions,
  info: { version: string; connected: boolean },
): MenuItemTpl[] {
  return [
    { label: `DeskSoul ${info.version} · ${info.connected ? '已连接' : '未连接'}`, enabled: false },
    { type: 'separator' },
    { label: '跟小灵聊聊', click: a.chat },
    { label: '显示 / 隐藏角色', click: a.toggleVisible },
    { label: '鼠标穿透', click: a.toggleClickThrough },
    { label: '不打扰', click: a.toggleDnd },
    { type: 'separator' },
    { label: '打开 Hub', click: a.openHub },
    { label: '设置', click: a.openHub },
    { type: 'separator' },
    { label: '退出', click: a.quit },
  ];
}

export interface TrayHandle {
  setState(s: { error: boolean; thinking: boolean }): void;
  destroy(): void;
}

export function createTray(deps: {
  iconsDir: string;
  actions: TrayActions;
  version: string;
  connected: () => boolean;
}): TrayHandle {
  // 懒加载 electron：保持模块顶层无运行时 electron 依赖（buildTrayMenuTemplate 可纯测）。
  const require = createRequire(import.meta.url);
  const { Tray, Menu, nativeImage } = require('electron') as typeof import('electron');
  const iconFor = (k: TrayIconKey): Electron.NativeImage =>
    nativeImage.createFromPath(path.join(deps.iconsDir, `${k}.png`));
  const tray = new Tray(iconFor('default'));
  const rebuildMenu = (): void => {
    tray.setContextMenu(
      Menu.buildFromTemplate(
        buildTrayMenuTemplate(deps.actions, {
          version: deps.version,
          connected: deps.connected(),
        }) as Electron.MenuItemConstructorOptions[],
      ),
    );
  };
  tray.setToolTip('DeskSoul');
  rebuildMenu();
  // 鼠标动作（§14.1）：左键显隐 / 双击聊天 / 中键穿透（右键=菜单由 setContextMenu 接管）。
  tray.on('click', () => deps.actions.toggleVisible());
  tray.on('double-click', () => deps.actions.chat());
  tray.on('middle-click', () => deps.actions.toggleClickThrough());
  return {
    setState(s) {
      tray.setImage(iconFor(trayIconKey(s)));
      rebuildMenu();
    },
    destroy: () => tray.destroy(),
  };
}
