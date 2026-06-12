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
import { scaledBounds } from './window-scale.js';

export interface IpcRouterDeps {
  targets: () => WebContents[];
  /** character 窗口定位（setScale / 主动行为直发）。 */
  characterWindow: () => BrowserWindow | null;
  /** 角色包根目录（dev: apps/desktop/characters；打包: resources/characters）。 */
  charactersRoot: string;
  providerEntryPath: string;
  /** 会话历史 JSON 持久化路径（生产传 userData 下文件；测试可省略）。 */
  persistPath?: string;
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
  });
  const characters = createCharacterService(deps.charactersRoot);
  const idleResponder = createIdleResponder(sendToCharacter);

  const router = createRouter<RpcContext>({
    'sys.ping': (p) => ({ pong: 'ok', echoNonce: p.nonce }),
    'chat.send': (p) => chat.send(p.sessionId, p.text),
    'chat.cancel': (p) => chat.cancel(p.sessionId),
    'chat.snapshot': (p) => chat.snapshot(p.sessionId, p.limit),
    'character.current': () => characters.current(),
    'character.setScale': (p) => {
      const win = deps.characterWindow();
      if (win && !win.isDestroyed()) win.setBounds(scaledBounds(win.getBounds(), p.scale));
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
        ctx.win.setPosition(x + Math.round(p.dx), y + Math.round(p.dy));
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
