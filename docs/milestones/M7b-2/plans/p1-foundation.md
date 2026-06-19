# M7b-2 P1 地基 Implementation Plan（onboarding prefs + finishOnboarding RPC + 首启判定 + 引导窗 + renderer 脚手架）

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans（或 subagent-driven-development）逐 task 实现。步骤用 `- [ ]`。

**Goal:** 立起首启引导的后端 + 窗口地基——新增 `onboarding.completed` prefs、`app.window.finishOnboarding` 编排 RPC、首启判定纯函数、第 4 个 `onboarding` renderer 窗口与脚手架，使 P2–P4 可纯前端填充引导步骤。

**Architecture:** 延续 M7a/M7b-1：扁平 dotted-key `PrefsSchema` 单一真源；窗口编排在 `index.ts`，业务/可测逻辑下沉纯模块（`startup.ts` 判定、`onboarding-service.ts` 工厂，仿 `app-service.ts`）；renderer 多入口（electron-vite input + `src/renderer/onboarding/`），mock-bridge + theme tokens 复用。

**Tech Stack:** TS strict、Zod、Electron Main（BrowserWindow/screen）、Vue 3、electron-vite、Vitest。

**关联 spec:** [`../spec.md`](../spec.md)（本计划覆盖其 §7 的 **P1**）。分支沿用 `feat/m7b1-d-series`（或新开 `feat/m7b2-onboarding`，由执行者定）。

**测试运行：** protocol `pnpm --filter @desksoul/protocol exec vitest run test/<f>.test.ts`；desktop `pnpm --filter @desksoul/desktop exec vitest run test/<f>.test.ts`；全量 `pnpm --filter @desksoul/desktop test`；typecheck `pnpm --filter @desksoul/desktop typecheck`；构建 `pnpm --filter @desksoul/desktop build`；格式 `pnpm exec prettier --write <files>`。每 task 末提交。

---

## 文件结构
- 改 `packages/protocol/src/prefs.ts`（+`onboarding.completed`）、`packages/protocol/src/methods.ts`（+`app.window.finishOnboarding`）
- 新 `apps/desktop/electron/main/startup.ts`（`decideStartup` 纯函数）
- 新 `apps/desktop/electron/main/onboarding-service.ts`（finishOnboarding 工厂）
- 改 `apps/desktop/electron/main/windows.ts`（+onboarding 窗 + 定位 + targets）
- 改 `apps/desktop/electron/main/ipc-router.ts`（spread onboarding-service + deps onboardingWindow/overlayWindow）
- 改 `apps/desktop/electron/main/index.ts`（createAppWindows 含 onboarding、decideStartup 分支、传 deps）
- 改 `apps/desktop/electron.vite.config.ts`（+onboarding entry）
- 新 `apps/desktop/src/renderer/onboarding/{index.html,main.ts,App.vue}`（脚手架，空壳）
- 测试：`packages/protocol/test/prefs.test.ts`(追加)、`apps/desktop/test/startup.test.ts`(新)、`apps/desktop/test/onboarding-service.test.ts`(新)

---

## Task 1: prefs `onboarding.completed`

**Files:** Modify `packages/protocol/src/prefs.ts`；Test `packages/protocol/test/prefs.test.ts`

- [ ] **Step 1: 追加失败测试**

```ts
// packages/protocol/test/prefs.test.ts — 追加到末尾
describe('PrefsSchema onboarding flag (M7b-2)', () => {
  it('defaults onboarding.completed to false', () => {
    expect(DEFAULT_PREFS['onboarding.completed']).toBe(false);
  });
  it('validates onboarding.completed as boolean', () => {
    expect(PrefsSchema.shape['onboarding.completed'].safeParse(true).success).toBe(true);
    expect(PrefsSchema.shape['onboarding.completed'].safeParse('yes').success).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @desksoul/protocol exec vitest run test/prefs.test.ts`
Expected: FAIL — `DEFAULT_PREFS['onboarding.completed']` undefined。

- [ ] **Step 3: 实现（在 `PrefsSchema` 对象内 `offline.ollamaModel` 之后追加）**

```ts
  // onboarding（M7b-2 首启引导）
  'onboarding.completed': z.boolean().default(false),
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @desksoul/protocol exec vitest run test/prefs.test.ts`
Expected: PASS（原有 + 新增 2 用例）。

- [ ] **Step 5: 重建 protocol dist（desktop import 用，[[build-test-workflow-gotchas]]）+ 提交**

```bash
pnpm --filter @desksoul/protocol build
git add packages/protocol/src/prefs.ts packages/protocol/test/prefs.test.ts
git commit -m "feat(protocol): add onboarding.completed pref (M7b-2)"
```

---

## Task 2: 首启判定 `decideStartup`（纯函数）

