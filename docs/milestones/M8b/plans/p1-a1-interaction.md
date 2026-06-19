# M8b P1 A1 角色交互补全 Implementation Plan（tap/双击→聊天/右键菜单/hover 提示）

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans。步骤用 `- [ ]`。

**Goal:** 给角色窗补齐点击交互——头/身轻点（情绪/动作）、双击打开聊天（B1）、右键桌面菜单（原生）、hover 悬浮提示；不破坏既有 alpha 命中 + 长按拖拽。

**Architecture:** 纯逻辑下沉 `interaction-zones.ts`（tap 分区 + tap/drag 判定，可测）；`interaction.ts` 扩点击/双击/右键/hover；新 RPC `app.window.showChat`（show+focus overlay，A1 双击 + M8c 托盘复用）、`app.window.popCharacterMenu`（Main 原生菜单，动作复用既有 RPC）。

**Tech Stack:** TS strict、Three.js（命中）、Electron Main（Menu/BrowserWindow）、Vitest。

**关联 spec:** [`../spec.md`](../spec.md)（§1 A1 + §2 交互）。**前置：M8a B1 浮层已落**（双击/菜单"聊天"= 显示+聚焦 overlay）。分支建议 `feat/m8b-desktop`。

**接口假设**：overlay 窗由 index.ts 创建且常驻（M8a 后仍在）；`app.window.openHub` 已存在（菜单"设置"复用）。

---

## 文件结构
- 新 `apps/desktop/src/renderer/character/interaction-zones.ts`（纯：tapZone / classifyPress）
- 改 `apps/desktop/src/renderer/character/interaction.ts`（接点击/双击/右键/hover）
- 改 `packages/protocol/src/methods.ts`（+`app.window.showChat`、`app.window.popCharacterMenu`）
- 新 `apps/desktop/electron/main/character-menu.ts`（原生菜单模板工厂，注入动作便于测）
- 改 `apps/desktop/electron/main/ipc-router.ts`（showChat handler + popCharacterMenu handler + deps）
- 改 `apps/desktop/electron/main/index.ts`（传 overlayWindow 已有；菜单动作接线）
- 测试：`apps/desktop/test/character/interaction-zones.test.ts`、`apps/desktop/test/character-menu.test.ts`（新）

---

## Task 1: tap 分区 + 按压判定（纯逻辑）

**Files:** Create `apps/desktop/src/renderer/character/interaction-zones.ts`；Test `apps/desktop/test/character/interaction-zones.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// apps/desktop/test/character/interaction-zones.test.ts
import { describe, it, expect } from 'vitest';
import { tapZone, classifyPress } from '../../src/renderer/character/interaction-zones';

describe('interaction-zones（A1 命中分区 + 按压判定）', () => {
  it('tapZone：上 38% 为头，其余为身', () => {
    expect(tapZone(10, 480)).toBe('head'); // y=10/480 ≈ 2%
    expect(tapZone(170, 480)).toBe('head'); // ≈35%
    expect(tapZone(200, 480)).toBe('body'); // ≈42%
    expect(tapZone(470, 480)).toBe('body');
  });
  it('classifyPress：短按未移动=tap；超时或移动=非 tap', () => {
    expect(classifyPress({ downT: 0, upT: 150, moved: false }, 200)).toBe('tap');
    expect(classifyPress({ downT: 0, upT: 300, moved: false }, 200)).toBe('none'); // 超长按（拖拽阈）
    expect(classifyPress({ downT: 0, upT: 100, moved: true }, 200)).toBe('none'); // 移动过
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @desksoul/desktop exec vitest run test/character/interaction-zones.test.ts`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 实现**

