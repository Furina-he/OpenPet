import { app, screen, protocol, shell, globalShortcut } from 'electron';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createAppWindows, rendererTargets, type AppWindows } from './windows.js';
import { registerIpcRouter } from './ipc-router.js';
import { assetSchemePrivileges, registerAssetProtocol } from './asset-protocol.js';
import { startCursorPublisher } from './cursor-publisher.js';
import { electronHttpAgent, electronHttpGetJson } from './http-agent.js';
import { Keychain } from './keychain.js';
import { createProviderConfig } from './provider-config.js';
import { createProviderService } from './provider-service.js';
import { createPrefsStore } from './prefs/index.js';
import { createAppService } from './app-service.js';
import { decideStartup } from './startup.js';
import { createFullscreenWatch, type FullscreenWatch } from './fullscreen-watch.js';
import { createHotkeyService } from './hotkey-service.js';
import { createTray, type TrayHandle } from './tray-service.js';
import * as appActions from './app-actions.js';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 必须在 app ready 前注册（Electron 限制）；ready 后调用会静默不生效。
protocol.registerSchemesAsPrivileged(assetSchemePrivileges());

let wins: AppWindows | null = null;
let router: { dispose: () => Promise<void> } | null = null;
let cursorPublisher: { stop: () => void } | null = null;
let fsWatch: FullscreenWatch | null = null;
let hotkeys: ReturnType<typeof createHotkeyService> | null = null;
let tray: TrayHandle | null = null;
let trayThinking = false;
let trayError = false;
let isQuitting = false;

