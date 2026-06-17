import { app, screen, protocol } from 'electron';
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
import { createPrefsStore, createPrefEffects } from './prefs/index.js';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 必须在 app ready 前注册（Electron 限制）；ready 后调用会静默不生效。
protocol.registerSchemesAsPrivileged(assetSchemePrivileges());

let wins: AppWindows | null = null;
let router: { dispose: () => Promise<void> } | null = null;
let cursorPublisher: { stop: () => void } | null = null;

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
  const providerConfig = createProviderConfig({ keychain });
  const providerService = createProviderService({ keychain, httpGetJson: electronHttpGetJson });
  const dataDir = path.join(app.getPath('userData'), 'data');
  mkdirSync(dataDir, { recursive: true });
  const prefsStore = createPrefsStore({ prefsPath: path.join(dataDir, 'prefs.json') });
  const prefEffects = createPrefEffects();
  router = registerIpcRouter({
    targets: rendererTargets(wins),
    characterWindow: () => (wins && !wins.character.isDestroyed() ? wins.character : null),
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
    prefEffects,
  });
  cursorPublisher = startCursorPublisher({
    getCursor: () => screen.getCursorScreenPoint(),
    send: (p) => {
      const win = wins && !wins.character.isDestroyed() ? wins.character : null;
      win?.webContents.send('desksoul:notify:behavior.lookAt', p);
    },
  });

  // settings 常驻 hidden，不算"还开着"；两个可见窗口都关 = 退出。
  const maybeQuit = (): void => {
    if (wins && wins.character.isDestroyed() && wins.overlay.isDestroyed()) app.quit();
  };
  wins.character.on('closed', maybeQuit);
  wins.overlay.on('closed', maybeQuit);
});

app.on('before-quit', () => {
  cursorPublisher?.stop();
  cursorPublisher = null;
  void router?.dispose();
  router = null;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
