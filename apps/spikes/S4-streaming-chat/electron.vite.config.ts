import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

// S4 has two renderers — the UI Overlay (text stream) and the Character window
// (emotion display). electron-vite builds them as two HTML inputs under one
// renderer build; Main picks which HTML to load per window.
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
    build: {
      rollupOptions: {
        input: {
          overlay: resolve(__dirname, 'src/renderer/overlay/index.html'),
          character: resolve(__dirname, 'src/renderer/character/index.html'),
        },
      },
    },
  },
});
