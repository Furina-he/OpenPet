/** J2 热键注册器：按 prefs.hotkeys.* 注册 globalShortcut，apply 时全量重注册。注入便于测。 */
import type { Prefs } from '@desksoul/protocol';
import { validateAccelerator } from './hotkey-rules.js';

export interface HotkeyActions {
  chat: () => void;
  toggleHide: () => void;
  clickThrough: () => void;
  dnd: () => void;
  openHub: () => void;
}
export interface GlobalShortcutLike {
  register: (accelerator: string, cb: () => void) => boolean;
  unregisterAll: () => void;
}
const KEY_TO_ACTION: Array<[keyof Prefs & `hotkeys.${string}`, keyof HotkeyActions]> = [
  ['hotkeys.chat', 'chat'],
  ['hotkeys.toggleHide', 'toggleHide'],
  ['hotkeys.clickThrough', 'clickThrough'],
  ['hotkeys.dnd', 'dnd'],
  ['hotkeys.openHub', 'openHub'],
];

export function createHotkeyService(deps: {
  globalShortcut: GlobalShortcutLike;
  actions: HotkeyActions;
}) {
  return {
    apply(prefs: Prefs): void {
      deps.globalShortcut.unregisterAll();
      for (const [key, action] of KEY_TO_ACTION) {
        const acc = prefs[key];
        if (typeof acc === 'string' && validateAccelerator(acc).ok) {
          deps.globalShortcut.register(acc, () => deps.actions[action]());
        }
      }
    },
    dispose(): void {
      deps.globalShortcut.unregisterAll();
    },
  };
}
