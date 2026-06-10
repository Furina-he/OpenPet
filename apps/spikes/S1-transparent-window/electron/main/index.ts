import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function createWindow(): Promise<void> {
  const preloadPath = path.join(__dirname, '../preload/index.mjs');
  console.log('[S1 main] __dirname:', __dirname);
  console.log('[S1 main] preload path:', preloadPath);

  const win = new BrowserWindow({
    width: 320,
    height: 480,
    frame: false,
    transparent: true,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: preloadPath,
      // Electron 在 transparent:true + sandbox:true 下 preload 静默失败(已知限制)。
      // Character 窗口必须透明,所以 sandbox:false 是必要妥协。contextIsolation 仍开启。
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    await win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    await win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

// alpha 命中穿透:renderer 测出光标处 alpha 低于阈值时让本窗口忽略鼠标事件,
// forward:true 让事件落到下层(桌面/其他窗口),本窗口仍能继续收 mousemove。
ipcMain.handle('s1:set-click-through', (e, ignore: unknown) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  win?.setIgnoreMouseEvents(Boolean(ignore), { forward: true });
});

// 长按拖拽:renderer 算出位移增量,main 直接挪窗口。
ipcMain.handle('s1:window-move-by', (e, dx: unknown, dy: unknown) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win) return;
  const [x, y] = win.getPosition();
  win.setPosition(x + Math.round(Number(dx)), y + Math.round(Number(dy)));
});

app.whenReady().then(() => {
  void createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
