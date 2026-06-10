import { app, BrowserWindow, type WebContents } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { registerRpc } from './ipc-router.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

let overlayWin: BrowserWindow | null = null;
let characterWin: BrowserWindow | null = null;
let router: { dispose: () => Promise<void> } | null = null;

/** Load a named renderer entry — electron-vite serves each input under its key in dev. */
async function loadRenderer(win: BrowserWindow, name: 'overlay' | 'character'): Promise<void> {
  if (process.env.ELECTRON_RENDERER_URL) {
    await win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/${name}/index.html`);
  } else {
    await win.loadFile(path.join(__dirname, `../renderer/${name}/index.html`));
  }
}

function createWindows(): void {
  const preload = path.join(__dirname, '../preload/index.mjs');
  const webPreferences = {
    preload,
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
  };

  overlayWin = new BrowserWindow({ width: 460, height: 600, x: 80, y: 80, webPreferences });
  characterWin = new BrowserWindow({ width: 360, height: 480, x: 580, y: 80, webPreferences });

  void loadRenderer(overlayWin, 'overlay');
  void loadRenderer(characterWin, 'character');

  overlayWin.on('closed', () => (overlayWin = null));
  characterWin.on('closed', () => (characterWin = null));
}

app.whenReady().then(() => {
  const providerEntryPath = require.resolve('@desksoul/sidecar/dist/workers/provider-worker-entry.js');
  router = registerRpc({
    providerEntryPath,
    targets: (): WebContents[] =>
      [overlayWin, characterWin]
        .filter((w): w is BrowserWindow => w !== null)
        .map((w) => w.webContents),
  });
  createWindows();
});

app.on('window-all-closed', () => {
  void router?.dispose();
  if (process.platform !== 'darwin') app.quit();
});