```ts
// apps/desktop/src/renderer/character/interaction-zones.ts
/** A1 命中分区与按压判定（纯函数）。头/身按窗口高度比例分；tap = 短按未移动。 */
export type Zone = 'head' | 'body';
const HEAD_RATIO = 0.38;

export function tapZone(clientY: number, height: number): Zone {
  return height > 0 && clientY / height <= HEAD_RATIO ? 'head' : 'body';
}

export interface Press {
  downT: number;
  upT: number;
  moved: boolean;
}
/** tap=短按未移动；超过长按阈（=拖拽）或移动过 → none。 */
export function classifyPress(p: Press, longPressMs: number): 'tap' | 'none' {
  if (p.moved) return 'none';
  return p.upT - p.downT < longPressMs ? 'tap' : 'none';
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @desksoul/desktop exec vitest run test/character/interaction-zones.test.ts`
Expected: PASS (2)

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/renderer/character/interaction-zones.ts apps/desktop/test/character/interaction-zones.test.ts
git commit -m "feat(character): A1 tap-zone + press classification (pure)"
```

---

## Task 2: 新增窗口 RPC（showChat + popCharacterMenu）

**Files:** Modify `packages/protocol/src/methods.ts`；Create `apps/desktop/electron/main/character-menu.ts`；Test `apps/desktop/test/character-menu.test.ts`

- [ ] **Step 1: 写失败测试（菜单模板工厂）**

```ts
// apps/desktop/test/character-menu.test.ts
import { describe, it, expect, vi } from 'vitest';
import { buildCharacterMenuTemplate } from '../electron/main/character-menu';

