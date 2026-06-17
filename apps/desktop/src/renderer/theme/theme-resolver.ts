import type { ThemePref } from '@desksoul/protocol';

export type ConcreteTheme = 'light' | 'dark';

/** pref + 系统是否暗色 → 具体主题。'system' 跟随系统（未指明=false→浅色，ui-design §2.2）。 */
export function resolveTheme(pref: ThemePref, systemPrefersDark: boolean): ConcreteTheme {
  if (pref === 'system') return systemPrefersDark ? 'dark' : 'light';
  return pref;
}

/** 把具体主题写到 <html data-theme>（薄 DOM 操作，逻辑在 resolveTheme）。 */
export function applyTheme(pref: ThemePref): void {
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = resolveTheme(pref, dark);
}

/** 当 pref='system' 时监听系统切换并重应用；返回退订函数。 */
export function watchSystemTheme(getPref: () => ThemePref): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = (): void => {
    if (getPref() === 'system') applyTheme('system');
  };
  mq.addEventListener('change', handler);
  return () => mq.removeEventListener('change', handler);
}
