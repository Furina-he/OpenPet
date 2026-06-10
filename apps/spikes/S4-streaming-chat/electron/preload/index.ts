import { contextBridge, ipcRenderer } from 'electron';

// Same minimal surface both production renderers get: a JSON-RPC `rpc(...)` and a
// notification subscription `on(channel, cb)` that returns an unsubscribe fn.
// No raw ipcRenderer leaks into the renderer (sandbox + contextIsolation).
contextBridge.exposeInMainWorld('desksoul', {
  rpc: (method: string, params?: unknown) =>
    ipcRenderer.invoke('desksoul:rpc', { method, params }),
  on: (channel: string, cb: (payload: unknown) => void) => {
    const handler = (_: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on(`desksoul:notify:${channel}`, handler);
    return () => ipcRenderer.off(`desksoul:notify:${channel}`, handler);
  },
});
