import { contextBridge, ipcRenderer } from 'electron';

// Minimal surface: a single JSON-RPC `rpc(...)`. The panel only drives one method
// (`sandbox.run`); no raw ipcRenderer leaks through (sandbox + contextIsolation).
contextBridge.exposeInMainWorld('openpet', {
  rpc: (method: string, params?: unknown) =>
    ipcRenderer.invoke('openpet:rpc', { method, params }),
});
