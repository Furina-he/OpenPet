# DeskSoul v0.1 Spike + MVP Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** 把 DeskSoul tech-design v0.2 的 §9.2 Tech Spike (S1–S5) 和 §9.1 MVP 切片拆成可执行任务清单，从空仓库走到 Win 10/11 可分发的 V0.1 MVP。

**Architecture:** Electron Main（Node）作为主进程，托管两个 BrowserWindow（Character / UI Overlay），Main 直接承担业务大脑（ConversationCore / BehaviorParser / PluginHost / SQLite 单连接），不再 spawn 独立 Node 子进程；插件跑在 `worker_threads`，经 `MessagePort` 通信；Renderer 启用 `sandbox + contextIsolation`，preload 通过 `contextBridge` 暴露 `window.desksoul.rpc/on`。UI 用 Vue 3 + Vite，渲染层用 Three.js + @pixiv/three-vrm。所有持久状态本地（Electron safeStorage + SQLite WAL + sqlite-vec）。

**Tech Stack（已锁定，v0.2 调整）：**
- 包管理：**pnpm workspace + Turborepo**
- UI：**Vue 3 + Vite + Pinia + TailwindCSS**
- 桌面壳：**Electron 30+**（Win 10/11 首发；macOS / Linux 后续）
- 构建：**electron-vite**（Main + Preload + Renderer 三路构建一体化）+ **electron-builder**（打包）
- 主进程业务大脑：**Electron Main（Node 20 LTS 嵌入版）**（不再独立 spawn 系统 node）
- 协议 schema：**Zod 为单一真源**（Main / Renderer / Worker 共享 import）
- 数据库：**better-sqlite3** + **sqlite-vec**（V1.0 启用向量）
- 渲染：**Three.js r160+** + **@pixiv/three-vrm 3.x**
- 密钥存储：**Electron `safeStorage`**（DPAPI / Keychain / libsecret 自动选择）+ AES-GCM 兜底
- 测试：**Vitest**（TS 单测）+ **Playwright with Electron**（端到端，跑 packaged app）+ **@vitest/coverage-v8**

---

## 文档使用方式

- **Phase 0–1（脚手架 + Spike）**：bite-sized 到"写测试 → 跑测 → 实现 → 跑测 → 提交"五步。直接照执行。
- **Phase 2（MVP 8 个里程碑）**：里程碑级范围 + 关键文件 + 验收标准；**进入每个里程碑前**，用 `superpowers:writing-plans` 把该里程碑重新分解为 bite-sized 任务。理由：Spike 会推翻部分技术假设，提前把 MVP 写到代码级会大量返工。
- 所有提交按 Conventional Commits：`feat:` `fix:` `chore:` `test:` `docs:` `refactor:`。
- 每个 Spike / 里程碑结束打 git tag：`spike/S1-passed`、`mvp/M3-done` 等。

---

# Phase 0 · 项目脚手架（预计 1–2 天）

## Task 0.1: 初始化 monorepo 根目录

**Files:**
- Create: `pnpm-workspace.yaml`
- Create: `package.json`（root）
- Create: `turbo.json`
- Create: `.gitignore`
- Create: `.editorconfig`
- Create: `.nvmrc`（写 `20.11.0`）

**Step 1: 创建根 package.json**

```json
{
  "name": "desksoul",
  "private": true,
  "version": "0.1.0-dev",
  "packageManager": "pnpm@9.0.0",
  "engines": { "node": ">=20.11" },
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev --parallel",
    "test": "turbo run test",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck"
  },
  "devDependencies": {
    "turbo": "^2.0.0",
    "typescript": "^5.4.0",
    "@types/node": "^20.12.0"
  }
}
```

**Step 2: 创建 pnpm-workspace.yaml**

```yaml
packages:
  - 'packages/*'
  - 'apps/*'
```

