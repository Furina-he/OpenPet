import type { Prefs } from '@desksoul/protocol';
import { applyTheme, watchSystemTheme } from './theme-resolver';

/** renderer 通用：hydrate 当前主题 + 订阅 changed + 跟随系统。返回退订。 */
export function subscribeTheme(): () => void {
  let theme: Prefs['display.theme'] = 'system';
  void window.desksoul.rpc('app.prefs.getAll', {}).then((p) => {
    theme = p['display.theme'];
    applyTheme(theme);
  });
  const offSys = watchSystemTheme(() => theme);
  const offChanged = window.desksoul.on('app.prefs.changed', (p) => {
    if (p.key === 'display.theme') {
      theme = p.value as Prefs['display.theme'];
      applyTheme(theme);
    }
  });
  return () => {
    offSys();
    offChanged();
  };
}
