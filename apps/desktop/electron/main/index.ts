import { app, Menu, screen, protocol, shell, globalShortcut, dialog } from 'electron';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { resolveChatTarget } from '@openpet/protocol';
import { createAppWindows, rendererTargets, type AppWindows } from './windows.js';
import { registerIpcRouter } from './ipc-router.js';
import { assetSchemePrivileges, registerAssetProtocol } from './asset-protocol.js';
import { startCursorPublisher } from './cursor-publisher.js';
import { electronHttpAgent, electronHttpGetJson } from './http-agent.js';
import { Keychain } from './keychain.js';
import { createProviderConfig } from './provider-config.js';
import { createProviderService } from './provider-service.js';
import { connectMcpServer } from './mcp-transports.js';
import { runProviderMigrationIfNeeded } from './startup-provider-migrate.js';
import { applyPendingImport } from './db/import-data.js';
import { createPrefsStore } from './prefs/index.js';
import { createAppService } from './app-service.js';
import { decideStartup } from './startup.js';
import { createFullscreenWatch, type FullscreenWatch } from './fullscreen-watch.js';
import { createHotkeyService } from './hotkey-service.js';
import { menuLabels } from './menu-labels.js';
import { PerfMarks } from './perf-marks.js';
import { createTray, type TrayHandle } from './tray-service.js';
import * as appActions from './app-actions.js';
import { migrateUserData } from './user-data-migrate.js';
import { resolveNativeDir, toUnpackedPath } from './packaged-paths.js';
import { createUpdateService, type UpdateMode } from './update-service.js';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 改名 openpet（2026-07-09）：setName 必须先于一切 app.getPath('userData') 调用。
// 旧 userData 实测 = %APPDATA%\@desksoul\desktop（Electron 由改名前的 package.json name 派生的嵌套目录）。
app.setName('openpet');
migrateUserData(
  [path.join(app.getPath('appData'), '@desksoul', 'desktop')],
  path.join(app.getPath('appData'), 'openpet'),
);

// 必须在 app ready 前注册（Electron 限制）；ready 后调用会静默不生效。
protocol.registerSchemesAsPrivileged(assetSchemePrivileges());

let wins: AppWindows | null = null;
let router: ReturnType<typeof registerIpcRouter> | null = null;
let cursorPublisher: { stop: () => void } | null = null;
let fsWatch: FullscreenWatch | null = null;
let hotkeys: ReturnType<typeof createHotkeyService> | null = null;
let tray: TrayHandle | null = null;
let updateSvc: ReturnType<typeof createUpdateService> | null = null;
let trayThinking = false;
let trayError = false;
let isQuitting = false;
// 性能埋点：进程顶部 mark，character 窗首次加载完成 = 冷启动终点（PRD §7 预算 <3s）。
const perf = new PerfMarks();
perf.mark('boot');

