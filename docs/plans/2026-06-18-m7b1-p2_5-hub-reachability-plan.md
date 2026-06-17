# M7b-1 P2.5 实施计划 · Hub 可达性

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans 逐 task 实现。步骤用 `- [ ]`。

**Goal:** 让 Hub（settings 窗口）在运行时可被打开且持久——补 `app.window.openHub` RPC + 全局热键 `Ctrl+Shift+,` + overlay ⚙ 按钮 + 窗口 hide-on-close。解锁 M7a/P2 已做 UI 的首次 GUI 冒烟，并为 P4 的 D3「配 Key」验收铺路。

**背景（PM 复核 P2 时发现）：** settings 窗口 `show:false` 且全 app 无任何打开入口（无 `.show()`/`globalShortcut`/overlay ⚙/RPC），关闭即销毁。故 Hub 此前运行时不可达。完整入口集（托盘 J1 / 热键录制器 J2 / 右键）在 M8；本阶段只做**最小可达 + 持久**。

**Architecture:** 打开经 Main：`app.window.openHub` RPC（ipc-router 用注入的 `settingsWindow()` show+focus）；全局热键在 index 直接 show+focus；overlay ⚙ 走 RPC。hide-on-close 在 index（与 before-quit 同处，用 isQuitting 标志区分真退出 vs 关窗收起）。

**Tech Stack:** Electron Main（BrowserWindow/globalShortcut/app）、Zod、Vue SFC、Vitest。
**关联：** spec `docs/plans/2026-06-17-m7b1-d-series-spec.md`（可达性是其验收的隐含前置）。分支 `feat/m7b1-d-series`，前置 P2 已落（255 绿）。

---

## 文件结构
- 改 `packages/protocol/src/methods.ts`（+`app.window.openHub`）
- 改 `apps/desktop/electron/main/ipc-router.ts`（`settingsWindow` dep + openHub handler）
- 改 `apps/desktop/electron/main/index.ts`（传 settingsWindow；globalShortcut 注册/注销；settings hide-on-close + isQuitting）
- 改 `apps/desktop/src/renderer/overlay/App.vue`（⚙ 按钮 → openHub RPC）
- 测试：改 `packages/protocol/test/methods.test.ts`（openHub schema）
- 收尾：追加 `apps/desktop/RESULTS-M7b1.md`（P2.5 段，含 GUI 冒烟结果）

> 注：改了 `packages/protocol/src/methods.ts` → 跑 desktop 前先 `pnpm --filter @desksoul/protocol build`（[[build-test-workflow-gotchas]]）。

---

## Task 1: app.window.openHub RPC + ipc-router 接线

**Files:** Modify `packages/protocol/src/methods.ts`、`apps/desktop/electron/main/ipc-router.ts`；Modify `packages/protocol/test/methods.test.ts`

- [ ] **Step 1: 写失败测试（method 注册）**

```ts
// packages/protocol/test/methods.test.ts — 追加
describe('app.window.openHub', () => {
  it('registers with empty params', () => {
    expect(Methods['app.window.openHub'].params.safeParse({}).success).toBe(true);
    expect(Methods['app.window.openHub'].result.safeParse({ ok: true }).success).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @desksoul/protocol exec vitest run test/methods.test.ts`
Expected: FAIL — `Methods['app.window.openHub']` undefined。

- [ ] **Step 3a: methods.ts 加方法**

在 `app.window.moveBy` 之后插入：
```ts
  'app.window.openHub': {
    // 打开/聚焦 Hub（settings 窗口）。最小入口；完整入口集（托盘/热键录制器）在 M8。
    params: z.object({}),
    result: z.object({ ok: z.literal(true) }),
  },
```

- [ ] **Step 3b: ipc-router 加 dep + handler**

`IpcRouterDeps` 加：
```ts
  /** Hub（settings 窗口）定位器；index 注入。openHub RPC 用它 show+focus。 */
  settingsWindow?: () => BrowserWindow | null;
```
在 `createRouter({ ... })` 内（与 `app.window.moveBy` 并列）加：
```ts
    'app.window.openHub': () => {
      const w = deps.settingsWindow?.();
      if (w && !w.isDestroyed()) {
        w.show();
        w.focus();
      }
      return { ok: true as const };
    },
```