**Step 3: 创建 turbo.json**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "dev": { "cache": false, "persistent": true },
    "test": { "dependsOn": ["^build"] },
    "lint": {},
    "typecheck": { "dependsOn": ["^build"] }
  }
}
```

**Step 4: 创建 .gitignore**

```
node_modules/
dist/
.turbo/
*.log
.DS_Store
.env
.env.local
out/                 # electron-vite 输出
release/             # electron-builder 输出
.vite/               # 缓存
.desksoul/
```

**Step 5: 验证**

Run: `pnpm install`
Expected: 无报错，生成 `pnpm-lock.yaml`。

**Step 6: 提交**

```bash
git add pnpm-workspace.yaml package.json turbo.json .gitignore .editorconfig .nvmrc pnpm-lock.yaml
git commit -m "chore: bootstrap pnpm + turborepo monorepo"
```

---

## Task 0.2: 配置 TypeScript / ESLint / Prettier 共享配置

**Files:**
- Create: `packages/tsconfig/base.json`
- Create: `packages/tsconfig/node.json`
- Create: `packages/tsconfig/vue.json`
- Create: `packages/tsconfig/package.json`
- Create: `.eslintrc.cjs`（root）
- Create: `.prettierrc.json`

**Step 1: 共享 tsconfig 包**

`packages/tsconfig/package.json`:
```json
{ "name": "@desksoul/tsconfig", "version": "0.0.0", "private": true, "files": ["*.json"] }
```

`packages/tsconfig/base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true
  }
}
```

`packages/tsconfig/node.json`:
```json
{
  "extends": "./base.json",
  "compilerOptions": { "lib": ["ES2022"], "types": ["node"] }
}
```

`packages/tsconfig/vue.json`:
```json
{
  "extends": "./base.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "preserve",
    "types": ["vite/client"]
  }
}
```

**Step 2: ESLint + Prettier**

`.prettierrc.json`:
```json
{ "semi": true, "singleQuote": true, "trailingComma": "all", "printWidth": 100 }
```

`.eslintrc.cjs`:
```js
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended', 'prettier'],
  ignorePatterns: ['dist', 'out', 'release', 'node_modules'],
};
```

Add to root devDeps: `eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin eslint-config-prettier prettier`

**Step 3: 验证**

Run: `pnpm install && pnpm exec tsc --noEmit -p packages/tsconfig/base.json`
Expected: 无错误（空配置生效）。

**Step 4: 提交**

```bash
git add packages/tsconfig .eslintrc.cjs .prettierrc.json package.json pnpm-lock.yaml
git commit -m "chore: add shared tsconfig + eslint + prettier"
```

---

## Task 0.3: 创建包目录骨架

**Files（空骨架）：**
- Create: `packages/protocol/{package.json,src/index.ts,tsconfig.json}`
- Create: `packages/plugin-sdk/{package.json,src/index.ts,tsconfig.json}`
- Create: `apps/desktop/`（Electron 项目，下一个任务初始化）
- Create: `apps/sidecar/{package.json,src/index.ts,tsconfig.json}`（"sidecar" 名称沿用，但实际是被 Electron Main 进程直接 import 的业务大脑模块，**不再 spawn 独立子进程**；保留独立包是为了让业务模块能被单独单测、未来可平滑迁移到 `utilityProcess` 或远程 Bridge）

**`packages/protocol/package.json`:**
```json
{
  "name": "@desksoul/protocol",
  "version": "0.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": { "zod": "^3.23.0", "zod-to-json-schema": "^3.23.0" },
  "devDependencies": {
    "@desksoul/tsconfig": "workspace:*",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

`packages/protocol/tsconfig.json`:
```json
{
  "extends": "@desksoul/tsconfig/node.json",
  "compilerOptions": { "outDir": "dist", "declaration": true, "rootDir": "src" },
  "include": ["src"]
}
```

`packages/protocol/src/index.ts`:
```ts
export const PROTOCOL_VERSION = '0.1.0';
```

类似创建 `plugin-sdk` 与 `apps/sidecar`（下一个任务才用到）。

**Step 1: 装包**
Run: `pnpm install`
Expected: 三个新包出现在 `node_modules/@desksoul/`。

**Step 2: 验证 typecheck**
Run: `pnpm -r typecheck`
Expected: 全部通过。

**Step 3: 提交**
```bash
git add packages apps
git commit -m "chore: scaffold protocol / plugin-sdk / sidecar package skeletons"
```

---

## Task 0.4: 在 apps/desktop 初始化 Electron + Vite + Vue

> **背景：** v0.2 已经把桌面壳从 Tauri 切到 Electron。如果仓库里已存在 Tauri 脚手架（`apps/desktop/src-tauri/`、`@tauri-apps/*` 依赖），先做迁移；新仓库则直接执行 Step 1。

**先决条件：** Node 20.11+ 已装；pnpm 9 已装；Windows 端无需额外 SDK（electron-builder 跨平台 zip / nsis 已够）。

**Step 0（若已存在 Tauri 脚手架）：清理旧脚手架**

```bash
# 删除 Rust / Tauri 相关文件
rm -rf apps/desktop/src-tauri
# 从 apps/desktop/package.json 移除 @tauri-apps/api、@tauri-apps/cli、@tauri-apps/plugin-opener、tauri 脚本
# 从 .github/workflows/ci.yml 移除 cargo test 步骤、dtolnay/rust-toolchain action
# 从 vite.config.ts 删除 Tauri 端口/host 相关配置（端口 1420、TAURI_DEV_HOST）
```

提交：`chore: remove Tauri scaffold in preparation for Electron pivot`

**Step 1: 安装 Electron 工具链**

在 `apps/desktop/` 内：
```bash
pnpm --filter @desksoul/desktop add -D electron@^30 electron-vite@^2 electron-builder@^24 \
  vite@^6 @vitejs/plugin-vue@^5 vue-tsc@^2 typescript@~5.6
pnpm --filter @desksoul/desktop add vue@^3.5
```

**Step 2: 创建 electron-vite 工程结构**

目录布局：
```
apps/desktop/
├── electron.vite.config.ts
├── electron-builder.yml
├── package.json
├── tsconfig.json            # 仅 Renderer
├── tsconfig.node.json       # Main + Preload
├── src/
│   └── renderer/            # Vue 应用（UI Overlay；Character 后续拆分）
│       ├── index.html
│       ├── main.ts
│       └── App.vue
└── electron/
    ├── main/
    │   ├── index.ts         # Electron Main 入口
    │   ├── windows.ts       # BrowserWindow 编排
    │   ├── ipc-router.ts    # JSON-RPC 路由
    │   └── sidecar.ts       # import @desksoul/sidecar 启动业务大脑
    └── preload/
        └── index.ts         # contextBridge.exposeInMainWorld
```

**Step 3: `electron.vite.config.ts`**

```ts
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: { entry: 'electron/main/index.ts' },
      rollupOptions: { external: ['better-sqlite3', 'electron'] },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { lib: { entry: 'electron/preload/index.ts' } },
  },
  renderer: {
    root: 'src/renderer',
    plugins: [vue()],
    build: { rollupOptions: { input: { index: 'src/renderer/index.html' } } },
  },
});
```

**Step 4: `electron/main/index.ts`（最小可启）**

```ts
import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function createWindow() {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.mjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    await win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    await win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit());
```

**Step 5: `electron/preload/index.ts`（暴露最小 RPC 表面）**

```ts
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('desksoul', {
  rpc: (method: string, params?: unknown) =>
    ipcRenderer.invoke('desksoul:rpc', { method, params }),
  on: (channel: string, cb: (payload: unknown) => void) => {
    const handler = (_: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on(`desksoul:notify:${channel}`, handler);
    return () => ipcRenderer.off(`desksoul:notify:${channel}`, handler);
  },
});
```

**Step 6: `package.json` 脚本**

```json
{
  "name": "@desksoul/desktop",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "main": "out/main/index.mjs",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "preview": "electron-vite preview",
    "package": "electron-vite build && electron-builder --dir",
    "release": "electron-vite build && electron-builder",
    "typecheck": "vue-tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.node.json"
  }
}
```

**Step 7: `electron-builder.yml`（最小）**

```yaml
appId: app.desksoul.desktop
productName: DeskSoul
directories:
  output: release
files:
  - out/**/*
win:
  target: nsis
  artifactName: ${productName}-${version}-${arch}.${ext}
```

**Step 8: 验证 dev 启动**

Run: `pnpm --filter @desksoul/desktop dev`
Expected: Electron 弹出一个 800×600 窗口，显示 Vue 默认页面；DevTools 中执行 `window.desksoul.rpc('sys.ping', {})` 不会立即报错（method 未实现是后续 spike 的事）。

**Step 9: 提交**
```bash
git add apps/desktop pnpm-lock.yaml
git commit -m "chore: scaffold Electron + Vue 3 desktop app (pivot from Tauri)"
```

---

## Task 0.5: 配置 GitHub Actions（CI）

**Files:**
- Create: `.github/workflows/ci.yml`

```yaml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: '20.11.0', cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
      - run: pnpm -r typecheck
      - run: pnpm -r lint
      - run: pnpm -r test
      - run: pnpm --filter @desksoul/desktop build  # 验证 electron-vite 三路构建
```

> v0.2 调整：不再需要 `dtolnay/rust-toolchain` 与 `cargo test`。Electron 端到端测试（Playwright with Electron）在 Phase 2 M8 时再接入 CI。

**Step 1: 提交并 push 验证**
```bash
git add .github
git commit -m "ci: add typecheck / lint / test / electron build pipeline"
git push
```
Expected: GitHub Actions 全绿。

---

**Phase 0 完成判据：**
- [ ] `pnpm install` 干净
- [ ] `pnpm -r typecheck` 全绿
- [ ] `pnpm --filter @desksoul/desktop dev` 能弹出 Electron 窗口
- [ ] Renderer DevTools 中 `window.desksoul` 存在（contextBridge 注入成功）
- [ ] CI workflow 通过

打 tag：`git tag phase0-bootstrap-done && git push --tags`

---

# Phase 1 · Tech Spike（预计 1–2 周）

> **关键纪律：** 5 个 Spike 串行执行，每个 Spike 必须满足 tech-design §9.2 的"成功判据"才能进入下一个。任一失败 → 暂停，回到 tech-design 对应章节重新决策，**不要** 继续后续 Spike。

> 每个 Spike 在 `apps/spikes/<S?>/` 下独立子项目（**不要污染** `apps/desktop`）。Spike 通过后再把验证过的代码以 PR 方式合并到主 app。

## Spike S1 · 透明窗口三件套（Win 10/11 优先）

**目标（tech-design §9.2 表）：** Win 透明 + 点击穿透 + 拖拽。
**MVP 范围简化：** 只验 Win 10/11；Mac/Linux 留 V1.0+。

**成功判据：**
1. 窗口完全透明（背景看到桌面），Renderer 内 Three.js 渲染一个 cube
2. 鼠标在 alpha < 0.05 区域穿透，落到桌面图标上可双击打开
3. 鼠标在 cube 上长按 200ms 可拖拽窗口
4. Windows Defender / 360 不报警（手动验证）
5. `setIgnoreMouseEvents({ forward: true })` 切换在 cube 边缘抖动可控（迟滞阈值生效）

### Task S1.1: 创建 spike 子项目（Electron 最小工程）

**Files:**
- Create: `apps/spikes/S1-transparent-window/`（独立 Electron 项目）

可以复制 Task 0.4 的脚手架作为起点（`electron.vite.config.ts`、`electron/main/`、`electron/preload/`、`src/renderer/`），然后：

```bash
pnpm --filter @desksoul/spike-s1 add -D electron@^30 electron-vite@^2 vite@^6 typescript@~5.6
pnpm --filter @desksoul/spike-s1 add three @types/three
```

修改 `package.json` 中 `name: @desksoul/spike-s1`、`private: true`。

**Commit:** `chore(spike-s1): scaffold electron transparent window project`

### Task S1.2: 配置透明 + 无边框窗口

**Files:**
- Modify: `apps/spikes/S1-transparent-window/electron/main/index.ts`

```ts
const win = new BrowserWindow({
  width: 320,
  height: 480,
  frame: false,
  transparent: true,
  resizable: false,
  hasShadow: false,
  skipTaskbar: true,
  alwaysOnTop: false,
  backgroundColor: '#00000000',
  webPreferences: {
    preload: path.join(__dirname, '../preload/index.mjs'),
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    backgroundThrottling: false,
  },
});
```

Renderer 端 `index.html` 的 `<html>` / `<body>` / `#app` 都加 `background: transparent`。

**Step 1: 跑起来看到透明效果**
Run: `pnpm --filter @desksoul/spike-s1 dev`
Expected: 窗口透明，能看到桌面壁纸。

**Commit:** `feat(spike-s1): transparent borderless BrowserWindow`

### Task S1.3: 内嵌 Three.js cube 验证渲染

**Files:**
- Create: `apps/spikes/S1-transparent-window/src/renderer/cube.ts`
- Modify: `apps/spikes/S1-transparent-window/src/renderer/main.ts`

`cube.ts`:
```ts
import * as THREE from 'three';

export function mountCube(container: HTMLElement) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, 320 / 480, 0.1, 1000);
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, premultipliedAlpha: false });
  renderer.setClearColor(0x000000, 0);
  renderer.setSize(320, 480);
  container.appendChild(renderer.domElement);

  const cube = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0xff8fab }),
  );
  scene.add(cube);
  camera.position.z = 3;

  function loop() {
    cube.rotation.x += 0.01;
    cube.rotation.y += 0.01;
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  }
  loop();
  return renderer;
}
```

`main.ts`: `mountCube(document.getElementById('app')!)`。依赖在 S1.1 已装。

**Step:** Run → Expected: 透明背景上看到粉色立方体在转。

**Commit:** `feat(spike-s1): three.js cube on transparent window`

### Task S1.4: alpha 命中穿透实现

**思路：** Renderer 内监听 mousemove，readPixels 取光标处 alpha；若 < 阈值经 preload 通知 Main 调 `win.setIgnoreMouseEvents(true, { forward: true })`，否则 false。带迟滞阈值避免边缘抖动。

**Files:**
- Modify: `apps/spikes/S1-transparent-window/electron/main/index.ts`
- Modify: `apps/spikes/S1-transparent-window/electron/preload/index.ts`
- Modify: `apps/spikes/S1-transparent-window/src/renderer/cube.ts`

`main/index.ts` 加 IPC handler：
```ts
import { ipcMain, BrowserWindow } from 'electron';

ipcMain.handle('s1:set-click-through', (e, ignore: boolean) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  win?.setIgnoreMouseEvents(Boolean(ignore), { forward: true });
});
```

`preload/index.ts`:
```ts
import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('spike', {
  setClickThrough: (ignore: boolean) => ipcRenderer.invoke('s1:set-click-through', ignore),
});
```

`cube.ts` 加 mousemove handler（30Hz 节流 + 迟滞）：
```ts
declare const spike: { setClickThrough: (ignore: boolean) => Promise<void> };

let lastIgnore: boolean | null = null;
let lastT = 0;
const ENTER = 26;   // 0.10 * 255  进入实心区
const EXIT  = 13;   // 0.05 * 255  退出实心区

window.addEventListener('mousemove', (e: MouseEvent) => {
  const now = performance.now();
  if (now - lastT < 33) return;
  lastT = now;
  const gl = renderer.getContext();
  const px = new Uint8Array(4);
  const y = renderer.domElement.height - e.clientY;
  gl.readPixels(e.clientX, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const alpha = px[3]!;
  const ignore = lastIgnore === false ? alpha < EXIT : alpha < ENTER;
  if (ignore !== lastIgnore) {
    lastIgnore = ignore;
    spike.setClickThrough(ignore);
  }
});
```

> `forward: true` 让透明区的鼠标事件转发给桌面下层；本窗口仍能收到 mousemove 用于 readPixels，因此切换不会"卡死"在某一态。

**Step 1: 验证穿透**
- 启动后把窗口移到桌面图标上
- 鼠标移到立方体外（透明区）→ 双击桌面图标应能打开
- 鼠标移到立方体上 → 立方体应能响应（先放个 console.log 验证 mousedown 可收到）

**Commit:** `feat(spike-s1): alpha-based click-through with hysteresis`

### Task S1.5: 长按 200ms 拖拽

> Electron 推荐两种拖拽方式：CSS `-webkit-app-region: drag` 不支持延时；改用 Renderer 监听 mousedown，长按 200ms 后通过 IPC 让 Main 调 `win.setPosition()` 自实现。

**Files:**
- Modify: `apps/spikes/S1-transparent-window/electron/main/index.ts`
- Modify: `apps/spikes/S1-transparent-window/electron/preload/index.ts`
- Modify: `apps/spikes/S1-transparent-window/src/renderer/cube.ts`

`main/index.ts`:
```ts
ipcMain.handle('s1:window-move-by', (e, dx: number, dy: number) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win) return;
  const [x, y] = win.getPosition();
  win.setPosition(x + dx, y + dy);
});
```

`preload/index.ts` 暴露 `moveBy(dx, dy)`。

`cube.ts`：
```ts
declare const spike: {
  setClickThrough: (ignore: boolean) => Promise<void>;
  moveBy: (dx: number, dy: number) => Promise<void>;
};

let pressTimer: number | null = null;
let dragging = false;
let lastX = 0, lastY = 0;

renderer.domElement.addEventListener('mousedown', (e) => {
  lastX = e.screenX; lastY = e.screenY;
  pressTimer = window.setTimeout(() => { dragging = true; }, 200);
});
window.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  const dx = e.screenX - lastX;
  const dy = e.screenY - lastY;
  lastX = e.screenX; lastY = e.screenY;
  spike.moveBy(dx, dy);
});
window.addEventListener('mouseup', () => {
  if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
  dragging = false;
});
```

**Step 1: 验证**
- 在立方体上长按 ≥200ms 拖拽 → 窗口跟随
- 短按 → 不拖拽

**Commit:** `feat(spike-s1): long-press drag via setPosition`

### Task S1.6: 杀软兼容性手测 + 打 spike tag

**手动验证清单**（写到 `apps/spikes/S1-transparent-window/RESULTS.md`）：

| 检查项 | 通过? | 备注 |
| --- | --- | --- |
| Win 10 透明窗口 | ☐ | |
| Win 11 透明窗口 | ☐ | |
| alpha 穿透命中正确 | ☐ | |
| alpha 边缘抖动可控 | ☐ | 迟滞阈值生效 |
| 长按 200ms 拖拽 | ☐ | |
| Windows Defender 不报警 | ☐ | |
| 360 / 火绒不报警 | ☐ | 有就装一个测 |
| 多显示器拖到副屏正常 | ☐ | |
| 高 DPI（150% 缩放）正常 | ☐ | |

全部通过 → `git tag spike/S1-passed`。

**有任一失败：** 暂停 Spike 流程，回到 tech-design §7"渲染层与 Character Runtime"——尤其是平台兼容性表——重新评估方案（必要时考虑用 Win 原生 native module 调 `SetWindowLong WS_EX_LAYERED + WS_EX_TRANSPARENT`，或退回 Tauri 方案）。

---

## Spike S2 · Electron Main ↔ Renderer ↔ Worker 串联

**目标：** Renderer 经 `window.desksoul.rpc(...)` 调到 Main；Main 内 JSON-RPC 路由把请求转发给 `worker_threads` 内的业务模块；Worker 强杀（`worker.terminate()`）后 1s 内 PluginHost 重启，Renderer 自动重连可继续调用。

**与 v0.1 的差别：** 不再 spawn 外部 Node 子进程、不走 stdio；改成 Main 内启动 Worker、走 MessagePort。语义模型仍是 JSON-RPC 2.0（这让 `@desksoul/protocol` 包可以零改动复用）。

**成功判据：**
1. Renderer 调 `window.desksoul.rpc('sys.ping', {nonce:'abc'})` → Main → Worker → Main → Renderer 收到 `{pong:'ok', echoNonce:'abc'}`
2. 在 Main 内通过 DevTools 触发 `worker.terminate()` 模拟 Worker 崩溃 → 1s 内 PluginHost 重启 Worker
3. 重启后 Renderer 再发请求仍能成功（无需手动刷新）
4. Backoff 指数退避封顶 30s（连续 terminate 3 次观察）
5. Worker 抛未捕获异常 → PluginHost 捕获 `error` 事件并重启，**Main 进程不退出**

### Task S2.1: 在 protocol 包定义最小 JSON-RPC 类型

**Files:**
- Create: `packages/protocol/src/jsonrpc.ts`
- Create: `packages/protocol/src/methods.ts`
- Create: `packages/protocol/test/jsonrpc.test.ts`

**Step 1: 写测试**

`test/jsonrpc.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { JsonRpcRequest, parseRequest } from '../src/jsonrpc';

describe('JSON-RPC parser', () => {
  it('parses valid request', () => {
    const r = parseRequest('{"jsonrpc":"2.0","id":1,"method":"chat.send","params":{}}');
    expect(r.method).toBe('chat.send');
    expect(r.id).toBe(1);
  });

  it('rejects invalid jsonrpc version', () => {
    expect(() => parseRequest('{"jsonrpc":"1.0","id":1,"method":"x"}')).toThrow();
  });
});
```

**Step 2: 跑测试看红**
Run: `pnpm --filter @desksoul/protocol test`
Expected: FAIL `parseRequest is not defined`.

**Step 3: 写实现**

`src/jsonrpc.ts`:
```ts
import { z } from 'zod';

export const JsonRpcRequest = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.number(), z.string(), z.null()]),
  method: z.string(),
  params: z.unknown().optional(),
});
export type JsonRpcRequest = z.infer<typeof JsonRpcRequest>;

export const JsonRpcNotification = z.object({
  jsonrpc: z.literal('2.0'),
  method: z.string(),
  params: z.unknown().optional(),
});

export const JsonRpcResponse = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.number(), z.string(), z.null()]),
  result: z.unknown().optional(),
  error: z.object({ code: z.number(), message: z.string(), data: z.unknown().optional() }).optional(),
});

export function parseRequest(line: string): JsonRpcRequest {
  return JsonRpcRequest.parse(JSON.parse(line));
}
```

**Step 4: 跑测试看绿**
Run: `pnpm --filter @desksoul/protocol test`
Expected: PASS。

**Step 5: 提交**
```bash
git add packages/protocol
git commit -m "feat(protocol): json-rpc 2.0 schema with zod"
```

### Task S2.2: 在 protocol 中定义 S2 用到的 method 签名

**Files:**
- Create: `packages/protocol/src/methods.ts`

```ts
import { z } from 'zod';

export const Methods = {
  'sys.ping': {
    params: z.object({ nonce: z.string() }),
    result: z.object({ pong: z.string(), echoNonce: z.string() }),
  },
} as const;

export type MethodName = keyof typeof Methods;
```

**Commit:** `feat(protocol): define sys.ping method signature`

### Task S2.3: sidecar 业务模块实现 JSON-RPC handler

**Files:**
- Modify: `apps/sidecar/package.json`（加 `@desksoul/protocol` 依赖、`zod`）
- Create: `apps/sidecar/src/server.ts`
- Create: `apps/sidecar/src/worker-entry.ts`
- Create: `apps/sidecar/test/server.test.ts`

> v0.2 调整：sidecar 不再是独立进程，而是被 Electron Main 直接 import 的"业务大脑模块"。`server.ts` 作为纯函数 `handleRequest(req): res` 既能被 Main 同线程调用，也能被 Worker 内的 `worker-entry.ts` 包装成 MessagePort 服务。

**Step 1: 写测试（input 解析过的 JSON-RPC 帧 → output 响应帧）**

`test/server.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { handleRequest } from '../src/server';

describe('sidecar server', () => {
  it('responds to sys.ping', async () => {
    const out = await handleRequest({
      jsonrpc: '2.0', id: 1, method: 'sys.ping', params: { nonce: 'abc' },
    });
    expect(out).toEqual({
      jsonrpc: '2.0', id: 1,
      result: { pong: 'ok', echoNonce: 'abc' },
    });
  });

  it('returns -32601 for unknown method', async () => {
    const out = await handleRequest({ jsonrpc: '2.0', id: 2, method: 'nope' });
    expect((out as any).error.code).toBe(-32601);
  });
});
```

**Step 2: 看测试红 → 写实现**

`src/server.ts`:
```ts
import type { JsonRpcRequest } from '@desksoul/protocol';

export async function handleRequest(req: JsonRpcRequest) {
  if (req.method === 'sys.ping') {
    const p = req.params as { nonce: string };
    return { jsonrpc: '2.0' as const, id: req.id, result: { pong: 'ok', echoNonce: p.nonce } };
  }
  return {
    jsonrpc: '2.0' as const, id: req.id,
    error: { code: -32601, message: 'Method not found' },
  };
}
```

`src/worker-entry.ts`（Worker 内 MessagePort 适配；S2.4 会用到）：
```ts
import { parentPort } from 'node:worker_threads';
import { parseRequest } from '@desksoul/protocol';
import { handleRequest } from './server.js';

if (!parentPort) throw new Error('worker-entry must run in worker_threads');

parentPort.on('message', async (raw) => {
  try {
    const req = parseRequest(JSON.stringify(raw));
    const res = await handleRequest(req);
    parentPort!.postMessage(res);
  } catch (e) {
    parentPort!.postMessage({
      jsonrpc: '2.0', id: null,
      error: { code: -32700, message: 'Parse error', data: String(e) },
    });
  }
});
```

**Step 3: 跑测试**
Run: `pnpm --filter @desksoul/sidecar test`
Expected: PASS。

**Commit:** `feat(sidecar): handleRequest + worker MessagePort entry for sys.ping`

### Task S2.4: spike-s2 子项目：Main 内 Worker 启停与 RPC 路由

**Files:**
- Create: `apps/spikes/S2-worker-rpc/`（Electron 项目）
- Create: `apps/spikes/S2-worker-rpc/electron/main/plugin-host.ts`
- Create: `apps/spikes/S2-worker-rpc/electron/main/ipc-router.ts`

可以复制 Task 0.4 的脚手架作为起点，依赖：
```bash
pnpm --filter @desksoul/spike-s2 add -D electron@^30 electron-vite@^2 vite@^6 typescript@~5.6 vitest@^1.6
pnpm --filter @desksoul/spike-s2 add @desksoul/protocol@workspace:* @desksoul/sidecar@workspace:*
```

**Main 端职责：**
1. 启动时 `new Worker(require.resolve('@desksoul/sidecar/dist/worker-entry.js'))`
2. 维护 `pending: Map<id, {resolve, reject}>`、`nextId`
3. 监听 Worker `message` / `error` / `exit` 事件
4. Worker 退出 / 抛错 → 1s + 指数退避（封顶 30s）重启
5. 提供 `ipcMain.handle('desksoul:rpc', async (_, {method, params}) => callWorker(method, params))`

**核心代码骨架** `plugin-host.ts`：
```ts
import { Worker } from 'node:worker_threads';
import path from 'node:path';

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

export class PluginHost {
  private worker: Worker | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private backoff = 1_000;

  constructor(private entryPath: string) { this.spawn(); }

  private spawn() {
    this.worker = new Worker(this.entryPath, { resourceLimits: { maxOldGenerationSizeMb: 128 } });
    this.worker.on('message', (msg: any) => {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      msg.error ? p.reject(Object.assign(new Error(msg.error.message), msg.error)) : p.resolve(msg.result);
    });
    this.worker.on('error', (e) => this.handleDeath('error', e));
    this.worker.on('exit', (code) => code !== 0 && this.handleDeath('exit', new Error(`exit ${code}`)));
    this.backoff = 1_000;  // reset on healthy spawn
  }

  private handleDeath(_kind: string, _err: Error) {
    // reject all pending
    for (const p of this.pending.values()) p.reject(new Error('worker died'));
    this.pending.clear();
    const wait = this.backoff;
    this.backoff = Math.min(this.backoff * 2, 30_000);
    setTimeout(() => this.spawn(), wait);
  }

  async call(method: string, params?: unknown): Promise<unknown> {
    if (!this.worker) throw new Error('no worker');
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker!.postMessage({ jsonrpc: '2.0', id, method, params });
    });
  }

  // for spike: manual kill
  terminate() { this.worker?.terminate(); }
}
```

`ipc-router.ts`：
```ts
import { ipcMain } from 'electron';
import { PluginHost } from './plugin-host.js';

export function registerRpc(host: PluginHost) {
  ipcMain.handle('desksoul:rpc', (_e, { method, params }) => host.call(method, params));
  ipcMain.handle('s2:kill-worker', () => host.terminate());
}
```

`electron/main/index.ts` 在 `app.whenReady()` 里：
```ts
const host = new PluginHost(require.resolve('@desksoul/sidecar/dist/worker-entry.js'));
registerRpc(host);
```

**测试：**
- Vitest 单测：mock `Worker`（用 `node:worker_threads` 真起一个 fixture worker 或 `EventEmitter` 替身）→ 验证 call/response 来回 + 重启
- spike 手测：Renderer 按钮 → `window.desksoul.rpc('sys.ping', {nonce:'x'})` → 显示返回
- DevTools 触发 `window.desksoul.rpc('s2:kill-worker' as any, undefined)` 或 Main 测试代码调 `host.terminate()` → 等 1s 再点 ping 按钮 → 仍成功

### Task S2.5: 编写 Worker 重启测试 + 手测脚本

**Vitest 自动化（推荐，跨平台）** `apps/spikes/S2-worker-rpc/test/plugin-host.test.ts`：
```ts
import { describe, it, expect } from 'vitest';
import { PluginHost } from '../electron/main/plugin-host';
import path from 'node:path';

describe('PluginHost', () => {
  it('reconnects after terminate, with exponential backoff', async () => {
    const entry = require.resolve('@desksoul/sidecar/dist/worker-entry.js');
    const host = new PluginHost(entry);
    const r1 = await host.call('sys.ping', { nonce: 'a' });
    expect(r1).toMatchObject({ echoNonce: 'a' });

    host.terminate();
    // expect: 1s backoff then back
    await new Promise(r => setTimeout(r, 1500));
    const r2 = await host.call('sys.ping', { nonce: 'b' });
    expect(r2).toMatchObject({ echoNonce: 'b' });

    host.terminate();
    await new Promise(r => setTimeout(r, 2500));
    const r3 = await host.call('sys.ping', { nonce: 'c' });
    expect(r3).toMatchObject({ echoNonce: 'c' });
  });
});
```

**手测**：spike-s2 UI 上加一个"模拟 Worker 崩溃"按钮，连按 3 次，观察控制台 backoff 日志 1s / 2s / 4s。

**完成 → 写 RESULTS.md → `git tag spike/S2-passed`。**

---

## Spike S3 · VRM 加载 + BlendShape

**目标：** three-vrm 加载 VRM 0.x / 1.0 模型，8 种基础情绪 BlendShape 切换，≥30 FPS。

### Task S3.1: spike 子项目 + 找一个免费 VRM 模型

**资源：** VRoid Hub 上有 CC0 / 自由二改的模型，下载一个放 `apps/spikes/S3-vrm/public/models/sample.vrm`。

### Task S3.2: 加载 + idle 动画

```ts
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

const loader = new GLTFLoader();
loader.register((parser) => new VRMLoaderPlugin(parser));

loader.load('/models/sample.vrm', (gltf) => {
  const vrm = gltf.userData.vrm;
  VRMUtils.removeUnnecessaryJoints(vrm.scene);
  scene.add(vrm.scene);
  // ...
});
```

### Task S3.3: 8 种情绪映射 + UI 切换按钮

VRM 1.0 expression preset：`happy / angry / sad / relaxed / surprised`，自定义补：`shy / thinking / confused`。

UI 加 8 个按钮，点击调 `vrm.expressionManager.setValue(name, 1.0)`。

### Task S3.4: 帧率监控

加 `stats.js`，记录 30s 平均 FPS，写入 RESULTS.md。

**完成判据：** 8 emotion 切换流畅、平均 ≥30 FPS、表情过渡 350-500ms 平滑。

`git tag spike/S3-passed`。

---

## Spike S4 · 一次完整流式对话

**目标：** Renderer (UI Overlay) → Main → ProviderWorker → BehaviorParser → 双路输出（chat.stream + behavior.applyEmotion）→ UI 文本流 + Character Renderer 表情切换。Cancel 可中止。

**前置：** S1+S2+S3 都已通过。

### Task S4.1: 在 protocol 加 chat.* 与 behavior.* method

`packages/protocol/src/methods.ts` 扩展：
- `chat.send` (request)
- `chat.cancel` (notification)
- `chat.stream` (notification)
- `chat.done` (notification)
- `behavior.applyEmotion` (notification)

### Task S4.2: BehaviorParser 流式增量解析（TDD）

**这是 Spike 的核心难点之一。** 严格 TDD：

`packages/protocol/test/behavior-parser.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { BehaviorParser } from '../src/behavior-parser';

describe('BehaviorParser', () => {
  it('emits text delta only when no tag', () => {
    const p = new BehaviorParser();
    const events = [...p.feed('hello world')];
    expect(events).toEqual([{ type: 'text', text: 'hello world' }]);
  });

  it('strips and emits emotion tag', () => {
    const p = new BehaviorParser();
    const events = [...p.feed('hi <emo:shy/> there')];
    expect(events).toEqual([
      { type: 'text', text: 'hi ' },
      { type: 'emotion', name: 'shy', weight: 1.0 },
      { type: 'text', text: ' there' },
    ]);
  });

  it('buffers incomplete tag across feed() calls', () => {
    const p = new BehaviorParser();
    const e1 = [...p.feed('hi <emo:')];
    const e2 = [...p.feed('happy/> bye')];
    expect(e1).toEqual([{ type: 'text', text: 'hi ' }]);
    expect(e2).toEqual([
      { type: 'emotion', name: 'happy', weight: 1.0 },
      { type: 'text', text: ' bye' },
    ]);
  });

  // ... 更多 case：act/wait/intent header/非法标签/超时 flush
});
```

实现状态机参考 tech-design §4.1（第 164-173 行）。

**Commit per case 通过。**

### Task S4.3: Mock Provider Worker（不真连 OpenAI）

`apps/sidecar/src/workers/mock-provider.ts`：吐预设 chunks，模拟 50ms 间隔。

```ts
const SCRIPT = [
  '[intent mood=shy energy=low]\n',
  '嗯…<emo:shy/>',
  '我在想要不要',
  '<act:fidget dur=1500/>请你',
  '喝杯热可可？<emo:happy/>',
];
```

### Task S4.4: 在 Main + Worker 接 chat.send → MockProvider → BehaviorParser → 推 notification

完整管线串起来：
- Renderer 调 `window.desksoul.rpc('chat.send', {...})`
- Main 内 ipc-router 转发到 ConversationCore（Main 进程内模块）
- ConversationCore 调 PluginHost.invokeWorker('mock-provider', ...)
- Worker 边吐 delta 边经 MessagePort 回 Main
- BehaviorParser（Main 内）拆分 → 经 `webContents.send` 同时推到 UI Overlay (`chat.stream`) 与 Character Renderer (`behavior.applyEmotion`)

### Task S4.5: spike-s4 端到端验证

UI Overlay Renderer 显示文本流；Character Renderer（来自 S3）按 emotion notification 切表情。

**判据：** 边出文本边变表情；输入框点 cancel → 流停止。

`git tag spike/S4-passed`。

---

## Spike S5 · Worker 沙箱权限网关

**目标：** Provider Worker 调 fetch 时 Main 拦截注 Authorization；Worker 内 `process.env`、读 secrets 全失败；外发请求 host 白名单生效。

### Task S5.1: 在 Main 内写 PluginHost 雏形（生产化版本）

启动 Worker 时：
- `new Worker(path, { execArgv: ['--experimental-permission', '--allow-fs-read=...'], env: {} })`
- 通过 MessagePort 传递 init 消息（包含 `allowedHosts`）

### Task S5.2: Worker 内的 `globalThis.fetch` 替换为 proxy

```ts
// 在 worker entry 顶部
import { parentPort } from 'node:worker_threads';
const _origFetch = globalThis.fetch;
globalThis.fetch = (async (url, init) => {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const handler = (msg: any) => {
      if (msg.id !== id) return;
      parentPort!.off('message', handler);
      msg.ok ? resolve(new Response(msg.body, { status: msg.status })) : reject(new Error(msg.error));
    };
    parentPort!.on('message', handler);
    parentPort!.postMessage({ kind: 'fetch', id, url: String(url), init });
  });
}) as any;
```

PluginHost 收到 `kind: fetch` → 检查 host 白名单 → 从 `safeStorage` 解密对应 Provider 的 API key → 用 Electron `net.request` 实际发起请求 → 流式回响应（chunked）。

### Task S5.3: 在 Worker 里写一个对抗测试

`apps/spikes/S5-sandbox/test-worker.js`：
```js
const tries = [];
try { tries.push(['process.env.SECRET', process.env.SECRET]); } catch (e) { tries.push(['env', e.message]); }
try { const fs = require('node:fs'); fs.readFileSync('C:\\Windows\\System32\\drivers\\etc\\hosts'); tries.push(['fs ok', true]); } catch (e) { tries.push(['fs', e.message]); }
try { const r = await fetch('https://evil.example.com/'); tries.push(['evil host', r.status]); } catch (e) { tries.push(['evil host', e.message]); }
parentPort.postMessage(tries);
```

**判据：** env 读不到、fs 读 hosts 失败、evil.example.com 被 PluginHost 拒绝。Allowed host（如 api.openai.com）走通。

`git tag spike/S5-passed`。

---

**Phase 1 完成判据：**
- [ ] S1–S5 全部 tag 已打
- [ ] 每个 spike 目录下有 RESULTS.md
- [ ] 任何失败已回写 tech-design 修订（如有）

进入 Phase 2 前**强制 review**：把 5 个 RESULTS.md 汇总成一份 `docs/spike-summary.md`，列出"哪些原假设站住、哪些被证伪、哪些需要在 MVP 阶段额外注意"。

---

# Phase 2 · MVP 切片（预计 8–10 周）

> **关键纪律：** 进入每个里程碑前，**必须**用 `superpowers:writing-plans` 把该里程碑展开为 bite-sized 任务（参考 Phase 0/1 的颗粒度）。本节只给出范围、关键文件、验收标准。

> 不要"看着这一节就埋头写"——里程碑级描述足以让你估时和排序，但不足以做 TDD 步骤级执行。

## M1 · 架构骨架收口与 spike 代码迁移（1 周）

**范围：**
- 把 S1–S5 验证过的代码迁移到 `apps/desktop`（Electron Main / Preload / Renderer）+ `apps/sidecar`（业务大脑模块）+ `packages/protocol`，不再独立 spike 项目
- protocol 包定型：`@desksoul/protocol` 包含 jsonrpc.ts、methods.ts、behavior-parser.ts、schemas.ts；导出 Zod schema 给 Main / Renderer / Worker 三端共享 import（单一真源）
- Main / Renderer / Worker 三端在构建时通过 `electron-vite` + `externalizeDepsPlugin()` 共享 protocol；运行时由 Main 在路由层做 schema 校验
- 三窗口创建（character / ui-overlay / settings hidden），均 sandbox + contextIsolation 启用

**关键文件：**
- `packages/protocol/src/{jsonrpc,methods,behavior-parser,schemas}.ts`
- `apps/desktop/electron/main/{index,windows,ipc-router,plugin-host}.ts`
- `apps/desktop/electron/preload/index.ts`
- `apps/sidecar/src/{server,workers,plugin-host-types}.ts`
- `apps/desktop/src/renderer/character/`（character Renderer 代码）
- `apps/desktop/src/renderer/overlay/`（ui-overlay Renderer 代码）

**验收：**
- 三窗口都能启动且崩溃隔离（杀任一进程其余仍 alive）
- protocol schema 单一真源生效（删字段两端编译期都报错）
- E2E：UI overlay 发 `chat.send` (mock provider) → character window 切表情

## M2 · IPC 完整四命名空间 + 取消 + 背压（1 周）

**范围：** tech-design §3 全部
- `app.* / chat.* / behavior.* / plugin.*` 四类 method 落地
- AbortSignal 三层传播（Renderer → Main → Worker）+ 200ms 未确认强制取消（PluginHost `terminate`）
- notification 队列 backpressure（每 session 上限 N 条，溢出合并 deltas）
- 进程崩溃恢复：UI `chat.snapshot {sessionId}` 拉最近 N 条重建视图

**验收：**
- 流式过程中点 cancel，全链路 200ms 内停
- 模拟下游慢消费 → 队列不无限涨 → deltas 合并但消息边界不丢
- 强杀 Worker / 重启 Main → 重启后 UI 自动 `chat.snapshot` 重建对话

## M3 · 行为协议生产化（0.5 周）

**范围：** BehaviorParser 从 spike 形态升级到生产
- 完整支持 §4.1 全部标签（intent/emo/act/wait；say 留 stub）
- fail-safe：300ms 超时 flush、非法标签原样输出 + warn 日志
- Persona few-shot 模板写入 `packages/protocol/src/persona-prompt-template.ts`
- 单测覆盖率 ≥ 90%

**验收：**
- 100+ 边界 case 测试全过（含半截标签、嵌套、流截断、误用）

## M4 · 渲染层 CharacterRuntime（1.5 周）

**范围：** tech-design §7 完整 CharacterRuntime 接口
- VRM 引擎实现（Three.js + three-vrm）：load / dispose / applyEmotion / playAction / setLookAt / setIdle
- 资产加载安全：Main 校验 manifest 路径不越级 + 注册 `protocol.handle('asset', ...)` 生成 `asset://` URL
- LookAt 30Hz 节流 + 平滑插值
- Idle 动画池 + intent 子集选择 + 90s 主动行为事件
- 性能预算：单角色 ≤8 万三角面、≤64MB 纹理；FPS 监控

**验收：**
- 跑 D4 缩放 50–200% 不掉帧（≥30 FPS）
- 8 种基础 emotion 切换流畅
- 内置 1 个角色包能完整加载

## M5 · Provider 插件运行时 + OpenAI 兼容 + Ollama（1.5 周）

**范围：** tech-design §4.3 + §5
- `@desksoul/plugin-sdk` 定型：`defineProvider / defineSkill / defineTool`
- PluginHost：Worker 沙箱、fetch 拦截、host 白名单、Authorization 注入
- 内置 `provider-openai-compat`：OpenAI / Claude / Gemini / DeepSeek / 通义都走这个（差异化 endpoint + 模型名）
- 内置 `provider-ollama`：本地零配置探测
- 取消（AbortSignal）端到端
- token usage 统计 + 兜底 tiktoken 估算
- Keychain 密钥存储（Win Credential Manager；不可用时 AES-256-GCM 兜底）

**验收：**
- 配 OpenAI Key → 能完整跑通流式对话
- 配错 Key → 401 错误正确分级展示（J3）
- Ollama 启动后自动检测 + 可用
- Worker 内 secrets 读不到（grep `process.env` 无可用密钥）

## M6 · 状态层（Working + Persona State）+ 数据层（1 周）

**范围：** tech-design §6 + §8 MVP 子集
- better-sqlite3 + WAL，schema 按 §6 创建 `messages / persona_state / facts / episodes`
- 单连接归 Main，Worker 不直连
- 写路径：每条 msg 立刻 commit；每轮结束更新 persona_state
- ContextAssembler：组装 working memory（最近 20 轮）+ persona state → ProviderRequest
- 角色隔离（character_id 强制前缀）
- 导出：一键 `.dsbak` zip
- Episodic / Semantic / sqlite-vec 留接口 stub（V1.0 启用）

**验收：**
- 跑 100 轮对话，DB < 5MB，查询单角色最近 20 轮 < 10ms
- 强杀进程后重启对话历史完整
- D7 数据管理 UI 能看到存储占用

## M7 · 设置面板 UI（D 系列 + 引导 C 系列）（1.5 周）

**范围：** UI 设计文档 §3 + §6 + §7 MVP 部分
- Hub Window 骨架（左导航 + 顶栏 + 状态条）
- D2 通用 / D3 模型 API（双栏）/ D4 显示与窗口 / D6 隐私 / D8 关于
- C1–C4 首次启动引导（含演示模式降级）
- §2 设计系统：玻璃面板组件库（GlassPanel、Button、Input、KeyCap、Toast 等）
- 浅色为默认 + 深色备选 + 跟随系统
- 主题 token 统一在 `apps/desktop/src/overlay/theme/`

**验收：**
- 90 秒内能完成"看到角色 → 配 Key → 听到回复"
- 所有 D 系列设置即时生效（无保存按钮）
- 危险操作按 §2.8 三档规范执行

## M8 · 聊天 UI（B1/B2）+ 桌面气泡（A1/A2/A3/A4）+ 系统集成（J1/J2/J3/J5）（1.5 周）

**范围：**
- B1 聊天浮层（420×560，可分离吸附）
- B2 流式气泡（双轨：文本 + emotion chip）
- A1 角色窗口交互（点击/双击/长按拖拽/右键菜单/Hover 悬浮提示）
- A2 桌面气泡（自动消失、方向自适应、DND 降级）
- A3 穿透切换瞬间反馈
- A4 不打扰 / 全屏检测自动隐藏
- J1 系统托盘 + 三态图标
- J2 全局热键录制器（含冲突检测）
- J3 API 失败的"歪头疑惑"角色态 + 错误分级文案
- J5 崩溃上报对话框

**验收：**
- 端到端用户旅程跑通（看 UI 设计 §6.1–§6.5 引导 + §5 桌面层）
- 杀软不报警（手动验）
- 高 DPI / 多显示器正常

## M9 · 打包 + 体验打磨 + 文档（1 周）

**范围：**
- Electron 打包 for Win 10/11（x64）：`electron-vite build && electron-builder` 输出 NSIS 安装包 + portable zip
- 验证 `asar` 打包 + native modules（better-sqlite3）的 `electron-rebuild`：CI 上跑 `pnpm rebuild better-sqlite3 --runtime=electron --target=$ELECTRON_VERSION`
- 安装包签名（如有证书）；体积评估 base ~80MB + better-sqlite3 + three.js ≈ 100MB 上下
- 性能 profile：内存 ≤ 400MB（idle）、启动 < 3s
- 用户手册（D8 链接的 `用户手册`）：基础使用 + 5 个 FAQ
- README.md 升级为面向用户

**验收：**
- 在干净 Win 10 + Win 11 虚机上安装 + 跑通端到端流程
- Defender + 火绒不报警
- v0.1.0 安装包 ≤ 120MB（Electron base + better-sqlite3 + three.js；不含 Ollama / VRM 模型）

---

## Phase 2 完成总判据（v0.1 发布门）

- [ ] tech-design §9.1 表格内所有 ✅ 项全部完成
- [ ] 5 个 spike 的成功判据**回归测试**仍全过
- [ ] 完整端到端用户旅程在干净 Win 10 / Win 11 上通过
- [ ] 用户手册 + 隐私政策 + 数据流向说明文档齐
- [ ] CI 全绿、无 P0/P1 已知 bug

`git tag v0.1.0` → 发布。

---

# 风险与降级预案

| 触发条件 | 应对 |
| --- | --- |
| Spike S1 失败 | 暂停整体计划，回 tech-design §7 重选渲染层方案；评估是否引入 Win 原生 native module 调 `SetWindowLong WS_EX_LAYERED + WS_EX_TRANSPARENT`、或退回 Tauri 方案（重大返工） |
| Spike S2 失败 | 评估改 `utilityProcess` 拆出业务进程、或退回 stdio 子进程方案（牺牲单进程简化） |
| Spike S5 失败 | 收紧到只允许内置 Provider，第三方插件推迟到 V1.0+ |
| MVP 任一里程碑超时 ≥ 50% | 启动范围裁剪会议，参照 §9.1 表"MVP 不做"列扩大 |
| Electron 安装包体积 > 150MB | 启用 `electron-builder` 的 `compression: maximum` + `asarUnpack` 收紧 + 7z 二次压缩；评估是否做 setup vs portable 双发行 |
| 杀软误报 | 申请 Microsoft Smart Screen 信誉、申请 360 / 火绒白名单 |

---

# 附录：执行须知

1. **每个里程碑开新分支**：`feat/m1-skeleton`、`feat/m2-ipc` 等，PR merge 到 main
2. **每个 PR 至少**：通过 CI、附 RESULTS / DEMO 录屏（可选）、code review（如单人项目可自审）
3. **不跳 Spike**：tech-design §9.2 是写进合同的"骨架不打折"承诺
4. **遇到 tech-design 与现实冲突**：先改 tech-design（PR + 决策记录）再改代码，不要让代码偷偷违背设计
5. **每周一份 STATUS.md**：写到 `docs/status/YYYY-WW.md`，列本周完成 + 下周计划 + 阻塞
