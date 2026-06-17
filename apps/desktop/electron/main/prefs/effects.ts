import type { Prefs, PrefKey } from '@desksoul/protocol';

/**
 * Main 侧副作用表：pref → 对系统状态的实际作用（如 alwaysOnTop → 窗口 setAlwaysOnTop）。
 * set() 时与启动 hydrate 时各跑一遍，维持"单写者施加副作用"。
 *
 * M7a：界面主题靠 app.prefs.changed 广播让 renderer 自行换肤，无需 Main 副作用，故表为空。
 * 这是给 M7b 的 seam（alwaysOnTop / clickThrough / characterScale / lookAt 在 M7b 注册）。
 */
export type PrefEffects = Partial<{ [K in PrefKey]: (value: Prefs[K]) => void }>;

export interface EffectsDeps {
  // M7b 注入：characterWindow()、broadcast 等。M7a 暂无依赖。
  [k: string]: unknown;
}

export function createPrefEffects(_deps: EffectsDeps = {}): PrefEffects {
  return {};
}

/** 按当前 prefs 全量施加已注册的副作用（启动 hydrate）。未注册的 key 安全跳过。 */
export function applyAllEffects(effects: PrefEffects, prefs: Prefs): void {
  for (const key of Object.keys(prefs) as PrefKey[]) {
    const fn = effects[key] as ((v: Prefs[PrefKey]) => void) | undefined;
    fn?.(prefs[key]);
  }
}
