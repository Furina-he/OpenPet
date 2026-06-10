/**
 * IPC router for Spike S4 — the one Main-side seam between Renderers and the
 * streaming pipeline.
 *
 * Inbound (Renderer → Main, `ipcRenderer.invoke`):
 *   - chat.send   {sessionId, text} → start a provider stream
 *   - chat.cancel {sessionId}       → cancel it (200ms grace, then terminate)
 *
 * Outbound (Main → Renderers, `webContents.send`): every `Notification` from
 * ConversationCore is fanned to BOTH windows on `desksoul:notify:<channel>`.
 * Each renderer subscribes only to the channels it cares about (overlay →
 * chat.*, character → behavior.*), so a single broadcast drives both tracks.
 */
import { ipcMain, type WebContents } from 'electron';
import { ProviderHost } from './provider-host.js';
import { ConversationCore, type Notification } from './conversation-core.js';

export interface RouterDeps {
  /** All renderer webContents to broadcast notifications to. */
  targets: () => WebContents[];
  providerEntryPath: string;
}

export function registerRpc(deps: RouterDeps): { dispose: () => Promise<void> } {
  const broadcast = (n: Notification): void => {
    for (const wc of deps.targets()) {
      if (!wc.isDestroyed()) wc.send(`desksoul:notify:${n.channel}`, n.params);
    }
  };

  const core = new ConversationCore(broadcast);
  const host = new ProviderHost(
    deps.providerEntryPath,
    (sessionId, event) => core.handleEvent(sessionId, event),
    { onForceTerminate: (rid) => console.log(`[ProviderHost] force-terminated ${rid}`) },
  );

  ipcMain.handle('desksoul:rpc', (_e, { method, params }: { method: string; params?: unknown }) => {
    switch (method) {
      case 'chat.send': {
        const { sessionId } = params as { sessionId: string; text: string };
        host.send(sessionId);
        return { ok: true };
      }
      case 'chat.cancel': {
        const { sessionId } = params as { sessionId: string };
        host.cancel(sessionId);
        return { ok: true };
      }
      default:
        throw Object.assign(new Error(`Method not found: ${method}`), { code: -32601 });
    }
  });

  return {
    dispose: async () => {
      ipcMain.removeHandler('desksoul:rpc');
      await host.dispose();
    },
  };
}
