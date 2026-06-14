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
import { ipcMain, BrowserWindow, type WebContents } from 'electron';
import { ChatService } from './chat-service.js';
import { createRouter } from './router.js';
import { createCharacterService } from './character-service.js';
import { createIdleResponder } from './idle-responder.js';
import { scaledBounds, CHARACTER_BASE_SIZE } from './window-scale.js';

export interface IpcRouterDeps {
  targets: () => WebContents[];
  /** character 窗口定位（setScale / 主动行为直发）。 */
  characterWindow: () => BrowserWindow | null;
  /** 角色包根目录（dev: apps/desktop/characters；打包: resources/characters）。 */
  charactersRoot: string;
  providerEntryPath: string;
  /** 会话历史 JSON 持久化路径（生产传 userData 下文件；测试可省略）。 */
  persistPath?: string;
  /** 代理 fetch 网关依赖（Electron net + 白名单 + Keychain 注入）；生产由 index.ts 注入。 */
  fetch?: import('./fetch-gateway.js').FetchGatewayDeps;
  /** 默认 provider id（chat.send 未指定时用）；M5 固定 'openai'，M7 接用户选择。 */
  defaultProviderId?: string;
  /** provider.* RPC handlers（M5）；index.ts 注入，spread 进 router。 */
  providerService?: ReturnType<typeof import('./provider-service.js').createProviderService>;
}

export interface RpcContext {
  win: BrowserWindow | null;
}

export function registerIpcRouter(deps: IpcRouterDeps): { dispose: () => Promise<void> } {
  const broadcast = (channel: string, params: unknown): void => {
    for (const wc of deps.targets()) {
      if (!wc.isDestroyed()) wc.send(`desksoul:notify:${channel}`, params);
    }
  };
  const sendToCharacter = (channel: string, params: unknown): void => {
    const win = deps.characterWindow();
    if (win && !win.isDestroyed()) win.webContents.send(`desksoul:notify:${channel}`, params);
  };

  const chat = new ChatService({
    providerEntryPath: deps.providerEntryPath,
    broadcast,
    ...(deps.persistPath ? { persistPath: deps.persistPath } : {}),
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
    ...(deps.defaultProviderId ? { defaultProviderId: deps.defaultProviderId } : {}),
  });
  const characters = createCharacterService(deps.charactersRoot);
  const idleResponder = createIdleResponder(sendToCharacter);
  // character 窗口的期望尺寸真源：唯一合法的尺寸变更入口是 setScale。
  // Windows 非 100% DPI 下 setPosition 每次调用有 DIP↔物理像素舍入漂移
  //（125% 实测 40 次 moveBy 涨 36×53px），位置操作必须用 setBounds 锁回期望尺寸。
  let characterSize: { width: number; height: number } = { ...CHARACTER_BASE_SIZE };

  const router = createRouter<RpcContext>({
    ...(deps.providerService ?? {}),
    'sys.ping': (p) => ({ pong: 'ok', echoNonce: p.nonce }),
    'chat.send': (p) => chat.send(p.sessionId, p.text, p.providerId),
    'chat.cancel': (p) => chat.cancel(p.sessionId),
    'chat.snapshot': (p) => chat.snapshot(p.sessionId, p.limit),
    'character.current': () => characters.current(),
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
    },
  };
}
