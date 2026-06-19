# M8c P1 J2 热键注册系统 Implementation Plan（prefs.hotkeys + Main 注册 + accelerator 校验/冲突）

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans。步骤用 `- [ ]`。

**Goal:** 用"prefs 驱动的热键注册系统"替换 index.ts 硬编码的单一 `Ctrl+Shift+,`：功能→accelerator 映射进 prefs，Main 启动按表注册、改动即重注册；accelerator 合法性/冲突纯逻辑可测（录制器 UI 在 P3）。

**Architecture:** 纯逻辑 `hotkey-rules.ts`（解析/校验/冲突）；`hotkey-service.ts`（注册器，注入 globalShortcut + 动作便于测）；prefs `hotkeys.*`。动作复用既有窗口操作（showChat/toggleClickThrough/openHub + 显隐）。

**关联 spec:** [`../spec.md`](../spec.md)（§1 J2）。**前置：M8a B1（showChat）+ M8b（toggleClickThrough）已落**。分支 `feat/m8c-system`。

---

## 文件结构
- 改 `packages/protocol/src/prefs.ts`（+`hotkeys.*` 5 键）
- 新 `apps/desktop/electron/main/hotkey-rules.ts`（纯：validateAccelerator / findConflict）
- 新 `apps/desktop/electron/main/hotkey-service.ts`（注册器，注入）
- 改 `apps/desktop/electron/main/index.ts`（用 hotkey-service 替换硬编码 globalShortcut）
- 测试：`hotkey-rules.test.ts`、`hotkey-service.test.ts`、`prefs.test.ts`(追加)

---

## Task 1: prefs `hotkeys.*`

**Files:** Modify `packages/protocol/src/prefs.ts`；Test `packages/protocol/test/prefs.test.ts`

- [ ] **Step 1: 失败测试**

```ts
it('hotkeys 默认值（M8c J2）', () => {
  expect(DEFAULT_PREFS['hotkeys.chat']).toBe('CommandOrControl+Shift+D');
  expect(DEFAULT_PREFS['hotkeys.openHub']).toBe('CommandOrControl+Shift+,');
});
```

- [ ] **Step 2: 失败** — FAIL。

- [ ] **Step 3: 实现**（新 `hotkeys.*` 段）

```ts
  // hotkeys（M8c J2；Electron accelerator 串）
  'hotkeys.chat': z.string().default('CommandOrControl+Shift+D'),
  'hotkeys.toggleHide': z.string().default('CommandOrControl+Shift+H'),
  'hotkeys.clickThrough': z.string().default('CommandOrControl+Shift+P'),
  'hotkeys.dnd': z.string().default('CommandOrControl+Shift+M'),
  'hotkeys.openHub': z.string().default('CommandOrControl+Shift+,'),
```

- [ ] **Step 4: 通过 + 重建** — PASS；`pnpm --filter @desksoul/protocol build`。

- [ ] **Step 5: 提交**

```bash
git add packages/protocol/src/prefs.ts packages/protocol/test/prefs.test.ts
git commit -m "feat(protocol): hotkeys.* prefs (M8c J2)"
```

---

## Task 2: accelerator 校验/冲突（纯）

**Files:** Create `apps/desktop/electron/main/hotkey-rules.ts`；Test `apps/desktop/test/hotkey-rules.test.ts`

- [ ] **Step 1: 失败测试**

```ts
// apps/desktop/test/hotkey-rules.test.ts
import { describe, it, expect } from 'vitest';
import { validateAccelerator, findConflict } from '../electron/main/hotkey-rules';

describe('hotkey-rules（J2 限制 + 冲突）', () => {
  it('拒绝单键 / 纯修饰 / ESC；接受 修饰+键', () => {
    expect(validateAccelerator('D').ok).toBe(false);
    expect(validateAccelerator('CommandOrControl').ok).toBe(false);
    expect(validateAccelerator('Escape').ok).toBe(false);
    expect(validateAccelerator('CommandOrControl+Shift+D').ok).toBe(true);
  });
  it('findConflict：同 accelerator 已被其它功能占用', () => {
    const map = { chat: 'CommandOrControl+Shift+D', openHub: 'CommandOrControl+Shift+,' };
    expect(findConflict(map, 'dnd', 'CommandOrControl+Shift+D')).toBe('chat');
    expect(findConflict(map, 'dnd', 'CommandOrControl+Shift+M')).toBeNull();
    expect(findConflict(map, 'chat', 'CommandOrControl+Shift+D')).toBeNull(); // 自己不算冲突
  });
});
```

