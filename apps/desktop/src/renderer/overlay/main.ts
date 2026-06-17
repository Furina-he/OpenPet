import { createApp } from 'vue';
import App from './App.vue';
import '../theme/tokens.css';
import { subscribeTheme } from '../theme/subscribe';

subscribeTheme();
createApp(App).mount('#app');
