// 三个 Vue renderer 共用。
// locale 初值经 app.prefs.getAll（异步，先渲染 zh 再纠正，与主题订阅同款策略）；
// app.prefs.changed(general.language) → locale.value 即时生效（M7a 契约）。
import { createI18n } from 'vue-i18n';
import { zhCN } from './locales/zh-CN';
import { en } from './locales/en';

export type DsLocale = 'zh-CN' | 'en';

export function createDsI18n() {
  const i18n = createI18n({
    legacy: false,
    locale: 'zh-CN',
    fallbackLocale: 'zh-CN',
    messages: { 'zh-CN': zhCN, en },
  });
  const setLocale = (v: unknown): void => {
    if (v === 'zh-CN' || v === 'en') i18n.global.locale.value = v;
  };
  void window.openpet
    .rpc('app.prefs.getAll', {})
    .then((p) => setLocale((p as Record<string, unknown>)['general.language']))
    .catch(() => {});
  window.openpet.on('app.prefs.changed', (p) => {
    const c = p as { key?: string; value?: unknown };
    if (c.key === 'general.language') setLocale(c.value);
  });
  return i18n;
}