- [ ] **Step 2: 失败** — FAIL。

- [ ] **Step 3: 实现**

```ts
// apps/desktop/electron/main/hotkey-rules.ts
/** J2 热键规则（纯）：accelerator 合法性 + 应用内冲突。不允许单键/纯修饰/ESC。 */
const MODIFIERS = new Set([
  'Command', 'Cmd', 'Control', 'Ctrl', 'CommandOrControl', 'CmdOrCtrl', 'Alt', 'Option', 'AltGr', 'Shift', 'Super', 'Meta',
]);

export interface Validation { ok: boolean; reason?: string }
export function validateAccelerator(acc: string): Validation {
  const parts = acc.split('+').map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return { ok: false, reason: '需至少一个修饰键 + 一个普通键' };
  const mods = parts.filter((p) => MODIFIERS.has(p));
  const keys = parts.filter((p) => !MODIFIERS.has(p));
  if (mods.length === 0) return { ok: false, reason: '缺少修饰键' };
  if (keys.length !== 1) return { ok: false, reason: '需恰好一个普通键' };
  if (keys[0]!.toLowerCase() === 'escape' || keys[0] === 'Esc') return { ok: false, reason: '不允许 ESC' };
  return { ok: true };
}

/** 返回与 acc 冲突的功能 id（排除自身）；无则 null。 */
export function findConflict(
  map: Record<string, string>,
  selfId: string,
  acc: string,
): string | null {
  for (const [id, v] of Object.entries(map)) {
    if (id !== selfId && v === acc) return id;
  }
  return null;
}
```

- [ ] **Step 4: 通过** — PASS (2)。

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/electron/main/hotkey-rules.ts apps/desktop/test/hotkey-rules.test.ts
git commit -m "feat(desktop): hotkey accelerator validation + conflict (pure)"
```

---

## Task 3: hotkey-service 注册器 + 替换硬编码

**Files:** Create `apps/desktop/electron/main/hotkey-service.ts`；Test `apps/desktop/test/hotkey-service.test.ts`；Modify `apps/desktop/electron/main/index.ts`

- [ ] **Step 1: 失败测试（注入假 globalShortcut + 动作）**

```ts
// apps/desktop/test/hotkey-service.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createHotkeyService } from '../electron/main/hotkey-service';

function fakeGS() {
  const reg: Record<string, () => void> = {};
  return {
    register: vi.fn((acc: string, cb: () => void) => { reg[acc] = cb; return true; }),
    unregisterAll: vi.fn(() => { for (const k of Object.keys(reg)) delete reg[k]; }),
    _fire: (acc: string) => reg[acc]?.(),
  };
}