**Files:** Create `apps/desktop/electron/main/startup.ts`；Test `apps/desktop/test/startup.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// apps/desktop/test/startup.test.ts
import { describe, it, expect } from 'vitest';
import { decideStartup } from '../electron/main/startup';
import { DEFAULT_PREFS } from '@desksoul/protocol';

describe('decideStartup（首启显引导 vs 常规）', () => {
  it('onboarding.completed=false → 显引导', () => {
    expect(decideStartup({ ...DEFAULT_PREFS, 'onboarding.completed': false })).toEqual({
      showOnboarding: true,
    });
  });
  it('onboarding.completed=true → 常规（不显引导）', () => {
    expect(decideStartup({ ...DEFAULT_PREFS, 'onboarding.completed': true })).toEqual({
      showOnboarding: false,
    });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @desksoul/desktop exec vitest run test/startup.test.ts`
Expected: FAIL — cannot find module startup。

- [ ] **Step 3: 实现**

```ts
// apps/desktop/electron/main/startup.ts
/**
 * 启动期决策（纯函数，无 Electron 依赖，便于单测）。
 * M7b-2：未完成首启引导 → 先显引导窗、暂不显 overlay；否则常规流程。
 */
import type { Prefs } from '@desksoul/protocol';

export interface StartupDecision {
  showOnboarding: boolean;
}

export function decideStartup(prefs: Prefs): StartupDecision {
  return { showOnboarding: !prefs['onboarding.completed'] };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @desksoul/desktop exec vitest run test/startup.test.ts`
Expected: PASS (2)

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/electron/main/startup.ts apps/desktop/test/startup.test.ts
git commit -m "feat(desktop): decideStartup pure fn (first-run → show onboarding)"
```

---

## Task 3: `app.window.finishOnboarding`（method + onboarding-service 工厂）

**Files:** Modify `packages/protocol/src/methods.ts`；Create `apps/desktop/electron/main/onboarding-service.ts`；Test `apps/desktop/test/onboarding-service.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// apps/desktop/test/onboarding-service.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createOnboardingService } from '../electron/main/onboarding-service';

function fakeWin() {
  return { isDestroyed: () => false, hide: vi.fn(), show: vi.fn() };
}

