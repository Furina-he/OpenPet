/**
 * 三窗口编排（tech-design §2）：
 *  - character：透明无边框桌宠窗口。Electron 已知限制：transparent:true 与
 *    sandbox:true 冲突（preload 静默失败，S1 实证），必须 sandbox:false；
 *    contextIsolation 保持开启，preload 只暴露 rpc/on，Main 路由层 Zod 校验兜底。
 *  - overlay：聊天/操作浮层（全沙箱）。
 *  - settings：常驻隐藏，按需 show（全沙箱）。
 * 所有窗口挂 render-process-gone 自愈：崩溃即 reload（进程级隔离由 Chromium 保证）。
 */
import { BrowserWindow, screen, type WebContents } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRELOAD = path.join(__dirname, '../preload/index.cjs');

export interface AppWindows {
  character: BrowserWindow;
  overlay: BrowserWindow;
  settings: BrowserWindow;
}

async function loadRenderer(
  win: BrowserWindow,
  name: 'character' | 'overlay' | 'settings',
): Promise<void> {
  if (process.env.ELECTRON_RENDERER_URL) {
    await win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/${name}/index.html`);
  } else {
    await win.loadFile(path.join(__dirname, `../renderer/${name}/index.html`));
  }
}

function attachCrashRecovery(win: BrowserWindow, name: string): void {
  win.webContents.on('render-process-gone', (_e, details) => {
    if (details.reason === 'clean-exit') return;
    console.warn(`[windows] ${name} renderer gone (${details.reason}); reloading`);
    if (!win.isDestroyed()) win.webContents.reload();
  });
}

export function createAppWindows(): AppWindows {
  const { workArea } = screen.getPrimaryDisplay();
  const margin = 24;

  const character = new BrowserWindow({
    width: 320,
    height: 480,
    x: workArea.x + workArea.width - 320 - margin,
    y: workArea.y + workArea.height - 480 - margin,
    frame: false,
    transparent: true,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: PRELOAD,
      sandbox: false, // 透明窗口必须；见文件头注释
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false, // 失焦不降频，表情驱动不卡顿
    },
  });

  const overlay = new BrowserWindow({
    width: 420,
    height: 560,
    x: workArea.x + workArea.width - 320 - margin - 420 - 16,
    y: workArea.y + workArea.height - 560 - margin,
    webPreferences: {
      preload: PRELOAD,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const settings = new BrowserWindow({
    width: 720,
    height: 520,
    show: false,
    webPreferences: {
      preload: PRELOAD,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  attachCrashRecovery(character, 'character');
  attachCrashRecovery(overlay, 'overlay');
  attachCrashRecovery(settings, 'settings');

  void loadRenderer(character, 'character');
  void loadRenderer(overlay, 'overlay');
  void loadRenderer(settings, 'settings');

  return { character, overlay, settings };
}

export function rendererTargets(wins: AppWindows): () => WebContents[] {
  return () =>
    [wins.character, wins.overlay, wins.settings]
      .filter((w) => !w.isDestroyed())
      .map((w) => w.webContents);
}
