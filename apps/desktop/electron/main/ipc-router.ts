/**
 * IPC 路由接线 — Renderer ⇄ Main 的唯一缝。
 *
 * 进站：preload 的 `window.desksoul.rpc` → `ipcMain.handle('desksoul:rpc')` →
 *       纯 router（Zod 校验 + 分发）→ ChatService / CharacterService / 窗口操作。
 * 出站：ChatService 的背压队列 flush → 广播到所有窗口的
 *       `desksoul:notify:<channel>`；各 renderer 只订阅自己关心的 channel
 *       （overlay → chat.*，character → behavior.* + chat.done）。
 *       behavior.lookAt / 主动行为 playAction 只与 character 相关 → 经
 *       sendToCharacter 直发，不进背压队列（见 cursor-publisher.ts 头注释）。
 * 业务编排全部下沉到纯模块——本文件只做 Electron 缝。
 */
import { ipcMain, BrowserWindow, Menu, type WebContents } from 'electron';
import { ChatService } from './chat-service.js';
import { createRouter } from './router.js';
import { buildCharacterMenuTemplate } from './character-menu.js';
import * as appActions from './app-actions.js';
import { createCharacterService } from './character-service.js';
import { createConversationStore } from './db/index.js';
import { createIdleResponder } from './idle-responder.js';
import { scaledBounds, CHARACTER_BASE_SIZE } from './window-scale.js';
import {
  createPrefsStore,
  createPrefEffects,
  applyAllEffects,
  type PrefsStore,
  type PrefEffects,
} from './prefs/index.js';
import { createPrefsService } from './prefs-service.js';
import { createAppService } from './app-service.js';
import { createOnboardingService } from './onboarding-service.js';

export interface IpcRouterDeps {
  targets: () => WebContents[];
  /** character 窗口定位（setScale / 主动行为直发）。 */
  characterWindow: () => BrowserWindow | null;
  /** Hub（settings 窗口）定位器；index 注入。openHub RPC 用它 show+focus。 */
  settingsWindow?: () => BrowserWindow | null;
  /** 引导窗定位器（M7b-2）；finishOnboarding hide 它。 */
  onboardingWindow?: () => BrowserWindow | null;
  /** overlay 窗定位器（M7b-2）；finishOnboarding show 它。 */
  overlayWindow?: () => BrowserWindow | null;
  /** 角色包根目录（dev: apps/desktop/characters；打包: resources/characters）。 */
  charactersRoot: string;
  providerEntryPath: string;
  /** sessions.db 路径（生产 userData/data/sessions.db；测试省略=纯内存）。 */
  sqlitePath?: string;
  /** 代理 fetch 网关依赖（Electron net + 白名单 + Keychain 注入）；生产由 index.ts 注入。 */
  fetch?: import('./fetch-gateway.js').FetchGatewayDeps;
  /** 默认 provider id（chat.send 未指定时用）；M5 固定 'openai'，M7 接用户选择。 */
  defaultProviderId?: string;
  /** provider.* RPC handlers（M5）；index.ts 注入，spread 进 router。 */
  providerService?: ReturnType<typeof import('./provider-service.js').createProviderService>;
  /** 应用偏好持久化（M7a）；index.ts 注入 JsonPrefsStore。缺省纯内存（测试）。 */
  prefsStore?: PrefsStore;
  /** pref 副作用表（M7a 空 seam）。 */
  prefEffects?: PrefEffects;
  /** 开机自启动开关施加器（index 注入 app.setLoginItemSettings）。 */
  setLoginItem?: (open: boolean) => void;
  /** app.* 杂项 handlers（openExternal）；index 注入 shell.openExternal。 */
  appService?: ReturnType<typeof createAppService>;
  /** 每条出站通知的旁路观察者（J1 托盘据 chat.stream/done 切三态图标）。 */
  onBroadcast?: (channel: string, params: unknown) => void;
}

export interface RpcContext {
  win: BrowserWindow | null;
}