describe('onboarding-service · finishOnboarding', () => {
  it('置 onboarding.completed=true + 隐引导窗 + 显 overlay', async () => {
    const set = vi.fn();
    const onboarding = fakeWin();
    const overlay = fakeWin();
    const svc = createOnboardingService({
      prefsStore: { set, getAll: () => ({}) as never, close: () => {} },
      onboardingWindow: () => onboarding as never,
      overlayWindow: () => overlay as never,
    });
    const r = await svc['app.window.finishOnboarding']();
    expect(r).toEqual({ ok: true });
    expect(set).toHaveBeenCalledWith('onboarding.completed', true);
    expect(onboarding.hide).toHaveBeenCalled();
    expect(overlay.show).toHaveBeenCalled();
  });

  it('窗口缺失时安全 no-op（仍置 flag）', async () => {
    const set = vi.fn();
    const svc = createOnboardingService({
      prefsStore: { set, getAll: () => ({}) as never, close: () => {} },
      onboardingWindow: () => null,
      overlayWindow: () => null,
    });
    await expect(svc['app.window.finishOnboarding']()).resolves.toEqual({ ok: true });
    expect(set).toHaveBeenCalledWith('onboarding.completed', true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @desksoul/desktop exec vitest run test/onboarding-service.test.ts`
Expected: FAIL — cannot find module onboarding-service。

- [ ] **Step 3: 实现**

`packages/protocol/src/methods.ts`：在 `app.window.openHub` 之后插入：
```ts
  'app.window.finishOnboarding': {
    // 首启引导完成/跳过完成：置 onboarding.completed + 收起引导窗 + 唤起 overlay。
    params: z.object({}),
    result: z.object({ ok: z.literal(true) }),
  },
```

```ts
// apps/desktop/electron/main/onboarding-service.ts
/**
 * OnboardingService —— app.window.finishOnboarding 的 Main 编排（M7b-2）。
 * renderer 调一次即完成三动作：置完成 flag（直接 prefsStore.set，无需广播——
 * 仅下次启动判定用）+ 隐引导窗 + 显 overlay。仿 app-service 工厂，注入便于测。
 */
import type { BrowserWindow } from 'electron';
import type { PrefsStore } from './prefs/index.js';

export interface OnboardingServiceDeps {
  prefsStore: PrefsStore;
  onboardingWindow: () => BrowserWindow | null;
  overlayWindow: () => BrowserWindow | null;
}

export function createOnboardingService(deps: OnboardingServiceDeps) {
  return {
    'app.window.finishOnboarding': async () => {
      deps.prefsStore.set('onboarding.completed', true);
      const ob = deps.onboardingWindow();
      if (ob && !ob.isDestroyed()) ob.hide();
      const ov = deps.overlayWindow();
      if (ov && !ov.isDestroyed()) ov.show();
      return { ok: true as const };
    },
  };
}
```

- [ ] **Step 4: 跑测试确认通过 + 重建 protocol dist**

Run:
```bash
pnpm --filter @desksoul/protocol build
pnpm --filter @desksoul/desktop exec vitest run test/onboarding-service.test.ts
```
Expected: PASS (2)

- [ ] **Step 5: 提交**

```bash
git add packages/protocol/src/methods.ts apps/desktop/electron/main/onboarding-service.ts apps/desktop/test/onboarding-service.test.ts
git commit -m "feat(desktop): app.window.finishOnboarding RPC + onboarding-service factory"
```

---

## Task 4: 接线窗口与 renderer 脚手架（windows + ipc-router + index + electron-vite + onboarding 壳）

**Files:** Modify `apps/desktop/electron/main/windows.ts`、`apps/desktop/electron/main/ipc-router.ts`、`apps/desktop/electron/main/index.ts`、`apps/desktop/electron.vite.config.ts`；Create `apps/desktop/src/renderer/onboarding/{index.html,main.ts,App.vue}`

> 本 task 无单测（窗口创建/编排），靠 typecheck + build + dev 冒烟。前序 task 的纯逻辑（decideStartup/finishOnboarding）已覆盖判定与编排。

- [ ] **Step 1: windows.ts 加 onboarding 窗（480×600，角色左侧，show:false）**

`AppWindows` 接口加字段：
```ts
export interface AppWindows {
  character: BrowserWindow;
  overlay: BrowserWindow;
  settings: BrowserWindow;
  onboarding: BrowserWindow;
}
```
`loadRenderer` 的 name 联合类型加 `'onboarding'`：
```ts
async function loadRenderer(
  win: BrowserWindow,
  name: 'character' | 'overlay' | 'settings' | 'onboarding',
): Promise<void> {
```
在 `createAppWindows` 内 `settings` 创建之后、`attachCrashRecovery` 之前加：
```ts
  // 首启引导壳（M7b-2）：480×600 表单玻璃窗，吸附角色左侧 24px（角色在右下角，
  // 放其右侧会出屏，故置左侧）。常驻 show:false，首启时由 index.ts show。
  const ONBOARDING = { width: 480, height: 600 };
  const onboarding = new BrowserWindow({
    width: ONBOARDING.width,
    height: ONBOARDING.height,
    x: Math.max(
      workArea.x,
      workArea.x + workArea.width - CHARACTER_BASE_SIZE.width - margin - ONBOARDING.width - 24,
    ),
    y: workArea.y + Math.max(0, Math.round((workArea.height - ONBOARDING.height) / 2)),
    show: false,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    webPreferences: {
      preload: PRELOAD,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
```
`attachCrashRecovery` 段 + `loadRenderer` 段 + `return` 段各加 onboarding：
```ts
  attachCrashRecovery(onboarding, 'onboarding');
```
```ts
  void loadRenderer(onboarding, 'onboarding');
```
```ts
  return { character, overlay, settings, onboarding };
```
`rendererTargets` 数组加 onboarding：
```ts
    [wins.character, wins.overlay, wins.settings, wins.onboarding]
```

- [ ] **Step 2: electron.vite.config.ts 加 onboarding 入口**

`renderer.build.rollupOptions.input` 加一行：
```ts
          onboarding: resolve(__dirname, 'src/renderer/onboarding/index.html'),
```

- [ ] **Step 3: onboarding renderer 脚手架（空壳，P2 填充）**

```html
<!-- apps/desktop/src/renderer/onboarding/index.html -->
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>DeskSoul · 欢迎</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
```

```ts
// apps/desktop/src/renderer/onboarding/main.ts
import { createApp } from 'vue';
import App from './App.vue';
import '../theme/tokens.css';
import { subscribeTheme } from '../theme/subscribe';
import { installMockBridge } from '../dev/mock-bridge';

installMockBridge();
subscribeTheme();
createApp(App).mount('#app');
```

```vue
<!-- apps/desktop/src/renderer/onboarding/App.vue — P1 空壳，引导壳/步骤在 P2 -->
<script setup lang="ts">
// P1 地基占位：能加载、显玻璃面板即可。P2 接 wizard 状态机 + C1–C4 步骤。
</script>
<template>
  <div
    class="flex h-screen items-center justify-center text-base text-text-main"
    style="background: var(--ds-glass-bg)"
  >
    引导壳（P2 填充）
  </div>
</template>
```

- [ ] **Step 4: ipc-router.ts 接 onboarding-service + deps**

import 区加：
```ts
import { createOnboardingService } from './onboarding-service.js';
```
`IpcRouterDeps` 内（`settingsWindow?` 之后）加：
```ts
  /** 引导窗定位器（M7b-2）；finishOnboarding hide 它。 */
  onboardingWindow?: () => BrowserWindow | null;
  /** overlay 窗定位器（M7b-2）；finishOnboarding show 它。 */
  overlayWindow?: () => BrowserWindow | null;
```
在 `createRouter({ ... })` 内 `...(deps.appService ?? {}),` 之后加：
```ts
    ...createOnboardingService({
      prefsStore,
      onboardingWindow: deps.onboardingWindow ?? (() => null),
      overlayWindow: deps.overlayWindow ?? (() => null),
    }),
```

- [ ] **Step 5: index.ts 编排（createAppWindows 已含 onboarding；首启分支）**

import 区加：
```ts
import { decideStartup } from './startup.js';
```
`registerIpcRouter({ ... })` 参数里（`settingsWindow:` 之后）加：
```ts
    onboardingWindow: () => (wins && !wins.onboarding.isDestroyed() ? wins.onboarding : null),
    overlayWindow: () => (wins && !wins.overlay.isDestroyed() ? wins.overlay : null),
```
在 `registerIpcRouter` 调用之后、`startCursorPublisher` 之前加首启分支：
```ts
  // M7b-2 首启：未完成引导 → 收起 overlay、弹引导窗（character 照常显示，"先看到角色"）。
  if (decideStartup(prefsStore.getAll()).showOnboarding) {
    wins.overlay.hide();
    wins.onboarding.show();
  }
```

- [ ] **Step 6: typecheck + build + 全量回归**

Run:
```bash
pnpm --filter @desksoul/protocol test
pnpm --filter @desksoul/desktop typecheck
pnpm --filter @desksoul/desktop test
pnpm --filter @desksoul/desktop build
pnpm exec prettier --write apps/desktop/electron/main/windows.ts apps/desktop/electron/main/ipc-router.ts apps/desktop/electron/main/index.ts apps/desktop/electron.vite.config.ts apps/desktop/src/renderer/onboarding/main.ts apps/desktop/src/renderer/onboarding/App.vue
```
Expected: typecheck 干净；desktop/protocol 全量绿（新增 startup/onboarding-service 用例）；build exit 0（renderer 现 4 入口，产物含 `onboarding/index.html`）。

- [ ] **Step 7: 提交**

```bash
git add apps/desktop/electron/main/windows.ts apps/desktop/electron/main/ipc-router.ts apps/desktop/electron/main/index.ts apps/desktop/electron.vite.config.ts apps/desktop/src/renderer/onboarding/
git commit -m "feat(desktop): 4th onboarding window + first-run branch + finishOnboarding wiring + renderer scaffold"
```

---

## Self-Review（plan vs spec P1）
- **spec §2.1 引导窗（第 4 renderer，480×600，角色左侧，sandbox:true）**：T4 Step1/2/3 覆盖（windows.ts + electron-vite entry + 脚手架）✓。
- **spec §2.2 首启检测 + 编排**：`onboarding.completed`(T1) + `decideStartup`(T2) + index 分支(T4 Step5) + `finishOnboarding`(T3) 编排（置 flag + hide 引导 + show overlay）✓。
- **spec §2.6 新增 RPC `app.window.finishOnboarding`**：T3 method schema + service 工厂 + ipc-router spread(T4 Step4) ✓。
- **占位符**：无 TBD；每步完整代码/命令/预期。
- **类型一致**：`OnboardingServiceDeps`(T3) ↔ ipc-router 构造(T4 Step4) 字段一致（prefsStore/onboardingWindow/overlayWindow）；`AppWindows.onboarding`(T4 Step1) ↔ index getters(T4 Step5) 一致；`decideStartup` 返回 `{showOnboarding}`(T2) ↔ index 分支读法(T4 Step5) 一致；`PrefsStore.set` 签名(既有 store.ts) ↔ service 调用 `set('onboarding.completed', true)`(T3) 一致（T1 已加该键到 `PrefKey`）✓。
- **回归点**：overlay 现在首启时被 `hide()`（仅 `onboarding.completed=false` 时）；常规启动（flag=true）overlay 行为不变。renderer 入口从 3 → 4，build 产物多一个 html。protocol 需先 `build`（T1/T3 Step）desktop 才能 import 新 key/method。
- **依赖顺序**：T1（prefs key）必须先于 T3（service 用该 key）；T2/T3 互独立；T4 依赖 T1–T3 全部。
