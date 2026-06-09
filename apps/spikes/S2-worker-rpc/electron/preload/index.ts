import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('desksoul', {
  rpc: (method: string, params?: unknown) =>
    ipcRenderer.invoke('desksoul:rpc', { method, params }),
  on: (channel: string, cb: (payload: unknown) => void) => {
    const handler = (_: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on(`desksoul:notify:${channel}`, handler);
    return () => ipcRenderer.off(`desksoul:notify:${channel}`, handler);
  },
  // spike-only: simulate a worker crash from the UI
  killWorker: () => ipcRenderer.invoke('s2:kill-worker'),
});
