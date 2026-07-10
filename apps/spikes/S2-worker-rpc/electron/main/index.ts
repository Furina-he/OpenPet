import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { PluginHost } from './plugin-host.js';
import { registerRpc } from './ipc-router.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

let host: PluginHost | null = null;

async function createWindow(): Promise<void> {
  const win = new BrowserWindow({
    width: 640,
    height: 480,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.mjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    await win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    await win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  const entry = require.resolve('@openpet/sidecar/dist/worker-entry.js');
  host = new PluginHost(entry, {
    onRespawnScheduled: (waitMs) => console.log(`[PluginHost] respawn in ${waitMs}ms`),
  });
  registerRpc(host);
  void createWindow();
});

app.on('window-all-closed', () => {
  void host?.dispose();
  if (process.platform !== 'darwin') app.quit();
});
