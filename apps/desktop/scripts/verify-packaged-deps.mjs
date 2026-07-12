// scripts/verify-packaged-deps.mjs —— 打包产物依赖完整性校验（⑪ 发布批次）。
// electron-builder 在 pnpm workspace 下收集 node_modules 有漏（实测漏 workspace 包的
// 依赖、第三方包的传递依赖）。本脚本对打包产物里每个包的 dependencies 做闭包检查，
// 缺失即非零退出——package/release 后跑，进发布门。
// 用法：node scripts/verify-packaged-deps.mjs [appDirOrAsar]
//   缺省 release/win-unpacked/resources/app.asar（不存在则试 resources/app/）
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const desktopRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');

function loadAsar() {
  try {
    // electron-builder 的依赖树里有 @electron/asar；从 app-builder-lib 处解析
    const p = require.resolve('@electron/asar', {
      paths: [path.dirname(require.resolve('electron-builder/package.json'))],
    });
    return require(p);
  } catch {
    return null;
  }
}

const argTarget = process.argv[2];
const candidates = argTarget
  ? [argTarget]
  : [
      path.join(desktopRoot, 'release', 'win-unpacked', 'resources', 'app.asar'),
      path.join(desktopRoot, 'release', 'win-unpacked', 'resources', 'app'),
    ];
const target = candidates.find((p) => existsSync(p));
if (!target) {
  console.error('[verify-packaged-deps] 找不到打包产物（先跑 pnpm package）:', candidates.join(' | '));
  process.exit(2);
}

/** 统一文件访问：asar 或目录。 */
let listTop; // () => string[] 顶层包名（@scope/name 或 name）
let readPkg; // (pkgName) => object|null
if (target.endsWith('.asar')) {
  const asar = loadAsar();
  if (!asar) {
    console.error('[verify-packaged-deps] @electron/asar 不可用');
    process.exit(2);
  }
  const all = asar.listPackage(target).map((p) => p.replace(/\\/g, '/'));
  const tops = new Set();
  for (const p of all) {
    const m = p.match(/^\/node_modules\/(@[^/]+\/[^/]+|[^@/][^/]*)$/);
    if (m) tops.add(m[1]);
  }
  listTop = () => [...tops];
  readPkg = (name) => {
    try {
      return JSON.parse(asar.extractFile(target, `node_modules/${name}/package.json`).toString('utf8'));
    } catch {
      return null;
    }
  };
} else {
  const nmRoot = path.join(target, 'node_modules');
  listTop = () => {
    const out = [];
    for (const e of readdirSync(nmRoot)) {
      if (e.startsWith('.')) continue;
      if (e.startsWith('@')) {
        for (const s of readdirSync(path.join(nmRoot, e))) out.push(`${e}/${s}`);
      } else out.push(e);
    }
    return out;
  };
  readPkg = (name) => {
    try {
      return JSON.parse(readFileSync(path.join(nmRoot, name, 'package.json'), 'utf8'));
    } catch {
      return null;
    }
  };
}

const present = new Set(listTop());
const missing = new Map(); // dep -> [importers]
// optionalDependencies 缺失合法；peerDependencies 由宿主保证（不校验）
for (const name of present) {
  const pkg = readPkg(name);
  if (!pkg) continue;
  const optional = new Set(Object.keys(pkg.optionalDependencies ?? {}));
  for (const dep of Object.keys(pkg.dependencies ?? {})) {
    if (optional.has(dep)) continue;
    if (!present.has(dep)) {
      if (!missing.has(dep)) missing.set(dep, []);
      missing.get(dep).push(name);
    }
  }
}

if (missing.size === 0) {
  console.log(`[verify-packaged-deps] OK：${present.size} 个包依赖闭包完整（${path.basename(target)}）`);
  process.exit(0);
}
console.error(`[verify-packaged-deps] 缺 ${missing.size} 个传递依赖（electron-builder 收集漏包）：`);
for (const [dep, importers] of [...missing.entries()].sort()) {
  console.error(`  - ${dep}   ← ${importers.join(', ')}`);
}
console.error('修复：把缺失包补进 apps/desktop package.json dependencies（显式声明保证收集）。');
process.exit(1);