- [ ] **Step 4: 跑测试 + 重建 protocol + typecheck**

Run:
```bash
pnpm --filter @desksoul/protocol exec vitest run test/methods.test.ts
pnpm --filter @desksoul/protocol build
pnpm --filter @desksoul/desktop typecheck
```
Expected: methods 测过；typecheck 干净。

- [ ] **Step 5: 提交**

```bash
git add packages/protocol/src/methods.ts packages/protocol/test/methods.test.ts apps/desktop/electron/main/ipc-router.ts
git commit -m "feat(desktop): app.window.openHub RPC (show+focus Hub via injected settingsWindow)"
```

---

## Task 2: index 接线 —— settingsWindow + 全局热键 + hide-on-close

**Files:** Modify `apps/desktop/electron/main/index.ts`

> 无独立单测（Electron 主进程接线 + globalShortcut，属窗口/系统集成胶水，靠 Task 3 的 GUI 冒烟验证）。

- [ ] **Step 1: 实现**

import 行加 `globalShortcut`：
```ts
import { app, screen, protocol, shell, globalShortcut } from 'electron';
```
在 `registerIpcRouter({ ... })` 参数里加（与 `characterWindow` 并列）：
```ts
    settingsWindow: () => (wins && !wins.settings.isDestroyed() ? wins.settings : null),
```
在 `app.whenReady().then(() => { ... })` 内、`maybeQuit` 接线之后加全局热键 + settings 收起：
```ts
  // 最小 Hub 入口（M8 接托盘/热键录制器）：Ctrl/Cmd+Shift+, 打开/聚焦 Hub。
  globalShortcut.register('CommandOrControl+Shift+,', () => {
    if (wins && !wins.settings.isDestroyed()) {
      wins.settings.show();
      wins.settings.focus();
    }
  });
  // Hub 是持久窗口：关闭 = 收起（hide），非销毁；真正退出时（isQuitting）放行。
  wins.settings.on('close', (e) => {
    if (!isQuitting && wins && !wins.settings.isDestroyed()) {
      e.preventDefault();
      wins.settings.hide();
    }
  });
```
在文件顶部模块级（与 `let wins ...` 并列）加标志：
```ts
let isQuitting = false;
```
把现有 `app.on('before-quit', () => { ... })` 的回调首行加：
```ts
  isQuitting = true;
  globalShortcut.unregisterAll();
```

- [ ] **Step 2: typecheck**

Run: `pnpm --filter @desksoul/desktop typecheck`
Expected: 干净。

- [ ] **Step 3: 提交**

```bash
git add apps/desktop/electron/main/index.ts
git commit -m "feat(desktop): global hotkey Ctrl+Shift+, opens Hub; settings hide-on-close (persistent)"
```

---

## Task 3: overlay ⚙ 按钮 + GUI 冒烟 + RESULTS

**Files:** Modify `apps/desktop/src/renderer/overlay/App.vue`；Modify `apps/desktop/RESULTS-M7b1.md`

- [ ] **Step 1: overlay 加 ⚙ 按钮**

在 `overlay/App.vue` `<script setup>` 内加：
```ts
function openHub(): void {
  void window.desksoul.rpc('app.window.openHub', {});
}
```
把模板标题行 `<h2>DeskSoul · 对话（M2）</h2>` 换成带齿轮的 flex 行：
```html
    <div class="head">
      <h2>DeskSoul · 对话（M2）</h2>
      <button class="gear" title="设置 (Ctrl+Shift+,)" @click="openHub">⚙</button>
    </div>
```
在 `<style scoped>` 加：
```css
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.gear {
  border: none;
  background: transparent;
  font-size: 16px;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 8px;
}
.gear:hover {
  background: #eef1f7;
}
```

- [ ] **Step 2: typecheck + 全量回归 + 格式（仅新写/本阶段文件）**

