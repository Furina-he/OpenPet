import { createApp } from 'vue';
import App from './App.vue';
import '../theme/tokens.css';
import { subscribeTheme } from '../theme/subscribe';
import { installMockBridge } from '../dev/mock-bridge';
import { createDsI18n } from '../i18n';

installMockBridge();
subscribeTheme();
// 批次④ 热切换：整页重载重拉快照（新角色的会话历史，角色隔离）。
window.openpet.on('character.changed', () => {
  location.reload();
});
createApp(App).use(createDsI18n()).mount('#app');
