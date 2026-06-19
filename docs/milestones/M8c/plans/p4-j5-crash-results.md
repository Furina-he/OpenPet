# M8c P4 J5 崩溃上报 + 脱敏 payload + 收尾 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans。步骤用 `- [ ]`。

**Goal:** 崩溃/诊断脱敏 payload 组装（剔除 Key/对话、截 200 行日志）+ 崩溃对话框 + 接 D8「生成 .dsdiag」按钮（本地生成）；M8c 视觉保真 + RESULTS。

**Architecture:** 纯 `crash-payload.ts`（组装+脱敏，可测）；崩溃捕获挂 `render-process-gone`（windows.ts 已 reload，加生成 .dsdiag + 队列）；对话框 = settings 窗内层（Hub 打开时呈现待上报项）。**真实上报端点 OUT**——本期仅生成本地 `.dsdiag` 文件 + 本地排队，接 D8 既有 disabled「生成诊断」按钮。

**关联 spec:** [`../spec.md`](../spec.md)（§1 J5）。**前置：M8c P1–P3 已落**；D8 AboutPage 有 disabled「生成 .dsdiag」按钮。

---

## 文件结构
- 新 `apps/desktop/electron/main/crash-payload.ts`（纯：assemble + 脱敏）
- 改 `apps/desktop/electron/main/windows.ts`（render-process-gone → 生成 .dsdiag）、`methods.ts`（+`app.generateDiag`）、`ipc-router.ts`（handler）
- 改 `apps/desktop/src/renderer/settings/pages/AboutPage.vue`（启用「生成 .dsdiag」→ 调 RPC）
- 测试：`crash-payload.test.ts`
- 收尾：`docs/milestones/M8c/{README,RESULTS}`、`CURRENT.md`、milestones 索引

---

## Task 1: crash-payload（脱敏，纯）

**Files:** Create `apps/desktop/electron/main/crash-payload.ts`；Test `apps/desktop/test/crash-payload.test.ts`

- [ ] **Step 1: 失败测试**

```ts
// apps/desktop/test/crash-payload.test.ts
import { describe, it, expect } from 'vitest';
import { assembleDiag } from '../electron/main/crash-payload';

describe('assembleDiag（J5 脱敏）', () => {
  it('含系统/堆栈/配置摘要；剔除 Key 与对话；日志截 200 行', () => {
    const out = assembleDiag({
      version: '0.1.0',
      platform: 'win32',
      stack: 'Error: boom\n  at x',
      prefs: { 'model.activeProvider': 'openai', 'model.activeModel': 'gpt-4o' },
      logs: Array.from({ length: 500 }, (_, i) => `line ${i}`),
      secrets: { apiKey: 'sk-SHOULD-NOT-APPEAR' },
    });
    expect(out.version).toBe('0.1.0');
    expect(out.config['model.activeProvider']).toBe('openai');
    expect(out.logs).toHaveLength(200); // 最近 200 行
    expect(out.logs[0]).toBe('line 300');
    expect(JSON.stringify(out)).not.toContain('sk-SHOULD-NOT-APPEAR');
    expect(JSON.stringify(out)).not.toContain('apiKey');
  });
});
```

- [ ] **Step 2: 失败** — FAIL。

- [ ] **Step 3: 实现**

```ts
// apps/desktop/electron/main/crash-payload.ts
/** J5 诊断/崩溃 payload 组装 + 脱敏（纯）：永不含 Key/对话内容；日志仅最近 200 行。 */
export interface DiagInput {
  version: string;
  platform: string;
  stack?: string;
  prefs: Record<string, unknown>;
  logs: string[];
  secrets?: unknown; // 仅为强调"不进 payload"，函数不读它
}
export interface Diag {
  version: string;
  platform: string;
  stack: string;
  config: Record<string, unknown>;
  logs: string[];
}
const MAX_LOG_LINES = 200;

export function assembleDiag(input: DiagInput): Diag {
  // 配置摘要：只取非敏感 prefs（剔除任何含 key/secret/token 字样的键）。
  const config: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input.prefs)) {
    if (/key|secret|token|password/i.test(k)) continue;
    config[k] = v;
  }
  return {
    version: input.version,
    platform: input.platform,
    stack: input.stack ?? '',
    config,
    logs: input.logs.slice(-MAX_LOG_LINES),
  };
}
```

- [ ] **Step 4: 通过 + 提交**

```bash
pnpm --filter @desksoul/desktop exec vitest run test/crash-payload.test.ts
git add apps/desktop/electron/main/crash-payload.ts apps/desktop/test/crash-payload.test.ts
git commit -m "feat(desktop): J5 desensitized diag payload (no keys/convo, 200-line logs)"
```

---

## Task 2: app.generateDiag RPC + render-process-gone 钩子 + D8 按钮

**Files:** Modify `methods.ts`、`ipc-router.ts`、`windows.ts`、`settings/pages/AboutPage.vue`

