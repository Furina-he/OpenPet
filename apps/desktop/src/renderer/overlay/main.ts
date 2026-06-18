import { createApp } from 'vue';
import App from './App.vue';
import '../theme/tokens.css';
import { subscribeTheme } from '../theme/subscribe';
import { installMockBridge } from '../dev/mock-bridge';

installMockBridge();
subscribeTheme();
createApp(App).mount('#app');
