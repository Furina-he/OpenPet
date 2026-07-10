import type { BrowserWindow } from 'electron';
import type { Prefs, PrefKey } from '@openpet/protocol';
import { scaledBounds } from '../window-scale.js';

/**
 * Main 侧副作用表：pref → 系统状态实际作用。set() 时与启动 hydrate 时各跑一遍。
 * 只装"有 Main 动作"的键；theme/lookAt/footGlow 靠 prefs-service 的 app.prefs.changed
 * 广播由 renderer 自响应，不进此表。characterScale 在 P2（与 D4 一起）。
 */
export type PrefEffects = Partial<{ [K in PrefKey]: (value: Prefs[K]) => void }>;

export interface EffectsDeps {
  characterWindow?: () => BrowserWindow | null;
  setLoginItem?: (open: boolean) => void;
  /** 缩放后回写 ipc-router 的 characterSize 真源（moveBy 锁尺寸用）。 */
  setCharacterSize?: (size: { width: number; height: number }) => void;
  broadcast?: (channel: string, params: unknown) => void;
}

export function createPrefEffects(deps: EffectsDeps = {}): PrefEffects {
  const cw = deps.characterWindow ?? (() => null);
  const setLoginItem = deps.setLoginItem ?? (() => {});
  const win = (): BrowserWindow | null => {
    const w = cw();
    return w && !w.isDestroyed() ? w : null;
  };
  return {
    'general.launchAtLogin': (v) => setLoginItem(v),
    'display.alwaysOnTop': (v) => win()?.setAlwaysOnTop(v),
    'display.clickThrough': (v) => win()?.setIgnoreMouseEvents(v, { forward: true }),
    'display.characterScale': (v) => {
      const w = win();
      if (!w) return;
      const b = scaledBounds(w.getBounds(), v);
      deps.setCharacterSize?.({ width: b.width, height: b.height });
      w.setBounds(b);
    },
  };
}

/** 按当前 prefs 全量施加已注册副作用（启动 hydrate）。未注册的 key 安全跳过。 */
export function applyAllEffects(effects: PrefEffects, prefs: Prefs): void {
  for (const key of Object.keys(prefs) as PrefKey[]) {
    const fn = effects[key] as ((v: Prefs[PrefKey]) => void) | undefined;
    fn?.(prefs[key]);
  }
}
