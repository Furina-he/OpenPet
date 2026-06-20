/**
 * 桌面动作的单一真源（A1 右键菜单 / J1 托盘 / J2 热键三处共用，避免三份重复）。
 * 仅依赖原语（prefsStore / 窗口定位器 / broadcast）→ ipc-router 与 index.ts 都能注入。
 */
import type { BrowserWindow } from 'electron';
import type { PrefsStore } from './prefs/store.js';

export type WindowGetter = () => BrowserWindow | null;

function showFocus(w: BrowserWindow | null): void {
  if (w && !w.isDestroyed()) {
    w.show();
    w.focus();
  }
}

/** 显示+聚焦聊天浮层（A1 双击 / 托盘 / 热键）。 */
export function showChat(overlayWindow: WindowGetter): void {
  showFocus(overlayWindow());
}

/** 打开+聚焦 Hub（settings 窗）。 */
export function openHub(settingsWindow: WindowGetter): void {
  showFocus(settingsWindow());
}

/** 显隐角色窗。 */
export function toggleCharacter(characterWindow: WindowGetter): void {
  const c = characterWindow();
  if (c && !c.isDestroyed()) {
    if (c.isVisible()) c.hide();
    else c.show();
  }
}

/** A3 穿透：翻转 display.clickThrough pref 真源 + 施加 character 窗 + 广播，返回新态。 */
export function toggleClickThroughPref(deps: {
  prefsStore: PrefsStore;
  characterWindow: WindowGetter;
  broadcast: (channel: string, params: unknown) => void;
}): boolean {
  const next = !deps.prefsStore.getAll()['display.clickThrough'];
  deps.prefsStore.set('display.clickThrough', next);
  const c = deps.characterWindow();
  if (c && !c.isDestroyed()) c.setIgnoreMouseEvents(next, { forward: true });
  deps.broadcast('app.prefs.changed', { key: 'display.clickThrough', value: next });
  return next;
}

/** A4 不打扰：翻转 display.dndManual pref + 广播（character 渲染月牙徽标）。 */
export function toggleDndPref(deps: {
  prefsStore: PrefsStore;
  broadcast: (channel: string, params: unknown) => void;
}): boolean {
  const next = !deps.prefsStore.getAll()['display.dndManual'];
  deps.prefsStore.set('display.dndManual', next);
  deps.broadcast('app.prefs.changed', { key: 'display.dndManual', value: next });
  return next;
}
