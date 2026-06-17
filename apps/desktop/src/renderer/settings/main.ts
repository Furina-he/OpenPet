import { createApp } from 'vue';
import App from './App.vue';
import '../theme/tokens.css';
import { applyTheme, watchSystemTheme } from '../theme/theme-resolver';
import type { Prefs } from '@desksoul/protocol';

// 启动 hydrate：拉 prefs → 应用当前主题；并监听系统主题变化（pref='system' 时）。
let currentTheme: Prefs['display.theme'] = 'system';
void window.desksoul.rpc('app.prefs.getAll', {}).then((prefs) => {
  currentTheme = prefs['display.theme'];
  applyTheme(currentTheme);
});
watchSystemTheme(() => currentTheme);
// 跨 renderer 即时生效：监听 changed（其它窗口改了主题也跟随）。
window.desksoul.on('app.prefs.changed', (p) => {
  if (p.key === 'display.theme') {
    currentTheme = p.value as Prefs['display.theme'];
    applyTheme(currentTheme);
  }
});

createApp(App).mount('#app');
