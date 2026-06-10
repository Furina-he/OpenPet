import { app, BrowserWindow, ipcMain, net, safeStorage } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PluginHost, type Egress } from './plugin-host.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The sandboxed worker ships as plain .mjs (not bundled by electron-vite); resolve
// it relative to the built main (out/main → package root → worker/).
const WORKER = path.join(__dirname, '../../worker/sandbox-worker.mjs');

let panelWin: BrowserWindow | null = null;
let host: PluginHost | null = null;

/**
 * Production egress: Electron's `net.request` (uses the OS network stack, honours
 * system proxy). This is the only code path with real network reach — the worker
 * can only ask the host to make a request on its behalf.
 */
const netEgress: Egress = (url, init) =>
  new Promise((resolve, reject) => {
    const req = net.request({ method: init.method, url });
    for (const [k, v] of Object.entries(init.headers)) req.setHeader(k, v);
    req.on('response', (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(Buffer.from(c)));
      res.on('end', () =>
        resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }),
      );
    });
    req.on('error', reject);
    if (init.body) req.write(init.body);
    req.end();
  });

/**
 * Production key resolver. In a real build the per-provider API key is stored
 * encrypted via `safeStorage` and decrypted here, in Main, at request time — it
 * never crosses into the worker. The spike has no stored key, so this returns a
 * placeholder only for whitelisted hosts to demonstrate the injection point.
 */
function keyForHost(host: string): string | null {
  if (host !== 'api.openai.com') return null;
  // Placeholder: in production, read ciphertext from disk and:
  //   return safeStorage.decryptString(Buffer.from(ciphertext, 'base64'));
  return safeStorage.isEncryptionAvailable() ? 'sk-demo-injected-by-main' : 'sk-demo';
}

function createWindow(): void {
  panelWin = new BrowserWindow({
    width: 560,
    height: 640,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.mjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    void panelWin.loadURL(`${process.env.ELECTRON_RENDERER_URL}/panel/index.html`);
  } else {
    void panelWin.loadFile(path.join(__dirname, '../renderer/panel/index.html'));
  }
  panelWin.on('closed', () => (panelWin = null));
}

app.whenReady().then(() => {
  ipcMain.handle('desksoul:rpc', async (_e, { method }: { method: string }) => {
    if (method === 'sandbox.run') {
      // Fresh jail per run so probes start from a clean worker.
      await host?.dispose();
      const blocked: string[] = [];
      host = new PluginHost(WORKER, {
        allowedHosts: ['api.openai.com'],
        keyForHost,
        egress: netEgress,
        onBlocked: (h) => blocked.push(h),
      });
      const probes = await host.run(
        'https://api.openai.com/v1/models',
        'https://evil.example.com/steal',
      );
      return { ok: true, probes, blocked };
    }
    throw Object.assign(new Error(`Method not found: ${method}`), { code: -32601 });
  });
  createWindow();
});

app.on('window-all-closed', () => {
  void host?.dispose();
  if (process.platform !== 'darwin') app.quit();
});
