/** J1 托盘：菜单模板（纯，注入动作可测）+ createTray（Electron Tray 接线，懒加载 electron）。 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { trayIconKey, type TrayIconKey } from './tray-icon.js';
import type { MenuLabels } from './menu-labels.js';

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
  labels: MenuLabels,
): MenuItemTpl[] {
  return [
    {
      label: `openpet ${info.version} · ${info.connected ? labels.connected : labels.disconnected}`,
      enabled: false,
    },
    { type: 'separator' },
    { label: labels.chat, click: a.chat },
    { label: labels.toggleVisible, click: a.toggleVisible },
    { label: labels.clickThrough, click: a.toggleClickThrough },
    { label: labels.dnd, click: a.toggleDnd },
    { type: 'separator' },
    { label: labels.openHub, click: a.openHub },
    { label: labels.settings, click: a.openHub },
    { type: 'separator' },
    { label: labels.quit, click: a.quit },
  ];
}

export interface TrayHandle {
  setState(s: { error: boolean; thinking: boolean }): void;
  /** 语言切换时重建菜单（labels 每次经 deps.labels() 现取）。 */
  refreshMenu(): void;
  destroy(): void;
}

export function createTray(deps: {
  iconsDir: string;
  actions: TrayActions;
  version: string;
  connected: () => boolean;
  labels: () => MenuLabels;
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
        buildTrayMenuTemplate(
          deps.actions,
          { version: deps.version, connected: deps.connected() },
          deps.labels(),
        ) as Electron.MenuItemConstructorOptions[],
      ),
    );
  };
  tray.setToolTip('openpet');
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
    refreshMenu: rebuildMenu,
    destroy: () => tray.destroy(),
  };
}