app.whenReady().then(async () => {
  // 去掉默认应用菜单（File/Edit/View…）：产品窗口不需要；dev 的 devtools 走 F12（windows.ts）。
  Menu.setApplicationMenu(null);
  // sidecar 的 worker entry 必须以真实文件路径喂给 new Worker()，不能被 bundle
  //（turbo 的 ^build 保证 dist 先于 desktop 构建存在）。打包后 sidecar 及依赖已
  // asarUnpack（worker_threads 无 asar hook），路径重写到 app.asar.unpacked。
  const providerEntryPath = toUnpackedPath(
    require.resolve('@openpet/sidecar/dist/workers/provider-worker-entry.js'),
  );
  // 角色包根：dev 在仓库 apps/desktop/characters（out/main 的上两级）；
  // 打包后 electron-builder extraResources 落在 resources/characters。
  const charactersRoot = app.isPackaged
    ? path.join(process.resourcesPath, 'characters')
    : path.join(__dirname, '../../characters');
  // 批次④ 导入包根（userData/characters）；asset:// 双根顺序与 character-service.rootOf 一致：内置优先。
  const importedCharactersRoot = path.join(app.getPath('userData'), 'characters');
  // 线 B-2 Desktop 插件：worker entry 同 provider 手法（真实文件路径喂 new Worker）；安装根 userData/plugins。
  const pluginEntryPath = toUnpackedPath(require.resolve('@openpet/sidecar/dist/plugin-entry.js'));
  const pluginsRoot = path.join(app.getPath('userData'), 'plugins');
  // 线 B-2 Star 宿主：shim 目录随包走（dev 在仓库 resources/，打包 extraResources）；插件/venv 在 userData。
  const starHostDir = app.isPackaged
    ? path.join(process.resourcesPath, 'star-host')
    : path.join(__dirname, '../../resources/star-host');
  const starPluginsDir = path.join(app.getPath('userData'), 'star-plugins');
  const starVenvDir = path.join(app.getPath('userData'), 'star-host', 'venv');

  registerAssetProtocol([charactersRoot, importedCharactersRoot], {
    // Cubism Core 三级加载链后两级（⑪ 发布批次）：打包 resources/cubism → userData/cubism。
    // 专有许可不随包分发；用户自置 userData\cubism\live2dcubismcore.min.js（角色页/手册引导）。
    cubism: [
      path.join(process.resourcesPath, 'cubism'),
      path.join(app.getPath('userData'), 'cubism'),
    ],
  });
  wins = createAppWindows();
  wins.character.webContents.once('did-finish-load', () => perf.measure('boot', 'cold-start'));
  // 每 5min 打 rss（仅 developerMode 开时，避免刷日志）；数字由用户真窗实测记 RESULTS。
  setInterval(
    () => {
      if (prefsStore.getAll()['general.developerMode'] === true) {
        console.info(`[perf] rss ${Math.round(process.memoryUsage().rss / 1048576)}MB`);
      }
    },
    5 * 60_000,
  );
  const keychain = new Keychain(path.join(app.getPath('userData'), 'secrets.kc'));
  const dataDir = path.join(app.getPath('userData'), 'data');
  mkdirSync(dataDir, { recursive: true });
  const prefsPath = path.join(dataDir, 'prefs.json');
  // 批次⑥ arch#4：旧 model.* 键已出 PrefsSchema——迁移器改吃原始 JSON（文件不存在/坏 JSON → {} 跳过）。
  let rawPrefs: Record<string, unknown> = {};
  try {
    rawPrefs = JSON.parse(readFileSync(prefsPath, 'utf8')) as Record<string, unknown>;
  } catch {
    /* 首启无文件 / 坏 JSON → 无旧键可迁 */
  }
  const prefsStore = createPrefsStore({ prefsPath });
  // 启动一次性：旧单 provider 配置（含 keychain 明文 key）→ 两层 Source+Model（用户裁定 key 随 source 存）。
  await runProviderMigrationIfNeeded({
    getPrefs: () => prefsStore.getAll(),
    setPref: (k, v) => prefsStore.set(k, v),
    rawPrefs,
    keyLookup: async (pid) => (await keychain.get(pid, 'apiKey')) ?? '',
  });
  const providerConfig = createProviderConfig({ getPrefs: () => prefsStore.getAll() });
  const providerService = createProviderService({
    httpGetJson: electronHttpGetJson,
    getPrefs: () => prefsStore.getAll(),
    setPref: (k, v) => prefsStore.set(k, v),
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
    for (const wc of targets()) if (!wc.isDestroyed()) wc.send(`openpet:notify:${channel}`, params);
    // i18n：语言切换 → 托盘菜单按新字典重建（角色右键菜单每次 popup 现取，无需处理）。
    if (
      channel === 'app.prefs.changed' &&
      (params as { key?: string })?.key === 'general.language'
    ) {
      tray?.refreshMenu();
    }
  };
  // 批次⑥ D7：上次会话若 stage 了 .dsbak 导入（<sqlitePath>.import），建 store 前原子换库
  //（旧库转 .bak-<ts> 兜底）。必须先于 registerIpcRouter（它持 DB 单连接）。
  const sqlitePath = path.join(dataDir, 'sessions.db');
  applyPendingImport(sqlitePath);
  // ⑪ 自动更新：dev/portable 门控；electron-updater CJS 动态载入（仅 packaged 需要）。
  const updateMode: UpdateMode = !app.isPackaged
    ? 'dev'
    : process.env.PORTABLE_EXECUTABLE_DIR
      ? 'portable'
      : 'packaged';
  const { autoUpdater } = (require('electron-updater') as typeof import('electron-updater'));
  const updateService = createUpdateService({
    updater: autoUpdater,
    mode: updateMode,
    getPrefs: () => prefsStore.getAll(),
    broadcast,
    confirmInstall: async () => {
      const zh = String(prefsStore.getAll()['general.language'] ?? 'zh-CN').startsWith('zh');
      const r = await dialog.showMessageBox({
        type: 'question',
        buttons: zh ? ['重启并更新', '稍后'] : ['Restart & Update', 'Later'],
        defaultId: 0,
        cancelId: 1,
        message: zh ? '更新已就绪' : 'Update ready',
        detail: zh
          ? '重启 OpenPet 以完成安装。你的对话与数据不受影响。'
          : 'Restart OpenPet to finish installing. Your chats and data are unaffected.',
      });
      return r.response === 0;
    },
  });
  router = registerIpcRouter({
    targets,
    characterWindow,
    settingsWindow,
    onboardingWindow,
    overlayWindow,
    charactersRoot,
    importedCharactersRoot,
    pickCharacterPath: async (kind) => {
      const r = await dialog.showOpenDialog({
        properties: kind === 'folder' ? ['openDirectory'] : ['openFile'],
        ...(kind === 'pack'
          ? { filters: [{ name: 'openpet 角色包', extensions: ['dspack', 'zip'] }] }
          : {}),
      });
      return r.canceled ? null : (r.filePaths[0] ?? null);
    },
    // ⑩.7 E4：导出 .dspack 保存框 + 在文件夹中显示
    pickDspackSave: async (defaultName) => {
      const r = await dialog.showSaveDialog({
        defaultPath: defaultName,
        filters: [{ name: 'openpet 角色包', extensions: ['dspack'] }],
      });
      return r.canceled ? null : (r.filePath ?? null);
    },
    revealItem: (fullPath) => shell.showItemInFolder(fullPath),
    pluginsRoot,
    pluginEntryPath,
    pickPluginPath: async (kind) => {
      const r = await dialog.showOpenDialog({
        properties: kind === 'folder' ? ['openDirectory'] : ['openFile'],
        ...(kind === 'dsplug'
          ? { filters: [{ name: 'openpet 插件包', extensions: ['dsplug', 'zip'] }] }
          : {}),
      });
      return r.canceled ? null : (r.filePaths[0] ?? null);
    },
    starHostDir,
    starPluginsDir,
    starVenvDir,
    // ⑩.6 音色工坊：参考音频根（删除音色即清 <voiceId>/ 子目录）
    voicesDir: path.join(app.getPath('userData'), 'voices'),
    pickStarPath: async (kind) => {
      const r = await dialog.showOpenDialog({
        properties: kind === 'folder' ? ['openDirectory'] : ['openFile'],
        ...(kind === 'zip'
          ? { filters: [{ name: 'AstrBot 插件包', extensions: ['zip'] }] }
          : {}),
      });
      return r.canceled ? null : (r.filePaths[0] ?? null);
    },
    pickKbFile: async () => {
      const r = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: '文档', extensions: ['txt', 'md', 'pdf'] }],
      });
      return r.canceled ? null : (r.filePaths[0] ?? null);
    },
    pickDsbakOpen: async () => {
      const r = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'openpet 备份', extensions: ['dsbak'] }],
      });
      return r.canceled ? null : (r.filePaths[0] ?? null);
    },
    pickDsbakSave: async () => {
      const r = await dialog.showSaveDialog({
        defaultPath: `openpet-${new Date().toISOString().slice(0, 10)}.dsbak`,
        filters: [{ name: 'openpet 备份', extensions: ['dsbak'] }],
      });
      return r.canceled ? null : (r.filePath ?? null);
    },
    pickMarkdownSave: async (defaultName) => {
      const r = await dialog.showSaveDialog({
        defaultPath: `${defaultName}.md`,
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      });
      return r.canceled ? null : (r.filePath ?? null);
    },
    openDataDir: () => void shell.openPath(app.getPath('userData')),
    relaunch: () => {
      app.relaunch();
      app.exit(0);
    },
    providerEntryPath,
    sqlitePath,
    nativeDir: resolveNativeDir(app.isPackaged, process.resourcesPath, app.getAppPath()),
    // 打包版 sqlite 失败即响（P0）：静默内存库=数据丢失事故；dev 保持降级告警。
    requireNativeStore: app.isPackaged,
    onStoreFatal: (message) => {
      dialog.showErrorBox('OpenPet 无法启动', message);
      app.exit(1);
    },
    fetch: {
      agent: electronHttpAgent,
      resolveHost: (url) => providerConfig.resolveHost(url),
      injectAuth: (providerId, url, headers) => providerConfig.injectAuth(providerId, url, headers),
    },
    defaultProviderId: process.env.OPENPET_DEFAULT_PROVIDER ?? 'openai',
    providerService,
    mcpConnectFactory: connectMcpServer,
    prefsStore,
    setLoginItem: (open) => app.setLoginItemSettings({ openAtLogin: open }),
    appService: createAppService({ openExternal: (url) => shell.openExternal(url) }),
    appVersion: app.getVersion(),
    diagPath: path.join(dataDir, 'openpet.dsdiag'),
    updateService,
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
  // 周期检查（启动 30s + 24h；dev/portable 内部 no-op）
  updateSvc = updateService;
  updateService.start();
  cursorPublisher = startCursorPublisher({
    getCursor: () => screen.getCursorScreenPoint(),
    send: (p) => {
      const win = wins && !wins.character.isDestroyed() ? wins.character : null;
      win?.webContents.send('openpet:notify:behavior.lookAt', p);
    },
  });

  // A4 全屏检测（best-effort）：probe 默认恒 false（真机校准前退化为仅手动隐藏）。
  // 状态变化沿广播 app.desktopState，character 据此切隐藏/淡出。
  fsWatch = createFullscreenWatch({
    probe: () => false, // TODO(真机)：接 Win 前台窗矩形检测；不可靠则保持 false
    onChange: (fullscreen) => {
      const c = wins && !wins.character.isDestroyed() ? wins.character : null;
      c?.webContents.send('openpet:notify:app.desktopState', { fullscreen });
      // F-IT-06 全屏让位：隐藏前小挥手（cue 表 desktop.fullscreen，30s 冷却）。
      router?.notifyDesktopState(fullscreen);
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
    labels: () => menuLabels(String(prefsStore.getAll()['general.language'] ?? 'zh-CN')),
    // 批次⑥ arch#4：已连接 = 新工作台两层解析出默认 chat 目标（旧 activeProvider 键已删）。
    connected: () => {
      const p = prefsStore.getAll();
      return (
        resolveChatTarget(
          p['model.providerSources'],
          p['model.models'],
          p['model.defaultChatModelId'],
        ) !== null
      );
    },
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
  // 聊天浮层同样是持久窗口：关闭(× / closeOverlay 的 window.close) = 收起，可被「跟它聊一聊」/
  // 托盘/热键再次 show 唤出（否则销毁后 overlayWindow() 返 null，showChat 无效）。
  wins.overlay.on('close', (e) => {
    if (!isQuitting && wins && !wins.overlay.isDestroyed()) {
      e.preventDefault();
      wins.overlay.hide();
    }
  });
});

app.on('before-quit', () => {
  isQuitting = true;
  globalShortcut.unregisterAll();
  updateSvc?.stop();
  updateSvc = null;
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
