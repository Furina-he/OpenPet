import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: { entry: 'electron/main/index.ts' },
      rollupOptions: { external: ['electron'] },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { lib: { entry: 'electron/preload/index.ts' } },
  },
  renderer: {
    root: 'src/renderer',
    // Serve the project-level public/ so /models/sample.vrm resolves per plan.
    publicDir: resolve(__dirname, 'public'),
    build: { rollupOptions: { input: { index: 'src/renderer/index.html' } } },
  },
});
