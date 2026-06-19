# M8c P2 J1 系统托盘 Implementation Plan（Tray + 原生菜单 + 三态图标）

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans。步骤用 `- [ ]`。

**Goal:** 常驻系统托盘：三态图标（默认/思考/异常）+ 原生菜单（聊天/显隐/穿透/不打扰/打开 Hub/设置/退出）+ 鼠标动作（左键显隐、双击聊天、右键菜单、中键穿透）。

**Architecture:** 纯逻辑 `tray-icon.ts`（连接/思考/异常态 → 图标键）；`tray-service.ts`（创建 Tray + 菜单 + 动作接线，注入便于测）；菜单动作复用既有窗口操作 + M8b/M8a。

**关联 spec:** [`../spec.md`](../spec.md)（§1 J1 / §14.1）。**前置：M8a/M8b/M8c-P1 已落**。

> ⚠️ **图标资源**：需 3 个托盘 PNG（默认/思考/异常，建议 16/32px @2x）放 `apps/desktop/resources/tray/`，并经 electron-builder 打包。本期可先放占位 PNG，真件留视觉环节替换；`tray-icon.ts` 只决定用哪个键，文件存在性在 dev 真窗验证。

---

## 文件结构
- 新 `apps/desktop/electron/main/tray-icon.ts`（纯：状态→图标键）
- 新 `apps/desktop/electron/main/tray-service.ts`（Tray + 菜单 + 动作）
- 改 `apps/desktop/electron/main/index.ts`（创建托盘 + chat 态联动图标）
- 新 `apps/desktop/resources/tray/{default,thinking,error}.png`（占位，真件后替）
- 测试：`tray-icon.test.ts`、`tray-service.test.ts`

---

## Task 1: 托盘图标态机（纯）

**Files:** Create `apps/desktop/electron/main/tray-icon.ts`；Test `apps/desktop/test/tray-icon.test.ts`

- [ ] **Step 1: 失败测试**

```ts
// apps/desktop/test/tray-icon.test.ts
import { describe, it, expect } from 'vitest';
import { trayIconKey } from '../electron/main/tray-icon';

describe('trayIconKey（J1 三态）', () => {
  it('异常 > 思考 > 默认', () => {
    expect(trayIconKey({ error: true, thinking: true })).toBe('error');
    expect(trayIconKey({ error: false, thinking: true })).toBe('thinking');
    expect(trayIconKey({ error: false, thinking: false })).toBe('default');
  });
});
```

- [ ] **Step 2: 失败** — FAIL。

- [ ] **Step 3: 实现**

```ts
// apps/desktop/electron/main/tray-icon.ts
/** J1 托盘图标态（纯）：异常 > 思考 > 默认。 */
export type TrayIconKey = 'default' | 'thinking' | 'error';
export function trayIconKey(s: { error: boolean; thinking: boolean }): TrayIconKey {
  if (s.error) return 'error';
  if (s.thinking) return 'thinking';
  return 'default';
}
```

- [ ] **Step 4: 通过** — PASS (1)。

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/electron/main/tray-icon.ts apps/desktop/test/tray-icon.test.ts
git commit -m "feat(desktop): tray icon state machine (pure)"
```

---

## Task 2: tray-service（Tray + 菜单 + 动作）

**Files:** Create `apps/desktop/electron/main/tray-service.ts`；Test `apps/desktop/test/tray-service.test.ts`

- [ ] **Step 1: 失败测试（菜单模板，注入动作）**

```ts
// apps/desktop/test/tray-service.test.ts
import { describe, it, expect, vi } from 'vitest';
import { buildTrayMenuTemplate } from '../electron/main/tray-service';

