import { describe, it, expect } from 'vitest';
import { resolveNativeDir, toUnpackedPath } from '../electron/main/packaged-paths.js';

describe('resolveNativeDir', () => {
  it('packaged → resourcesPath/native（extraResources 落点）', () => {
    expect(resolveNativeDir(true, 'C:\\app\\resources', 'C:\\app\\resources\\app.asar')).toBe(
      'C:\\app\\resources\\native',
    );
  });

  it('dev → appPath/native（fetch-electron-sqlite.mjs 下载目录）', () => {
    expect(resolveNativeDir(false, 'C:\\electron\\resources', 'D:\\repo\\apps\\desktop')).toBe(
      'D:\\repo\\apps\\desktop\\native',
    );
  });
});

describe('toUnpackedPath', () => {
  it('asar 内路径重写到 app.asar.unpacked（worker_threads 无 asar hook）', () => {
    expect(
      toUnpackedPath('C:\\app\\resources\\app.asar\\node_modules\\@openpet\\sidecar\\dist\\w.js'),
    ).toBe('C:\\app\\resources\\app.asar.unpacked\\node_modules\\@openpet\\sidecar\\dist\\w.js');
  });

  it('POSIX 分隔符同样重写', () => {
    expect(toUnpackedPath('/opt/app/resources/app.asar/node_modules/x.js')).toBe(
      '/opt/app/resources/app.asar.unpacked/node_modules/x.js',
    );
  });

  it('非 asar 路径原样返回（dev）', () => {
    expect(toUnpackedPath('D:\\repo\\apps\\sidecar\\dist\\w.js')).toBe(
      'D:\\repo\\apps\\sidecar\\dist\\w.js',
    );
  });

  it('只重写首个 app.asar 段（app.asar.unpacked 不再二次改写）', () => {
    expect(toUnpackedPath('C:\\r\\app.asar.unpacked\\x.js')).toBe('C:\\r\\app.asar.unpacked\\x.js');
  });
});