describe('hotkey-service', () => {
  it('按 prefs 注册全部有效热键，触发调对应动作', () => {
    const gs = fakeGS();
    const actions = { chat: vi.fn(), toggleHide: vi.fn(), clickThrough: vi.fn(), dnd: vi.fn(), openHub: vi.fn() };
    const svc = createHotkeyService({ globalShortcut: gs, actions });
    svc.apply({
      'hotkeys.chat': 'CommandOrControl+Shift+D',
      'hotkeys.openHub': 'CommandOrControl+Shift+,',
      'hotkeys.toggleHide': 'CommandOrControl+Shift+H',
      'hotkeys.clickThrough': 'CommandOrControl+Shift+P',
      'hotkeys.dnd': 'CommandOrControl+Shift+M',
    } as never);
    expect(gs.register).toHaveBeenCalledTimes(5);
    gs._fire('CommandOrControl+Shift+D');
    expect(actions.chat).toHaveBeenCalled();
  });
  it('apply 先 unregisterAll 再注册（重注册幂等）', () => {
    const gs = fakeGS();
    const actions = { chat: vi.fn(), toggleHide: vi.fn(), clickThrough: vi.fn(), dnd: vi.fn(), openHub: vi.fn() };
    const svc = createHotkeyService({ globalShortcut: gs, actions });
    svc.apply({ 'hotkeys.chat': 'CommandOrControl+Shift+D' } as never);
    svc.apply({ 'hotkeys.chat': 'CommandOrControl+Shift+J' } as never);
    expect(gs.unregisterAll).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 失败** — FAIL。

- [ ] **Step 3: 实现**

```ts
// apps/desktop/electron/main/hotkey-service.ts
/** J2 热键注册器：按 prefs.hotkeys.* 注册 globalShortcut，apply 时全量重注册。注入便于测。 */
import type { Prefs } from '@desksoul/protocol';
import { validateAccelerator } from './hotkey-rules.js';

export interface HotkeyActions {
  chat: () => void;
  toggleHide: () => void;
  clickThrough: () => void;
  dnd: () => void;
  openHub: () => void;
}
export interface GlobalShortcutLike {
  register: (accelerator: string, cb: () => void) => boolean;
  unregisterAll: () => void;
}
const KEY_TO_ACTION: Array<[keyof Prefs & `hotkeys.${string}`, keyof HotkeyActions]> = [
  ['hotkeys.chat', 'chat'],
  ['hotkeys.toggleHide', 'toggleHide'],
  ['hotkeys.clickThrough', 'clickThrough'],
  ['hotkeys.dnd', 'dnd'],
  ['hotkeys.openHub', 'openHub'],
];

export function createHotkeyService(deps: { globalShortcut: GlobalShortcutLike; actions: HotkeyActions }) {
  return {
    apply(prefs: Prefs): void {
      deps.globalShortcut.unregisterAll();
      for (const [key, action] of KEY_TO_ACTION) {
        const acc = prefs[key];
        if (typeof acc === 'string' && validateAccelerator(acc).ok) {
          deps.globalShortcut.register(acc, () => deps.actions[action]());
        }
      }
    },
    dispose(): void {
      deps.globalShortcut.unregisterAll();
    },
  };
}
```

- [ ] **Step 4: index.ts 替换硬编码**

删除 `globalShortcut.register('CommandOrControl+Shift+,', …)` 那段；改为：
```ts
  const hotkeys = createHotkeyService({
    globalShortcut,
    actions: {
      chat: () => { const w = wins?.overlay; if (w && !w.isDestroyed()) { w.show(); w.focus(); } },
      toggleHide: () => { const c = wins?.character; if (c && !c.isDestroyed()) (c.isVisible() ? c.hide() : c.show()); },
      clickThrough: () => { /* 调 router 的 toggleClickThrough 等价逻辑：翻转 pref + 施加（M8b） */ },
      dnd: () => { /* 翻转 display.dndManual（M8b A4） */ },
      openHub: () => { const w = wins?.settings; if (w && !w.isDestroyed()) { w.show(); w.focus(); } },
    },
  });
  hotkeys.apply(prefsStore.getAll());
  // pref 改动后重注册（监听 app.prefs.changed 的 hotkeys.* —— 经 prefsStore 或广播）
```
> clickThrough/dnd 动作复用 M8b 的 pref 翻转逻辑（可抽一个共享 `toggleClickThroughPref(prefsStore, characterWindow)` 供 ipc-router 与此处共用，避免重复）。`before-quit` 改调 `hotkeys.dispose()`（替代 `globalShortcut.unregisterAll()`）。import `createHotkeyService`。

- [ ] **Step 5: typecheck + 全量 + 提交**

```bash
pnpm --filter @desksoul/protocol build
pnpm --filter @desksoul/desktop typecheck
pnpm --filter @desksoul/desktop test
pnpm exec prettier --write apps/desktop/electron/main/hotkey-service.ts apps/desktop/electron/main/index.ts
git add -A
git commit -m "feat(desktop): prefs-driven hotkey registration (replaces hardcoded shortcut)"
```

---

## Self-Review（plan vs spec J2 注册侧）
- **替换硬编码 + prefs 驱动**：T1 prefs + T3 service + index 接线 ✓。
- **限制（单键/纯修饰/ESC）+ 冲突**：T2 纯逻辑 ✓（录制器 UI 消费在 P3）。
- **占位/诚实**：index 的 clickThrough/dnd 动作复用 M8b 逻辑，标注抽共享函数；非空占位。
- **类型一致**：`validateAccelerator`(T2) ↔ service(T3)；`hotkeys.*` prefs(T1) ↔ KEY_TO_ACTION(T3) 一致。
- **回归点**：移除硬编码 Ctrl+Shift+,（openHub 现由 hotkeys.openHub 默认同键覆盖，行为等价）。
