/**
 * IPC 路由接线 — Renderer ⇄ Main 的唯一缝。
 *
 * 进站：preload 的 `window.desksoul.rpc` → `ipcMain.handle('desksoul:rpc')` →
 *       纯 router（Zod 校验 + 分发）。
 * 出站：ConversationCore 的每个 Notification 广播到所有窗口的
 *       `desksoul:notify:<channel>`；各 renderer 只订阅自己关心的 channel
 *       （overlay → chat.*，character → behavior.* + chat.done）。
 */
import { ipcMain, BrowserWindow, type WebContents } from 'electron';
import { ProviderHost } from './provider-host.js';
import { ConversationCore, type Notification } from './conversation-core.js';
import { createRouter } from './router.js';

export interface IpcRouterDeps {
  targets: () => WebContents[];
  providerEntryPath: string;
}

export interface RpcContext {
  win: BrowserWindow | null;
}

export function registerIpcRouter(deps: IpcRouterDeps): { dispose: () => Promise<void> } {
  const broadcast = (n: Notification): void => {
    for (const wc of deps.targets()) {
      if (!wc.isDestroyed()) wc.send(`desksoul:notify:${n.channel}`, n.params);
    }
  };

  const core = new ConversationCore(broadcast);
  const host = new ProviderHost(deps.providerEntryPath, (sessionId, event) =>
    core.handleEvent(sessionId, event),
  );

  const router = createRouter<RpcContext>({
    'sys.ping': (p) => ({ pong: 'ok', echoNonce: p.nonce }),
    'chat.send': (p) => {
      host.send(p.sessionId);
      return { ok: true as const };
    },
    'chat.cancel': (p) => {
      host.cancel(p.sessionId);
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
      await host.dispose();
    },
  };
}
