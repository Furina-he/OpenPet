import { contextBridge, ipcRenderer } from 'electron';

// 三个 renderer 共用的唯一 Node 表面：JSON-RPC `rpc(...)` + 通知订阅 `on(channel, cb)`
//（返回退订函数）。不漏 ipcRenderer 本体（sandbox + contextIsolation）。
contextBridge.exposeInMainWorld('openpet', {
  rpc: (method: string, params?: unknown) =>
    ipcRenderer.invoke('openpet:rpc', { method, params }),
  on: (channel: string, cb: (payload: unknown) => void) => {
    const handler = (_: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on(`openpet:notify:${channel}`, handler);
    return () => ipcRenderer.off(`openpet:notify:${channel}`, handler);
  },
});