export function registerIpcRouter(deps: IpcRouterDeps): { dispose: () => Promise<void> } {
  const broadcast = (channel: string, params: unknown): void => {
    for (const wc of deps.targets()) {
      if (!wc.isDestroyed()) wc.send(`desksoul:notify:${channel}`, params);
    }
    deps.onBroadcast?.(channel, params);
  };
  const sendToCharacter = (channel: string, params: unknown): void => {
    const win = deps.characterWindow();
    if (win && !win.isDestroyed()) win.webContents.send(`desksoul:notify:${channel}`, params);
  };

  const store = createConversationStore(deps.sqlitePath ? { sqlitePath: deps.sqlitePath } : {});
  const characters = createCharacterService(deps.charactersRoot);
  // 应用偏好（M7a）：单写者 PrefsStore。在 ChatService 之前声明，供 resolveModel 读当前 provider/model。
  const prefsStore = deps.prefsStore ?? createPrefsStore({});
  const chat = new ChatService({
    providerEntryPath: deps.providerEntryPath,
    broadcast,
    store,
    character: () => {
      const c = characters.current();
      return {
        id: c.characterId,
        name: c.manifest.name,
        ...(c.manifest.emotions ? { emotions: Object.keys(c.manifest.emotions) } : {}),
        ...(c.manifest.actions ? { actions: c.manifest.actions } : {}),
      };
    },
    ...(deps.sqlitePath ? { sqlitePath: deps.sqlitePath } : {}),
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
    ...(deps.defaultProviderId ? { defaultProviderId: deps.defaultProviderId } : {}),
    // §7.1：chat.send 未带 providerId 时，动态读 prefs 的当前 provider/model（D3 选择即生效）。
    resolveModel: () => {
      const p = prefsStore.getAll();
      return {
        ...(p['model.activeProvider'] ? { providerId: p['model.activeProvider'] } : {}),
        ...(p['model.activeModel'] ? { model: p['model.activeModel'] } : {}),
      };
    },
  });
  const idleResponder = createIdleResponder(sendToCharacter);
  // character 窗口的期望尺寸真源：唯一合法的尺寸变更入口是 setScale。
  // Windows 非 100% DPI 下 setPosition 每次调用有 DIP↔物理像素舍入漂移
  //（125% 实测 40 次 moveBy 涨 36×53px），位置操作必须用 setBounds 锁回期望尺寸。
  let characterSize: { width: number; height: number } = { ...CHARACTER_BASE_SIZE };
  const prefEffects =
    deps.prefEffects ??
    createPrefEffects({
      characterWindow: deps.characterWindow,
      setLoginItem: deps.setLoginItem ?? (() => {}),
      setCharacterSize: (s) => {
        characterSize = s;
      },
      broadcast,
    });
  applyAllEffects(prefEffects, prefsStore.getAll());
  const prefsService = createPrefsService({ store: prefsStore, broadcast, effects: prefEffects });

  // A3 穿透切换真源：菜单/RPC 共用；逻辑在 app-actions（J1 托盘 / J2 热键同源，避免三份重复）。
  const toggleClickThroughPref = (): boolean =>
    appActions.toggleClickThroughPref({
      prefsStore,
      characterWindow: deps.characterWindow,
      broadcast,
    });
  const overlayWindow = deps.overlayWindow ?? (() => null);
  const settingsWindow = deps.settingsWindow ?? (() => null);

  const router = createRouter<RpcContext>({
    ...(deps.providerService ?? {}),
    ...prefsService,
    ...(deps.appService ?? {}),
    ...createOnboardingService({
      prefsStore,
      onboardingWindow: deps.onboardingWindow ?? (() => null),
      overlayWindow: deps.overlayWindow ?? (() => null),
    }),
    'sys.ping': (p) => ({ pong: 'ok', echoNonce: p.nonce }),
    'chat.send': (p) => chat.send(p.sessionId, p.text, p.providerId),
    'chat.cancel': (p) => chat.cancel(p.sessionId),
    'chat.snapshot': (p) => chat.snapshot(p.sessionId, p.limit),
    'app.storageUsage': () => chat.storageUsage(),
    'app.exportData': (p) => chat.exportData(p.outPath),
    'character.current': () => characters.current(),
    'character.tap': (p) => {
      // A1：把轻点转成 behavior 广播（character 哑播放器消费）。head→撒娇、body→点头。
      broadcast('behavior.applyEmotion', {
        name: p.zone === 'head' ? 'happy' : 'neutral',
        weight: 1,
      });
      broadcast('behavior.playAction', {
        name: p.zone === 'head' ? 'nuzzle' : 'nod',
        durationMs: null,
      });
      return { ok: true as const };
    },
    'character.setScale': (p) => {
      const win = deps.characterWindow();
      if (win && !win.isDestroyed()) {
        const b = scaledBounds(win.getBounds(), p.scale);
        characterSize = { width: b.width, height: b.height };
        win.setBounds(b);
      }
      return { ok: true as const };
    },
    'character.idleTimeout': (p) => {
      idleResponder.onIdleTimeout(p.idleMs);
      return { ok: true as const };
    },
    'app.window.setClickThrough': (p, ctx) => {
      ctx.win?.setIgnoreMouseEvents(p.ignore, { forward: true });
      return { ok: true as const };
    },
    'app.window.moveBy': (p, ctx) => {
      if (ctx.win) {
        const [x, y] = ctx.win.getPosition();
        const nx = x + Math.round(p.dx);
        const ny = y + Math.round(p.dy);
        if (ctx.win === deps.characterWindow()) {
          ctx.win.setBounds({ x: nx, y: ny, ...characterSize });
        } else {
          ctx.win.setPosition(nx, ny);
        }
      }
      return { ok: true as const };
    },
    'app.window.openHub': () => {
      appActions.openHub(settingsWindow);
      return { ok: true as const };
    },
    'app.window.showChat': () => {
      appActions.showChat(overlayWindow);
      return { ok: true as const };
    },
    'app.window.popCharacterMenu': () => {
      const menu = Menu.buildFromTemplate(
        buildCharacterMenuTemplate({
          chat: () => appActions.showChat(overlayWindow),
          toggleClickThrough: () => {
            toggleClickThroughPref();
          },
          toggleVisible: () => appActions.toggleCharacter(deps.characterWindow),
          openHub: () => appActions.openHub(settingsWindow),
        }),
      );
      const c = deps.characterWindow();
      if (c && !c.isDestroyed()) menu.popup({ window: c });
      return { ok: true as const };
    },
    'app.window.toggleClickThrough': () => ({
      ok: true as const,
      ignore: toggleClickThroughPref(),
    }),
  });

  ipcMain.handle('desksoul:rpc', (e, payload: { method?: unknown; params?: unknown }) => {
    const method = typeof payload?.method === 'string' ? payload.method : '';
    return router.dispatch(method, payload?.params, {
      win: BrowserWindow.fromWebContents(e.sender),
    });
  });

  return {
    dispose: async () => {
      ipcMain.removeHandler('desksoul:rpc');
      await chat.dispose();
      store.close();
      prefsStore.close();
    },
  };
}
