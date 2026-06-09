import { ipcMain } from 'electron';
import type { PluginHost } from './plugin-host.js';

export function registerRpc(host: PluginHost): void {
  ipcMain.handle('desksoul:rpc', (_e, { method, params }: { method: string; params?: unknown }) =>
    host.call(method, params),
  );
  // spike-only: let the renderer simulate a worker crash
  ipcMain.handle('s2:kill-worker', () => host.terminate());
}
