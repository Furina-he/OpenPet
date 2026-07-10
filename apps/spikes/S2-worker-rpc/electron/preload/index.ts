import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('openpet', {
  rpc: (method: string, params?: unknown) =>
    ipcRenderer.invoke('openpet:rpc', { method, params }),
  on: (channel: string, cb: (payload: unknown) => void) => {
    const handler = (_: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on(`openpet:notify:${channel}`, handler);
    return () => ipcRenderer.off(`openpet:notify:${channel}`, handler);
  },
  // spike-only: simulate a worker crash from the UI
  killWorker: () => ipcRenderer.invoke('s2:kill-worker'),
});