app.whenReady().then(() => {
  // sidecar 的 worker entry 必须以真实文件路径喂给 new Worker()，不能被 bundle
  //（turbo 的 ^build 保证 dist 先于 desktop 构建存在）。
  const providerEntryPath = require.resolve(
    '@desksoul/sidecar/dist/workers/provider-worker-entry.js',
  );
  // 角色包根：dev 在仓库 apps/desktop/characters（out/main 的上两级）；
  // 打包后 electron-builder extraResources 落在 resources/characters。
  const charactersRoot = app.isPackaged
    ? path.join(process.resourcesPath, 'characters')
    : path.join(__dirname, '../../characters');

  registerAssetProtocol(charactersRoot);
  wins = createAppWindows();
  const keychain = new Keychain(path.join(app.getPath('userData'), 'secrets.kc'));
  const dataDir = path.join(app.getPath('userData'), 'data');
  mkdirSync(dataDir, { recursive: true });
  const prefsStore = createPrefsStore({ prefsPath: path.join(dataDir, 'prefs.json') });
  const providerConfig = createProviderConfig({ keychain, getPrefs: () => prefsStore.getAll() });
  const providerService = createProviderService({
    keychain,
    httpGetJson: electronHttpGetJson,
    getPrefs: () => prefsStore.getAll(),
  });
  // 窗口定位器 + 广播：registerIpcRouter 与 J2 热键（app-actions）共用同一组，避免重复。
  const targets = rendererTargets(wins);
  const characterWindow = () =>
    wins && !wins.character.isDestroyed() ? wins.character : null;
  const overlayWindow = () => (wins && !wins.overlay.isDestroyed() ? wins.overlay : null);
  const settingsWindow = () => (wins && !wins.settings.isDestroyed() ? wins.settings : null);
  const onboardingWindow = () =>
    wins && !wins.onboarding.isDestroyed() ? wins.onboarding : null;
  const broadcast = (channel: string, params: unknown): void => {
    for (const wc of targets()) if (!wc.isDestroyed()) wc.send(`desksoul:notify:${channel}`, params);
  };
  router = registerIpcRouter({
    targets,
    characterWindow,
    settingsWindow,
    onboardingWindow,
    overlayWindow,
    charactersRoot,
    providerEntryPath,
    sqlitePath: path.join(dataDir, 'sessions.db'),
    fetch: {
      agent: electronHttpAgent,
      resolveHost: (url) => providerConfig.resolveHost(url),
      injectAuth: (providerId, url, headers) => providerConfig.injectAuth(providerId, url, headers),
    },
    defaultProviderId: process.env.DESKSOUL_DEFAULT_PROVIDER ?? 'openai',
    providerService,
    prefsStore,
    setLoginItem: (open) => app.setLoginItemSettings({ openAtLogin: open }),
    appService: createAppService({ openExternal: (url) => shell.openExternal(url) }),
    appVersion: app.getVersion(),
    diagPath: path.join(dataDir, 'desksoul.dsdiag'),
    // J1 托盘三态：thinking=streaming 中，error=最近一轮 error（仅状态变化时刷新图标）。
    onBroadcast: (channel, params) => {
      if (channel === 'chat.stream') {
        if (!trayThinking) {
          trayThinking = true;
          trayError = false;
          tray?.setState({ thinking: trayThinking, error: trayError });
        }
      } else if (channel === 'chat.done') {
        trayThinking = false;
        trayError = (params as { finishReason?: string }).finishReason === 'error';
        tray?.setState({ thinking: trayThinking, error: trayError });
      } else if (
        channel === 'app.prefs.changed' &&
        typeof (params as { key?: string }).key === 'string' &&
        (params as { key: string }).key.startsWith('hotkeys.')
      ) {
        // J2：热键 pref 改动即重注册（录制器保存后立即生效）。
        hotkeys?.apply(prefsStore.getAll());
      }
    },
  });

  // M7b-2 首启：未完成引导 → 收起 overlay、弹引导窗（character 照常显示，"先看到角色"）。
  if (decideStartup(prefsStore.getAll()).showOnboarding) {
    wins.overlay.hide();
    wins.onboarding.show();
  }
  cursorPublisher = startCursorPublisher({
    getCursor: () => screen.getCursorScreenPoint(),
    send: (p) => {
      const win = wins && !wins.character.isDestroyed() ? wins.character : null;
      win?.webContents.send('desksoul:notify:behavior.lookAt', p);
    },
  });

  // A4 全屏检测（best-effort）：probe 默认恒 false（真机校准前退化为仅手动隐藏）。
  // 状态变化沿广播 app.desktopState，character 据此切隐藏/淡出。
  fsWatch = createFullscreenWatch({
    probe: () => false, // TODO(真机)：接 Win 前台窗矩形检测；不可靠则保持 false
    onChange: (fullscreen) => {
      const c = wins && !wins.character.isDestroyed() ? wins.character : null;
      c?.webContents.send('desksoul:notify:app.desktopState', { fullscreen });
    },
    intervalMs: 1500,
  });

  // settings 常驻 hidden，不算"还开着"；两个可见窗口都关 = 退出。
  const maybeQuit = (): void => {
    if (wins && wins.character.isDestroyed() && wins.overlay.isDestroyed()) app.quit();
  };
  wins.character.on('closed', maybeQuit);
  wins.overlay.on('closed', maybeQuit);

  // J2 全局热键（prefs 驱动，替换硬编码 Ctrl+Shift+,）。动作复用 app-actions（与右键菜单/托盘同源）。
  hotkeys = createHotkeyService({
    globalShortcut,
    actions: {
      chat: () => appActions.showChat(overlayWindow),
      toggleHide: () => appActions.toggleCharacter(characterWindow),
      clickThrough: () => appActions.toggleClickThroughPref({ prefsStore, characterWindow, broadcast }),
      dnd: () => appActions.toggleDndPref({ prefsStore, broadcast }),
      openHub: () => appActions.openHub(settingsWindow),
    },
  });
  hotkeys.apply(prefsStore.getAll());

  // J1 系统托盘：三态图标 + 原生菜单（动作复用 app-actions，与右键菜单/热键同源）。
  const trayIconsDir = app.isPackaged
    ? path.join(process.resourcesPath, 'tray')
    : path.join(__dirname, '../../resources/tray');
  tray = createTray({
    iconsDir: trayIconsDir,
    version: app.getVersion(),
    connected: () => !!prefsStore.getAll()['model.activeProvider'],
    actions: {
      chat: () => appActions.showChat(overlayWindow),
      toggleVisible: () => appActions.toggleCharacter(characterWindow),
      toggleClickThrough: () =>
        appActions.toggleClickThroughPref({ prefsStore, characterWindow, broadcast }),
      toggleDnd: () => appActions.toggleDndPref({ prefsStore, broadcast }),
      openHub: () => appActions.openHub(settingsWindow),
      quit: () => {
        isQuitting = true;
        app.quit();
      },
    },
  });
  // Hub 是持久窗口：关闭 = 收起（hide），非销毁；真正退出时（isQuitting）放行。
  wins.settings.on('close', (e) => {
    if (!isQuitting && wins && !wins.settings.isDestroyed()) {
      e.preventDefault();
      wins.settings.hide();
    }
  });
});

app.on('before-quit', () => {
  isQuitting = true;
  globalShortcut.unregisterAll();
  cursorPublisher?.stop();
  cursorPublisher = null;
  fsWatch?.stop();
  fsWatch = null;
  tray?.destroy();
  tray = null;
  void router?.dispose();
  router = null;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