describe('tray 菜单模板（§14.1）', () => {
  it('含核心项，点击触发注入动作', () => {
    const a = {
      chat: vi.fn(), toggleVisible: vi.fn(), toggleClickThrough: vi.fn(),
      toggleDnd: vi.fn(), openHub: vi.fn(), quit: vi.fn(),
    };
    const tpl = buildTrayMenuTemplate(a, { version: '0.1.0', connected: true });
    const labels = tpl.filter((t) => t.label).map((t) => t.label);
    expect(labels).toEqual(
      expect.arrayContaining(['跟小灵聊聊', '显示 / 隐藏角色', '鼠标穿透', '不打扰', '打开 Hub', '退出']),
    );
    tpl.find((t) => t.label === '退出')!.click!();
    expect(a.quit).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 失败** — FAIL。

- [ ] **Step 3: 实现**

```ts
// apps/desktop/electron/main/tray-service.ts
/** J1 托盘：菜单模板（纯，注入动作可测）+ createTray（Electron Tray 接线）。 */
import { Tray, Menu, nativeImage } from 'electron';
import path from 'node:path';
import { trayIconKey, type TrayIconKey } from './tray-icon.js';

export interface TrayActions {
  chat: () => void;
  toggleVisible: () => void;
  toggleClickThrough: () => void;
  toggleDnd: () => void;
  openHub: () => void;
  quit: () => void;
}
export interface MenuItemTpl { label?: string; type?: 'separator'; enabled?: boolean; click?: () => void }

export function buildTrayMenuTemplate(a: TrayActions, info: { version: string; connected: boolean }): MenuItemTpl[] {
  return [
    { label: `DeskSoul ${info.version} · ${info.connected ? '已连接' : '未连接'}`, enabled: false },
    { type: 'separator' },
    { label: '跟小灵聊聊', click: a.chat },
    { label: '显示 / 隐藏角色', click: a.toggleVisible },
    { label: '鼠标穿透', click: a.toggleClickThrough },
    { label: '不打扰', click: a.toggleDnd },
    { type: 'separator' },
    { label: '打开 Hub', click: a.openHub },
    { label: '设置', click: a.openHub },
    { type: 'separator' },
    { label: '退出', click: a.quit },
  ];
}

export interface TrayHandle { setState(s: { error: boolean; thinking: boolean }): void; destroy(): void }

export function createTray(deps: { iconsDir: string; actions: TrayActions; version: string; connected: () => boolean }): TrayHandle {
  const iconFor = (k: TrayIconKey): Electron.NativeImage =>
    nativeImage.createFromPath(path.join(deps.iconsDir, `${k}.png`));
  const tray = new Tray(iconFor('default'));
  const rebuildMenu = (): void => {
    tray.setContextMenu(Menu.buildFromTemplate(
      buildTrayMenuTemplate(deps.actions, { version: deps.version, connected: deps.connected() }) as Electron.MenuItemConstructorOptions[],
    ));
  };
  tray.setToolTip('DeskSoul');
  rebuildMenu();
  // 鼠标动作（§14.1）：左键显隐 / 双击聊天 / 中键穿透（右键=菜单由 setContextMenu 接管）
  tray.on('click', () => deps.actions.toggleVisible());
  tray.on('double-click', () => deps.actions.chat());
  // @ts-expect-error middle-click 仅部分平台有
  tray.on('middle-click', () => deps.actions.toggleClickThrough());
  return {
    setState(s) {
      tray.setImage(iconFor(trayIconKey(s)));
      rebuildMenu();
    },
    destroy: () => tray.destroy(),
  };
}
```

- [ ] **Step 4: 通过 + typecheck** — `pnpm --filter @desksoul/desktop exec vitest run test/tray-service.test.ts` PASS；typecheck（Electron Tray/nativeImage 类型）干净。

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/electron/main/tray-service.ts apps/desktop/test/tray-service.test.ts
git commit -m "feat(desktop): J1 tray service (menu template + Tray wiring)"
```

---

## Task 3: index.ts 创建托盘 + chat 态联动 + 占位图标

**Files:** Modify `apps/desktop/electron/main/index.ts`；Create `apps/desktop/resources/tray/{default,thinking,error}.png`

- [ ] **Step 1: 放占位托盘图标** — 在 `apps/desktop/resources/tray/` 放 3 个 16×16/32×32 PNG（占位；可临时用同一张）。electron-builder 配置确保 `resources/` 打包（M9 收口）；dev 用源码路径。

- [ ] **Step 2: index.ts 接线**

`whenReady` 内（wins 创建后）加：
```ts
  const trayIconsDir = app.isPackaged
    ? path.join(process.resourcesPath, 'tray')
    : path.join(__dirname, '../../resources/tray');
  const tray = createTray({
    iconsDir: trayIconsDir,
    version: app.getVersion(),
    connected: () => !!prefsStore.getAll()['model.activeProvider'],
    actions: {
      chat: () => { const w = wins?.overlay; if (w && !w.isDestroyed()) { w.show(); w.focus(); } },
      toggleVisible: () => { const c = wins?.character; if (c && !c.isDestroyed()) (c.isVisible() ? c.hide() : c.show()); },
      toggleClickThrough: () => { /* 复用 M8b toggleClickThroughPref 共享函数 */ },
      toggleDnd: () => { /* 翻转 display.dndManual（M8b A4） */ },
      openHub: () => { const w = wins?.settings; if (w && !w.isDestroyed()) { w.show(); w.focus(); } },
      quit: () => { isQuitting = true; app.quit(); },
    },
  });
```
chat 态联动图标：在已有 chat 状态广播处（或订阅）调 `tray.setState({ error, thinking })`——thinking=streaming 中，error=最近一轮 error。最小实现：监听 broadcast 的 chat.stream→thinking=true、chat.done→thinking=false/error=finishReason==='error'。`before-quit` 加 `tray.destroy()`。import `createTray`。

> toggleClickThrough/toggleDnd 与 P1 hotkey-service、M8b ipc-router 同源动作——**抽共享 `app-actions.ts`**（toggleClickThroughPref / toggleDndPref / showChat / toggleCharacter），三处（ipc-router 菜单、hotkey-service、tray）共用，避免三份重复。建议本步顺带抽。

- [ ] **Step 3: typecheck + 全量 + 提交**

```bash
pnpm --filter @desksoul/desktop typecheck
pnpm --filter @desksoul/desktop test
pnpm exec prettier --write apps/desktop/electron/main/index.ts
git add -A
git commit -m "feat(desktop): create system tray + chat-state icon linkage"
```

---

## Self-Review（plan vs spec J1）
- **三态图标 + 菜单 + 鼠标动作**：T1 态机 + T2 菜单/Tray + T3 接线 ✓。
- **占位/诚实**：图标 PNG 占位（真件留视觉环节）；中键 platform 限制标注；动作建议抽 `app-actions.ts` 共享（避免与 hotkey/菜单重复）。
- **类型一致**：`trayIconKey`(T1) ↔ tray-service(T2)；`TrayActions`(T2) ↔ index 注入(T3) 一致。
- **回归点**：新增托盘不影响既有窗口/退出逻辑（quit 走 isQuitting）。