describe('character-menu 模板（A1 右键 / J1 托盘复用）', () => {
  it('给出标准动作项，点击触发注入动作', () => {
    const actions = { chat: vi.fn(), toggleClickThrough: vi.fn(), toggleVisible: vi.fn(), openHub: vi.fn() };
    const tpl = buildCharacterMenuTemplate(actions);
    const labels = tpl.filter((t) => t.label).map((t) => t.label);
    expect(labels).toEqual(expect.arrayContaining(['跟小灵聊聊', '鼠标穿透', '显示 / 隐藏', '设置']));
    tpl.find((t) => t.label === '跟小灵聊聊')!.click!();
    expect(actions.chat).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @desksoul/desktop exec vitest run test/character-menu.test.ts`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 实现**

`methods.ts`（`app.window.openHub` 之后插入）：
```ts
  'app.window.showChat': {
    // 显示+聚焦聊天浮层（A1 双击 / 托盘"聊天"）。
    params: z.object({}),
    result: z.object({ ok: z.literal(true) }),
  },
  'app.window.popCharacterMenu': {
    // 角色右键 → Main 弹原生桌面菜单（动作类，§14.2）。
    params: z.object({}),
    result: z.object({ ok: z.literal(true) }),
  },
```

```ts
// apps/desktop/electron/main/character-menu.ts
/**
 * 桌面动作菜单模板（A1 右键 + J1 托盘复用）。返回 Electron MenuItemConstructorOptions[]，
 * 动作注入便于测；切角色（E1/V1）暂禁用占位。
 */
export interface CharacterMenuActions {
  chat: () => void;
  toggleClickThrough: () => void;
  toggleVisible: () => void;
  openHub: () => void;
}

export interface MenuItemTpl {
  label?: string;
  type?: 'separator';
  enabled?: boolean;
  click?: () => void;
}

export function buildCharacterMenuTemplate(a: CharacterMenuActions): MenuItemTpl[] {
  return [
    { label: '跟小灵聊聊', click: a.chat },
    { label: '切换角色', enabled: false }, // E1/V1 角色库后开放
    { type: 'separator' },
    { label: '鼠标穿透', click: a.toggleClickThrough },
    { label: '显示 / 隐藏', click: a.toggleVisible },
    { type: 'separator' },
    { label: '设置', click: a.openHub },
  ];
}
```

- [ ] **Step 4: 跑测试 + 重建 protocol**

Run:
```bash
pnpm --filter @desksoul/protocol build
pnpm --filter @desksoul/desktop exec vitest run test/character-menu.test.ts
```
Expected: PASS (1)

- [ ] **Step 5: 提交**

```bash
git add packages/protocol/src/methods.ts apps/desktop/electron/main/character-menu.ts apps/desktop/test/character-menu.test.ts
git commit -m "feat(desktop): showChat + popCharacterMenu RPC + shared menu template"
```

---

## Task 3: ipc-router + index 接线（菜单动作 + showChat）

**Files:** Modify `apps/desktop/electron/main/ipc-router.ts`、`apps/desktop/electron/main/index.ts`

- [ ] **Step 1: ipc-router 加 handler**

import 区加：
```ts
import { Menu } from 'electron';
import { buildCharacterMenuTemplate } from './character-menu.js';
```
> `Menu` 与既有 `import { ipcMain, BrowserWindow, type WebContents } from 'electron'` 合并到一行或新增一行均可。

`IpcRouterDeps` 加（`overlayWindow?` 已在 M7b-2 加过；复用）：无新增 dep（用已有 characterWindow/overlayWindow/settingsWindow）。

`createRouter({...})` 内（`app.window.openHub` 之后）加：
```ts
    'app.window.showChat': () => {
      const w = deps.overlayWindow?.();
      if (w && !w.isDestroyed()) {
        w.show();
        w.focus();
      }
      return { ok: true as const };
    },
    'app.window.popCharacterMenu': () => {
      const menu = Menu.buildFromTemplate(
        buildCharacterMenuTemplate({
          chat: () => {
            const w = deps.overlayWindow?.();
            if (w && !w.isDestroyed()) {
              w.show();
              w.focus();
            }
          },
          toggleClickThrough: () => {
            const c = deps.characterWindow();
            if (c && !c.isDestroyed()) c.setIgnoreMouseEvents(!c.isDestroyed() && false, { forward: true });
          },
          toggleVisible: () => {
            const c = deps.characterWindow();
            if (c && !c.isDestroyed()) (c.isVisible() ? c.hide() : c.show());
          },
          openHub: () => {
            const w = deps.settingsWindow?.();
            if (w && !w.isDestroyed()) {
              w.show();
              w.focus();
            }
          },
        }),
      );
      const c = deps.characterWindow();
      if (c && !c.isDestroyed()) menu.popup({ window: c });
      return { ok: true as const };
    },
```
> 注：`toggleClickThrough` 的真实"读当前穿透态并取反"需配合 A3（P3）的穿透状态真源；本期先占位调用（A3 落地后改为读真源取反）。标 TODO(P3)。

- [ ] **Step 2: typecheck**

Run: `pnpm --filter @desksoul/desktop typecheck`
Expected: 干净。

- [ ] **Step 3: 提交**

```bash
git add apps/desktop/electron/main/ipc-router.ts
git commit -m "feat(desktop): wire showChat + native character context menu"
```

---

## Task 4: interaction.ts 接点击/双击/右键/hover

**Files:** Modify `apps/desktop/src/renderer/character/interaction.ts`

- [ ] **Step 1: setupDrag 内补按压判定 + 在 setupInteraction 末加点击/双击/右键/hover**

在 `setupInteraction` 末尾（`setupDrag(...)` 之后）追加：
```ts
  setupClicks(renderer?.domElement ?? document.body);
```
新增函数（文件末尾）：
```ts
import { tapZone, classifyPress } from './interaction-zones';

function setupClicks(target: HTMLElement): void {
  let downT = 0;
  let moved = false;
  let downX = 0;
  let downY = 0;

  target.addEventListener('mousedown', (e: MouseEvent) => {
    downT = performance.now();
    moved = false;
    downX = e.screenX;
    downY = e.screenY;
  });
  window.addEventListener('mousemove', (e: MouseEvent) => {
    if (Math.abs(e.screenX - downX) > 3 || Math.abs(e.screenY - downY) > 3) moved = true;
  });
  target.addEventListener('mouseup', (e: MouseEvent) => {
    if (classifyPress({ downT, upT: performance.now(), moved }, LONG_PRESS_MS) !== 'tap') return;
    const zone = tapZone(e.clientY, window.innerHeight);
    // 头→撒娇 + 情绪；身→普通互动。经 character.idleTimeout 同样的"哑播放器"约束：
    // 这里只本地播动作（runtime 已通过 behavior 订阅可驱动），实际动作由 Main 决策更稳，
    // 故上报 Main 由其广播 behavior（保持 character 无业务）。
    void window.desksoul.rpc('character.tap', { zone });
  });
  target.addEventListener('dblclick', () => {
    void window.desksoul.rpc('app.window.showChat', {});
  });
  target.addEventListener('contextmenu', (e: MouseEvent) => {
    e.preventDefault();
    void window.desksoul.rpc('app.window.popCharacterMenu', {});
  });
}
```

> **依赖**：`character.tap` RPC 需在 methods.ts + ipc-router 注册（Main 收到后广播 `behavior.playAction`/`applyEmotion`，保持 character 哑播放器）。本步同时补：
> - methods.ts 加 `'character.tap': { params: z.object({ zone: z.enum(['head','body']) }), result: z.object({ ok: z.literal(true) }) }`
> - ipc-router 加 handler：`'character.tap': (p) => { broadcast('behavior.applyEmotion', { name: p.zone === 'head' ? 'happy' : 'neutral', weight: 1 }); broadcast('behavior.playAction', { name: p.zone === 'head' ? 'nuzzle' : 'nod', durationMs: null }); return { ok: true as const }; }`（动作名按 manifest 动作词表，未知名 runtime 会 warn 跳过——P4 视觉时校准）。

- [ ] **Step 2: hover>800ms 悬浮提示（DOM 提示，character 窗内）**

在 `setupClicks` 加 hover tooltip（最小：title 文案 DOM）：
```ts
  let hoverTimer: number | null = null;
  target.addEventListener('mousemove', () => {
    if (hoverTimer !== null) clearTimeout(hoverTimer);
    hoverTimer = window.setTimeout(() => showTooltip(), 800);
  });
  target.addEventListener('mouseleave', () => {
    if (hoverTimer !== null) clearTimeout(hoverTimer);
    hideTooltip();
  });
```
`showTooltip/hideTooltip`：操作 character/index.html 的一个 `#tooltip` 元素（需在 index.html `<body>` 加 `<div id="tooltip"></div>` + 样式）。文案占位「双击聊天 · 右键菜单」。

- [ ] **Step 3: typecheck + 全量 + 提交**

Run:
```bash
pnpm --filter @desksoul/protocol build
pnpm --filter @desksoul/desktop typecheck
pnpm --filter @desksoul/desktop test
pnpm exec prettier --write apps/desktop/src/renderer/character/interaction.ts apps/desktop/src/renderer/character/index.html packages/protocol/src/methods.ts apps/desktop/electron/main/ipc-router.ts
```
Expected: typecheck 干净；全量绿；新增 interaction-zones / character-menu 用例。

```bash
git add apps/desktop/src/renderer/character/ packages/protocol/src/methods.ts apps/desktop/electron/main/ipc-router.ts
git commit -m "feat(character): A1 tap/dblclick→chat/right-click menu/hover tooltip"
```

---

## Self-Review（plan vs spec A1）
- **spec §1 A1 head/body tap**：T1 分区 + T4 tap→character.tap→Main 广播 behavior（保持哑播放器）✓。
- **双击→B1**：T4 dblclick→showChat（T2/T3 RPC）✓。
- **右键桌面菜单**：T2 模板 + T3 native Menu.popup + T4 contextmenu→popCharacterMenu ✓。
- **hover 提示**：T4 Step2（DOM tooltip）✓。
- **占位符**：toggleClickThrough 标 TODO(P3)（穿透真源在 A3）——明确的跨阶段依赖，非空占位。
- **类型一致**：`tapZone/classifyPress`(T1) ↔ interaction(T4)；`character.tap` zone enum(T4) ↔ methods 注册一致；`buildCharacterMenuTemplate` actions(T2) ↔ ipc-router 注入(T3) 一致。
- **回归点**：interaction.ts 加点击监听不影响既有拖拽/穿透（tap 判定排除 moved/长按）；新 RPC 不影响既有。
- **依赖顺序**：T1→T2→T3→T4。**跨阶段**：toggleClickThrough 真态在 P3 收口。