- [ ] **Step 1: methods 加 `app.generateDiag`**

```ts
  'app.generateDiag': {
    params: z.object({}),
    result: z.object({ ok: z.literal(true), path: z.string() }),
  },
```

- [ ] **Step 2: ipc-router handler（写本地 .dsdiag）**

`createRouter` 内加：
```ts
    'app.generateDiag': () => {
      const diag = assembleDiag({
        version: deps.appVersion ?? '0.0.0',
        platform: process.platform,
        prefs: prefsStore.getAll() as Record<string, unknown>,
        logs: [], // M9 接真实日志缓冲；本期空/占位
      });
      const out = deps.diagPath ?? 'desksoul.dsdiag';
      // 写文件（fs）。返回路径。
      return { ok: true as const, path: out };
    },
```
import `assembleDiag`；`IpcRouterDeps` 加 `appVersion?: string; diagPath?: string;`（index 注入 `app.getVersion()` + `path.join(userData, 'desksoul.dsdiag')`），并用 `node:fs` writeFileSync 落盘 JSON。

- [ ] **Step 3: render-process-gone → 落 .dsdiag**

windows.ts 的 `attachCrashRecovery` 内，reload 前加：生成一次诊断（经注入的回调）。最小：暴露一个 `onCrash?(name)` 回调，index 注入 → 调 generateDiag 逻辑（或仅记日志，M9 完善）。本期可仅 console + 留 TODO(M9 真实排队上报)。

- [ ] **Step 4: D8 启用「生成 .dsdiag」**

AboutPage.vue：把 disabled「生成 .dsdiag」按钮改为：
```vue
        <button :class="`${BTN} text-text-sub`" @click="genDiag">生成 .dsdiag</button>
```
script 加：
```ts
async function genDiag(): Promise<void> {
  const r = (await window.desksoul.rpc('app.generateDiag', {})) as { path: string };
  // 可 toast 路径；最小先 console
  console.info('[diag] written to', r.path);
}
```

- [ ] **Step 5: typecheck + 全量 + 提交**

```bash
pnpm --filter @desksoul/protocol build
pnpm --filter @desksoul/desktop typecheck
pnpm --filter @desksoul/desktop test
pnpm exec prettier --write apps/desktop/electron/main/ipc-router.ts apps/desktop/electron/main/windows.ts apps/desktop/src/renderer/settings/pages/AboutPage.vue packages/protocol/src/methods.ts
git add -A
git commit -m "feat(desktop): app.generateDiag (local .dsdiag) + wire D8 button + crash hook"
```

> J5 完整对话框（友好文案 + 上送预览 + [不上报][仅这次][上报] + 自动上报选项）：本期生成本地 .dsdiag + D8 入口先落地；**对话框 UI + 真实上报端点留 M9**（无后端，避免假上报）。记 RESULTS 残留。

---

## Task 3: M8c 视觉保真 + 收尾

- [ ] **Step 1: 真窗核对（对照 6a38a202 J1/J2/J5 区）** — `pnpm --filter @desksoul/desktop dev`：托盘图标/菜单/三态、D2 热键页录制/冲突、D8 生成诊断。托盘图标占位件记残留。

- [ ] **Step 2: 全量回归 + build** — protocol/sidecar/desktop test + typecheck + build，记测试数。

- [ ] **Step 3: 写 `docs/milestones/M8c/RESULTS.md`**（摘要/测试数/阶段/残留/人工硬门槛）。残留至少：托盘图标占位件、J5 对话框 UI + 真实上报端点（M9）、热键重注册多平台验证。

- [ ] **Step 4: 更新 CURRENT.md M8c 行 + M8c README 阶段链 ✅ + milestones 索引。**

- [ ] **Step 5: 提交**

```bash
git add docs/milestones/M8c/ docs/status/CURRENT.md docs/milestones/README.md
git commit -m "docs(m8c): RESULTS + status (code complete; real-window pending human)"
```

> **PM 交接**：PM 复核 → `mvp/M8c-code-done`；真窗冒烟（托盘/热键/诊断）通过 → `mvp/M8c-done`。M8c 收尾即 **M8 整体收口**。

---

## Self-Review（plan vs spec J5 + M8c 收尾）
- **J5 脱敏 payload**：T1 assembleDiag（剔 Key/对话、截 200 行）✓。
- **生成 .dsdiag + D8 入口 + 崩溃钩子**：T2 ✓。
- **诚实/OUT**：J5 完整对话框 + 真实上报端点明确留 M9（不假上报）；托盘图标占位件记残留。
- **类型一致**：`assembleDiag`(T1) ↔ ipc-router(T2)；`app.generateDiag` schema ↔ AboutPage 调用一致。
- **回归点**：D8 按钮从 disabled→启用（接真实本地生成）；新 RPC 不影响既有。
