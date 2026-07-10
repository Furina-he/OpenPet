import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('spike', {
  setClickThrough: (ignore: boolean) => ipcRenderer.invoke('s1:set-click-through', ignore),
  moveBy: (dx: number, dy: number) => ipcRenderer.invoke('s1:window-move-by', dx, dy),
});
