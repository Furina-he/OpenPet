/**
 * 打包版路径适配（⑪ 发布批次）——纯函数，单测锁行为。
 *
 * - resolveNativeDir：Electron ABI 的 better-sqlite3 产物目录。dev = app 根 native/
 *   （fetch-electron-sqlite.mjs 下载）；打包 = resources/native（electron-builder
 *   extraResources 落点，asar 外真实文件）。
 * - toUnpackedPath：worker_threads 的入口必须是真实文件——Electron 的 asar fs hook
 *   不覆盖 Worker 线程，asar 内路径喂 new Worker() 必失败。sidecar dist 及其依赖
 *   已 asarUnpack，把 require.resolve 出的 asar 路径重写到 app.asar.unpacked。
 */
import path from 'node:path';

export function resolveNativeDir(
  isPackaged: boolean,
  resourcesPath: string,
  appPath: string,
): string {
  return isPackaged ? path.join(resourcesPath, 'native') : path.join(appPath, 'native');
}

export function toUnpackedPath(p: string): string {
  return p.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
}
