import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: { entry: 'electron/main/index.ts' },
      rollupOptions: { external: ['better-sqlite3', 'electron'] },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { lib: { entry: 'electron/preload/index.ts' } },
  },
  renderer: {
    root: 'src/renderer',
    plugins: [vue()],
    build: { rollupOptions: { input: { index: 'src/renderer/index.html' } } },
  },
});