Run:
```bash
pnpm --filter @desksoul/protocol build
pnpm --filter @desksoul/sidecar build
pnpm --filter @desksoul/desktop typecheck
pnpm --filter @desksoul/desktop test
pnpm --filter @desksoul/protocol test
pnpm exec prettier --write apps/desktop/src/renderer/overlay/App.vue
```
Expected: typecheck 干净；desktop 255 + protocol 178（methods 新用例）绿；prettier 仅动 overlay/App.vue（**勿** `--write` methods.ts/ipc-router.ts/index.ts，避免存量欠账，手验新增行合规）。

- [ ] **Step 3: GUI 冒烟（本阶段核心交付 —— 需真机 Electron）**

`pnpm --filter @desksoul/desktop dev`，逐条确认并记录：

> **视觉保真（硬验收，见 CURRENT.md §5 / [[ui-must-match-design-pngs]]）**：不是"能显示就过"，要**对照设计图**——Hub 壳比对 ui-design §3.3，D4 比对 `UI/4ba6005f-0abc-45f4-9690-2c5e7af15242.png` + §2 token（毛玻璃/色阶/字号/圆角/间距）。偏差立 polish task 记 RESULTS。overlay 聊天浮层最终玻璃形态是 B1=M8，本阶段 ⚙ 只验"能打开"，不要求其外观对齐。
1. **打开 Hub**：按 `Ctrl+Shift+,` → Hub 窗口出现并聚焦；overlay 点 ⚙ → 同样打开。
2. **持久**：关闭 Hub 窗口 → 收起（不退出 app）；再按热键 → 重新出现（未被销毁）。
3. **Hub 渲染**（M7a 累积验证）：左导航（§3.3 各组）+ 顶栏 + 状态条；切到「显示与窗口」。
4. **主题**：切深色 → Hub + overlay 同时换肤 + 顶栏 `✓ 已保存`；重启 app → 保持。
5. **D4 缩放**：拖 slider → 角色实时缩放；松手 → `✓ 已保存`；重启 → 缩放保持。
6. **置顶/穿透**：切换 → 角色窗即时响应。
7. 退出 app（关角色+overlay）→ 进程正常退出（热键已注销、settings 不阻塞退出）。

> 若执行对话无法启 GUI：交付 Task 1+2+3-Step1 代码 + typecheck/测试绿，**在 RESULTS 标注「GUI 冒烟待人工」**，由有桌面环境者按上表执行后回填。这是 M7b-1 P5 签收的硬门槛（见 CURRENT.md §6）。

- [ ] **Step 4: 追加 RESULTS-M7b1 P2.5 段 + 提交**

记：可达性方案（openHub RPC + 热键 + ⚙ + hide-on-close/isQuitting）、测试增量（protocol 177→178）、**GUI 冒烟逐条结果（或「待人工」标注）**。

```bash
git add apps/desktop/src/renderer/overlay/App.vue apps/desktop/RESULTS-M7b1.md
git commit -m "feat(desktop): overlay gear opens Hub; GUI smoke + RESULTS P2.5"
```

---

## Self-Review（plan vs 发现）
- **可达性**：openHub RPC(T1) + 热键(T2) + overlay ⚙(T3) 三入口 ✓；hide-on-close + isQuitting 保证持久且不卡退出 ✓。
- **解锁冒烟**：T3-Step3 是 M7a+P2+P2.5 的首次累积 GUI 验证 ✓（CURRENT.md §6 跟踪的债）。
- **范围克制**：只做最小入口；托盘/热键录制器明确留 M8 ✓。
- **占位符**：无 TBD；代码步含完整编辑。
- **类型一致**：`settingsWindow?: () => BrowserWindow|null`(ipc-router dep, T1) ↔ index 注入(T2) 一致；`app.window.openHub` params/result(T1 methods) ↔ handler 返回 `{ok:true}`(T1 ipc-router) ↔ overlay rpc 调用(T3) 一致。
- **风险**：`globalShortcut.register` 若该热键被系统/他 app 占用会返回 false（不抛错）——本阶段不做冲突检测（J2 在 M8）；overlay ⚙ 与热键互为冗余入口，单一失败不致完全不可达。冒烟时留意热键是否生效，不生效用 ⚙。
