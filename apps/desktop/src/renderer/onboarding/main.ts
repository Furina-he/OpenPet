import { createApp } from 'vue';
import App from './App.vue';
import '../theme/tokens.css';
import { subscribeTheme } from '../theme/subscribe';
import { installMockBridge } from '../dev/mock-bridge';
import { createDsI18n } from '../i18n';

installMockBridge();
subscribeTheme();
createApp(App).use(createDsI18n()).mount('#app');
