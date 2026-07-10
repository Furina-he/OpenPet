// scripts/fetch-electron-sqlite.mjs —— dev 前自动确保 Electron 版 better-sqlite3 就位。
// 背景：node_modules 里的 better_sqlite3.node 是 Node ABI（vitest 用）；Electron（ABI 不同）
// 加载会失败并静默降级内存库（会话不持久化）。本脚本把 Electron 专属产物下载到
// apps/desktop/native/better_sqlite3-electron-v<electron版本>.node（运行时经 nativeBinding 加载，
// 见 db/sqlite-store.ts resolveNativeBinding），与 Node 产物双版共存、互不覆盖。
// 下载走 npmmirror 镜像（本机直连 GitHub 不通）。失败仅告警不阻塞 dev（降级现状）。
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(here, '..');
const require = createRequire(path.join(desktopRoot, 'package.json'));

function main() {
  const electronVersion = require('electron/package.json').version;
  const nativeDir = path.join(desktopRoot, 'native');
  const target = path.join(nativeDir, `better_sqlite3-electron-v${electronVersion}.node`);
  if (existsSync(target)) {
    console.log(`[fetch-electron-sqlite] OK（已就位）: ${path.basename(target)}`);
    return;
  }

  const sqliteDir = path.dirname(require.resolve('better-sqlite3/package.json'));
  const sqliteRequire = createRequire(path.join(sqliteDir, 'package.json'));
  const prebuildBin = path.join(
    path.dirname(sqliteRequire.resolve('prebuild-install/package.json')),
    'bin.js',
  );
  const built = path.join(sqliteDir, 'build', 'Release', 'better_sqlite3.node');
  const backup = `${built}.node-abi-backup`;

  console.log(`[fetch-electron-sqlite] 下载 Electron v${electronVersion} 版 better-sqlite3…`);
  // prebuild-install 会覆盖 build/Release —— 先备份 Node 版，下载后拷出再还原。
  const hasNodeBuild = existsSync(built);
  if (hasNodeBuild) renameSync(built, backup);
  try {
    execFileSync(
      process.execPath,
      [prebuildBin, '--runtime', 'electron', '--target', electronVersion, '--verbose'],
      {
        cwd: sqliteDir,
        stdio: 'inherit',
        env: {
          ...process.env,
          // npmmirror 的 GitHub release 二进制镜像（prebuild-install 识别 *_binary_host 前缀）。
          npm_config_better_sqlite3_binary_host:
            'https://registry.npmmirror.com/-/binary/better-sqlite3',
        },
      },
    );
    mkdirSync(nativeDir, { recursive: true });
    copyFileSync(built, target);
    console.log(`[fetch-electron-sqlite] 完成: ${path.basename(target)}`);
  } finally {
    // 还原 Node 版产物（vitest 依赖它；无论下载成败）。build/Release 里的 electron 版已拷出，弃之。
    if (hasNodeBuild && existsSync(backup)) {
      rmSync(built, { force: true });
      renameSync(backup, built);
    }
  }
}

try {
  main();
} catch (e) {
  console.warn('[fetch-electron-sqlite] 下载失败（会话将不持久化，聊天不受影响）:', e?.message ?? e);
  console.warn('[fetch-electron-sqlite] 可重跑 pnpm dev 重试；或检查网络/镜像可达。');
}
