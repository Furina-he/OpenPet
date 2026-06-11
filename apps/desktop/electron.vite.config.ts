import { resolve } from 'node:path';
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
    build: {
      lib: { entry: 'electron/preload/index.ts' },
      // sandbox renderer 只支持 CJS preload（S4 实证：ESM preload 静默失败）
      rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } },
    },
  },
  renderer: {
    root: 'src/renderer',
    plugins: [vue()],
    build: {
      rollupOptions: {
        input: {
          character: resolve(__dirname, 'src/renderer/character/index.html'),
          overlay: resolve(__dirname, 'src/renderer/overlay/index.html'),
          settings: resolve(__dirname, 'src/renderer/settings/index.html'),
        },
      },
    },
  },
});
