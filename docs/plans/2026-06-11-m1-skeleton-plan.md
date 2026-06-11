# M1 · 架构骨架收口与 Spike 代码迁移 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 S1–S5 验证过的代码迁移到 `apps/desktop` + `apps/sidecar` + `packages/protocol`，达成 impl-plan M1 验收：三窗口启动且崩溃隔离、protocol schema 单一真源、E2E（overlay 发 `chat.send` → mock provider → character 切表情）。

**Architecture:** Electron Main 承载 ProviderHost（合并 S2 监督 + S4 流式取消 + S5 `env:{}` jail 子集）、ConversationCore（双轨拆分）与统一 JSON-RPC 路由（Zod 校验）；三个 Renderer（character 透明 / overlay / settings 隐藏）经唯一 preload 暴露 `window.desksoul.rpc/on`；Worker MessagePort 帧协议收口到 `@desksoul/protocol/schemas.ts` 作为单一真源。

**Tech Stack:** Electron 30 + electron-vite 2（三路构建，preload 输出 CJS）、Vue 3（overlay）、Three.js 0.180 + @pixiv/three-vrm 3.4（character）、Zod、Vitest。

**分支：** `feat/m1-skeleton`（从 main 切出；完成后 merge 回 main 并打 tag `mvp/M1-done`）。

---

## 来自 spike-summary 的强制约束（实证修正，不可回退）

1. **Character 窗口必须 `sandbox: false`**（Electron 限制：`transparent:true + sandbox:true` 下 preload 静默失败）；`contextIsolation: true` 保持；overlay/settings 全沙箱。
2. **退避只在收到 worker 任何消息后重置**（spawn 即重置会让 crash-on-start 风暴化）。
3. **protocol 所有相对导出带 `.js` 后缀**（Node ESM 运行时要求）。
4. **高 DPI：`clientX/Y` 按 `getPixelRatio()` 换算成 device 像素再翻转 y 轴**。
5. **拖拽期间冻结穿透切换**（否则 `mouseup` 落到桌面，`dragging` 永不复位）。
6. **preload 必须构建为 CJS**（sandbox renderer 只认 CJS preload）。

## 范围决策（M1 做 / 不做）

| 项 | M1 | 理由 |
| --- | --- | --- |
| ProviderHost = S2 监督 + S4 流式 + `env:{}` | ✅ | spike 已验证，三者合一是生产形态 |
| `--permission` fs jail + fetch 网关 + safeStorage | ❌ → M5 | impl-plan M5 范围；mock provider 无网络需求 |
| BehaviorParser 生产化（300ms flush 等） | ❌ → M3 | 现有 parser 已支持 4 类标签，够 M1 用 |
| VRM 资产 `asset://` 协议 | ❌ → M4 | M1 用 `public/models/sample.vrm`（gitignore）+ DOM 情绪脸 fallback |
| Playwright E2E 自动化 | ❌ → M8/M9 | M1 手动 E2E + RESULTS-M1.md 记录 |
| 删除 `apps/spikes/*` | ❌ 保留 | Phase 2 总判据要求 spike 判据回归测试仍可跑 |
| sidecar 的 `worker-entry.ts`/`server.ts`（request/response 模式） | ✅ 保留不动 | M2 `plugin.*` 命名空间的基础，已有单测 |

## File Structure

```
packages/protocol/src/
  jsonrpc.ts                ← 已有，不动
  methods.ts                ← 扩展：+app.window.setClickThrough / +app.window.moveBy
  behavior-parser.ts        ← 已有，不动（M3 再生产化）
  schemas.ts                ← 新增：Worker MessagePort 帧协议（ChatEvent / chat.start / chat.cancel / chat.event）
  index.ts                  ← +export * from './schemas.js'
packages/protocol/test/
  schemas.test.ts           ← 新增
  methods.test.ts           ← 追加 app.window.* 用例

apps/sidecar/src/workers/
  mock-provider.ts          ← ChatEvent 改从 protocol import（并 re-export 兼容）
  provider-worker-entry.ts  ← 帧类型改从 protocol import

apps/desktop/
  electron.vite.config.ts   ← 三 renderer 输入 + preload CJS 输出
  package.json              ← +three/@pixiv/three-vrm/protocol/sidecar/zod/vitest，+test script
  tsconfig.node.json        ← include 加 test/**
  electron/main/
    index.ts                ← 重写：三窗口 + router 装配 + 生命周期
    windows.ts              ← 新增：三窗口编排 + render-process-gone 自愈
    ipc-router.ts           ← 新增：Electron 接线（ipcMain.handle + 广播）
    router.ts               ← 新增：纯 JSON-RPC 路由（Zod 校验，可单测）
    provider-host.ts        ← 新增：合并版 ProviderHost
    conversation-core.ts    ← 迁移自 S4（类型源改 protocol）
  electron/preload/index.ts ← S4 版（rpc + on）
  src/renderer/
    desksoul.d.ts           ← 新增：window.desksoul 全局类型
    character/{index.html, main.ts, vrm-stage.ts, interaction.ts, hysteresis.ts, fallback-face.ts}
    overlay/{index.html, main.ts, App.vue}
    settings/{index.html, main.ts}
    （删除旧的根级 index.html / main.ts / App.vue）
  test/
    provider-host.test.ts   ← S2+S4 测试合并改造（9 cases）
    conversation-core.test.ts ← 迁移自 S4
    router.test.ts          ← 新增
    hysteresis.test.ts      ← 新增
    fixtures/{crash-worker.mjs, wedged-worker.mjs}
  RESULTS-M1.md             ← 手动 E2E 验收记录

.gitignore                  ← +apps/desktop/public/models/
```

---

### Task 1: 开分支 + protocol 帧协议 `schemas.ts`（TDD）

Worker MessagePort 帧目前分散在 `apps/sidecar/src/workers/*.ts`（自定义 interface）与 S4 的 `provider-host.ts`。收口到 protocol 成为单一真源。`ChatEvent.done.finishReason` 扩为 `'stop' | 'cancel' | 'error'`：worker 只发 stop/cancel，`error` 由 Main 侧 ProviderHost 在 worker 死亡时合成。

**Files:**
- Create: `packages/protocol/src/schemas.ts`
- Create: `packages/protocol/test/schemas.test.ts`
- Modify: `packages/protocol/src/index.ts`

- [ ] **Step 1: 开分支**

```bash
git checkout -b feat/m1-skeleton
```

- [ ] **Step 2: 写失败测试** `packages/protocol/test/schemas.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import {
  ChatEventSchema,
  ChatStartFrame,
  ChatCancelFrame,
  ChatEventFrame,
  ProviderInboundFrame,
} from '../src/schemas';

describe('worker frame schemas', () => {
  it('parses a delta chat event', () => {
    const e = ChatEventSchema.parse({ type: 'delta', text: '嗯…' });
    expect(e).toEqual({ type: 'delta', text: '嗯…' });
  });

  it('parses done with all three finish reasons', () => {
    for (const finishReason of ['stop', 'cancel', 'error'] as const) {
      expect(ChatEventSchema.parse({ type: 'done', finishReason })).toEqual({
        type: 'done',
        finishReason,
      });
    }
  });

  it('rejects an unknown finishReason', () => {
    expect(() => ChatEventSchema.parse({ type: 'done', finishReason: 'oops' })).toThrow();
  });

  it('parses chat.start with optional intervalMs', () => {
    expect(ChatStartFrame.parse({ kind: 'chat.start', requestId: 'r1', sessionId: 's1' })).toEqual({
      kind: 'chat.start',
      requestId: 'r1',
      sessionId: 's1',
    });
    expect(
      ChatStartFrame.parse({ kind: 'chat.start', requestId: 'r1', sessionId: 's1', intervalMs: 0 }),
    ).toMatchObject({ intervalMs: 0 });
  });

  it('parses chat.cancel', () => {
    expect(ChatCancelFrame.parse({ kind: 'chat.cancel', requestId: 'r1' })).toEqual({
      kind: 'chat.cancel',
      requestId: 'r1',
    });
  });

  it('parses chat.event envelope', () => {
    const frame = ChatEventFrame.parse({
      kind: 'chat.event',
      requestId: 'r1',
      sessionId: 's1',
      event: { type: 'delta', text: 'x' },
    });
    expect(frame.event).toEqual({ type: 'delta', text: 'x' });
  });

  it('discriminates inbound frames by kind', () => {
    expect(ProviderInboundFrame.parse({ kind: 'chat.cancel', requestId: 'r9' })).toMatchObject({
      kind: 'chat.cancel',
    });
    expect(() => ProviderInboundFrame.parse({ kind: 'nope' })).toThrow();
  });
});
```

- [ ] **Step 3: 跑测试看红**

Run: `pnpm --filter @desksoul/protocol test`
Expected: FAIL — `Cannot find module '../src/schemas'`

- [ ] **Step 4: 实现** `packages/protocol/src/schemas.ts`

```ts
import { z } from 'zod';

/**
 * Worker MessagePort 帧协议 — Main ⇄ Provider Worker 的单一真源。
 *
 * 与 methods.ts（Renderer ⇄ Main 的 JSON-RPC method 表）相区分：这里是流式
 * provider 的内部帧（一次 chat.start 对应 N 个 chat.event），不是 request/response。
 *
 * `done.finishReason` 三态：worker 只产生 'stop' | 'cancel'；'error' 由 Main 侧
 * ProviderHost 在 worker 死亡 / 被强杀连带时合成，worker 自身永不发送。
 */
export const ChatEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('delta'), text: z.string() }),
  z.object({ type: z.literal('done'), finishReason: z.enum(['stop', 'cancel', 'error']) }),
]);
export type ChatEvent = z.infer<typeof ChatEventSchema>;

/** Main → Worker：开始一次流式补全。 */
export const ChatStartFrame = z.object({
  kind: z.literal('chat.start'),
  requestId: z.string(),
  sessionId: z.string(),
  /** mock provider 的出块间隔（测试用 0/小值）。 */
  intervalMs: z.number().int().nonnegative().optional(),
});
export type ChatStartFrame = z.infer<typeof ChatStartFrame>;

/** Main → Worker：协作取消（不保证 worker 响应；watchdog 兜底在 Main 侧）。 */
export const ChatCancelFrame = z.object({
  kind: z.literal('chat.cancel'),
  requestId: z.string(),
});
export type ChatCancelFrame = z.infer<typeof ChatCancelFrame>;

/** Worker → Main：流事件信封。 */
export const ChatEventFrame = z.object({
  kind: z.literal('chat.event'),
  requestId: z.string(),
  sessionId: z.string(),
  event: ChatEventSchema,
});
export type ChatEventFrame = z.infer<typeof ChatEventFrame>;

export const ProviderInboundFrame = z.discriminatedUnion('kind', [ChatStartFrame, ChatCancelFrame]);
export type ProviderInboundFrame = z.infer<typeof ProviderInboundFrame>;

export const ProviderOutboundFrame = ChatEventFrame;
export type ProviderOutboundFrame = ChatEventFrame;
```

- [ ] **Step 5: 导出**：`packages/protocol/src/index.ts` 追加一行（保持 `.js` 后缀约定）：

```ts
export * from './schemas.js';
```

- [ ] **Step 6: 跑测试看绿**

Run: `pnpm --filter @desksoul/protocol test`
Expected: PASS（schemas.test.ts 7 个用例 + 既有测试全绿）

- [ ] **Step 7: 提交**

```bash
git add packages/protocol
git commit -m "feat(protocol): worker frame schemas as single source of truth"
```

---

### Task 2: protocol 增加 `app.window.*` method（TDD）

S1 的 `s1:set-click-through` / `s1:window-move-by` 临时 channel 收编进统一 JSON-RPC 路由（tech-design §3 的 `app.*` 命名空间）。

**Files:**
- Modify: `packages/protocol/src/methods.ts`
- Modify: `packages/protocol/test/methods.test.ts`

- [ ] **Step 1: 追加失败测试**：`packages/protocol/test/methods.test.ts` 文件末尾追加：

```ts
describe('app.window.* methods', () => {
  it('validates setClickThrough params', () => {
    const m = Methods['app.window.setClickThrough'];
    expect(m.params.safeParse({ ignore: true }).success).toBe(true);
    expect(m.params.safeParse({ ignore: 'yes' }).success).toBe(false);
    expect(m.params.safeParse({}).success).toBe(false);
  });

  it('validates moveBy params', () => {
    const m = Methods['app.window.moveBy'];
    expect(m.params.safeParse({ dx: 3, dy: -2 }).success).toBe(true);
    expect(m.params.safeParse({ dx: 3 }).success).toBe(false);
    expect(m.params.safeParse({ dx: 'a', dy: 0 }).success).toBe(false);
  });
});
```

（若该文件没有 `import { describe, it, expect } from 'vitest';` 与 `import { Methods } from '../src/methods';`，确保头部已有。）

- [ ] **Step 2: 跑测试看红**

Run: `pnpm --filter @desksoul/protocol test`
Expected: FAIL — `app.window.setClickThrough` 不在 Methods 上（TS 索引报错或 undefined）

- [ ] **Step 3: 实现**：`packages/protocol/src/methods.ts` 的 `Methods` 中，`'chat.cancel'` 条目之后追加：

```ts
  // --- request/response: Renderer → Main（窗口自操作；Main 端以 sender 定位窗口）---
  'app.window.setClickThrough': {
    params: z.object({ ignore: z.boolean() }),
    result: z.object({ ok: z.literal(true) }),
  },
  'app.window.moveBy': {
    params: z.object({ dx: z.number(), dy: z.number() }),
    result: z.object({ ok: z.literal(true) }),
  },
```

- [ ] **Step 4: 跑测试看绿**

Run: `pnpm --filter @desksoul/protocol test`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/protocol
git commit -m "feat(protocol): app.window.setClickThrough / moveBy method signatures"
```

---

### Task 3: sidecar 收口到 protocol 帧类型（重构，测试保绿）

**Files:**
- Modify: `apps/sidecar/src/workers/mock-provider.ts`
- Modify: `apps/sidecar/src/workers/provider-worker-entry.ts`

- [ ] **Step 1: 先跑现有测试确认绿色基线**

Run: `pnpm --filter @desksoul/protocol build && pnpm --filter @desksoul/sidecar test`
Expected: PASS（4 个测试文件）

- [ ] **Step 2: `mock-provider.ts`** — 删除本地 `ChatEvent` 类型定义（文件头部的 `export type ChatEvent = ...` 两段 union），改为：

```ts
import type { ChatEvent } from '@desksoul/protocol';

// 帧类型已收口到 @desksoul/protocol（单一真源）；re-export 维持既有 import 路径兼容。
export type { ChatEvent };
```

其余实现不动（`mockProviderChat` 的 yield 值天然满足 protocol 的 `ChatEvent`——它只产生 `stop`/`cancel`，是 `'stop'|'cancel'|'error'` 的子集）。

- [ ] **Step 3: `provider-worker-entry.ts`** — 删除本地 `StartMessage` / `CancelMessage` / `InboundMessage` / `EventMessage` 四个 interface 定义，改为：

```ts
import type {
  ChatStartFrame,
  ChatCancelFrame,
  ProviderInboundFrame,
  ChatEventFrame,
} from '@desksoul/protocol';

// 兼容别名：帧定义已收口到 @desksoul/protocol。
export type StartMessage = ChatStartFrame;
export type CancelMessage = ChatCancelFrame;
export type InboundMessage = ProviderInboundFrame;
export type EventMessage = ChatEventFrame;
```

函数体内引用（`msg.kind === 'chat.start'` 等）不变。

- [ ] **Step 4: 构建 + 全测试**

Run: `pnpm --filter @desksoul/sidecar build && pnpm --filter @desksoul/sidecar test && pnpm --filter @desksoul/sidecar typecheck`
Expected: 全 PASS（行为零变化，纯类型来源切换）

- [ ] **Step 5: 提交**

```bash
git add apps/sidecar
git commit -m "refactor(sidecar): adopt protocol worker frames as type source"
```

---

### Task 4: desktop 工程化 — 三 renderer 布局 + CJS preload + vitest

纯配置/脚手架任务（无 TDD）；验证 = 构建通过。

**Files:**
- Modify: `apps/desktop/package.json`
- Modify: `apps/desktop/electron.vite.config.ts`
- Modify: `apps/desktop/tsconfig.node.json`
- Modify: `apps/desktop/electron/preload/index.ts`
- Create: `apps/desktop/src/renderer/desksoul.d.ts`
- Create: `apps/desktop/src/renderer/{character,overlay,settings}/index.html`（占位，后续任务填实）
- Create: `apps/desktop/src/renderer/{character,overlay,settings}/main.ts`（占位）
- Delete: `apps/desktop/src/renderer/{index.html,main.ts,App.vue}`（旧单入口）
- Modify: `.gitignore`

- [ ] **Step 1: 依赖**

```bash
pnpm --filter @desksoul/desktop add three@^0.180.0 @pixiv/three-vrm@^3.4.0 zod@^3.23.0 \
  @desksoul/protocol@workspace:* @desksoul/sidecar@workspace:*
pnpm --filter @desksoul/desktop add -D @types/three@^0.180.0 vitest@^1.6.0
```

- [ ] **Step 2: `package.json` scripts** 增加 test：

```json
"test": "vitest run --passWithNoTests",
```

- [ ] **Step 3: 重写 `electron.vite.config.ts`**

```ts
import { resolve } from 'node:path';
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
    build: {
      lib: { entry: 'electron/preload/index.ts' },
      // sandbox renderer 只支持 CJS preload（S4 实证：ESM preload 静默失败）
      rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } },
    },
  },
  renderer: {
    root: 'src/renderer',
    plugins: [vue()],
    build: {
      rollupOptions: {
        input: {
          character: resolve(__dirname, 'src/renderer/character/index.html'),
          overlay: resolve(__dirname, 'src/renderer/overlay/index.html'),
          settings: resolve(__dirname, 'src/renderer/settings/index.html'),
        },
      },
    },
  },
});
```

- [ ] **Step 4: 重写 `electron/preload/index.ts`**（S4 验证版，三窗口共用）

```ts
import { contextBridge, ipcRenderer } from 'electron';

// 三个 renderer 共用的唯一 Node 表面：JSON-RPC `rpc(...)` + 通知订阅 `on(channel, cb)`
//（返回退订函数）。不漏 ipcRenderer 本体（sandbox + contextIsolation）。
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

- [ ] **Step 5: 全局类型** `src/renderer/desksoul.d.ts`

```ts
export {};

declare global {
  interface Window {
    desksoul: {
      rpc: (method: string, params?: unknown) => Promise<unknown>;
      on: (channel: string, cb: (payload: unknown) => void) => () => void;
    };
  }
}
```

- [ ] **Step 6: 目录重组**

```bash
git rm apps/desktop/src/renderer/index.html apps/desktop/src/renderer/main.ts apps/desktop/src/renderer/App.vue
mkdir -p apps/desktop/src/renderer/character apps/desktop/src/renderer/overlay apps/desktop/src/renderer/settings apps/desktop/test/fixtures apps/desktop/public/models
```

三个占位 `index.html`（character/overlay/settings 同模板，title 各异；后续任务替换）：

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>DeskSoul · character</title>
  </head>
  <body>
    <div id="app">character placeholder</div>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
```

三个占位 `main.ts`：

```ts
console.log('[renderer] placeholder');
export {};
```

- [ ] **Step 7: `tsconfig.node.json`** 的 `include` 改为：

```json
"include": ["electron/**/*.ts", "electron.vite.config.ts", "test/**/*.ts"]
```

- [ ] **Step 8: `.gitignore`** 追加（VRM 模型不进库；CI 走 fallback 情绪脸）：

```
apps/desktop/public/models/
```

- [ ] **Step 9: 验证构建**

Run: `pnpm install && pnpm --filter @desksoul/desktop build`
Expected: 三路构建成功；`out/preload/index.cjs` 存在；`out/renderer/{character,overlay,settings}/index.html` 存在

- [ ] **Step 10: 提交**

```bash
git add apps/desktop .gitignore pnpm-lock.yaml
git commit -m "chore(desktop): three-renderer electron-vite layout + CJS preload + vitest"
```

---

### Task 5: ProviderHost — 合并 S2 监督 + S4 流式取消（TDD）

M1 最重的任务。合并语义：
- **S4 流式**：`send`/`cancel`/200ms watchdog 强杀 + 合成 `done{cancel}` + 立即重生（主动手术不退避）
- **S2 监督**：意外死亡（crash / exit）→ 指数退避重启（base 1s 封顶 30s），**收到任何消息才重置退避**
- **生产补全**（spike 未覆盖）：worker 死亡时对所有 inflight 合成 `done{error}`；force-terminate 连带杀死同 worker 上其他 session 的流，也合成 `done{error}`
- **S5 子集**：`env: {}`（worker 不继承环境变量）

**Files:**
- Create: `apps/desktop/electron/main/provider-host.ts`
- Create: `apps/desktop/test/provider-host.test.ts`
- Create: `apps/desktop/test/fixtures/crash-worker.mjs`
- Create: `apps/desktop/test/fixtures/wedged-worker.mjs`

- [ ] **Step 1: fixtures**

`test/fixtures/crash-worker.mjs`（驱动退避递增测试）：

```js
// Crash-on-start fixture：用于验证退避指数递增 + 「收到消息才重置」。
throw new Error('boom: crash on start');
```

`test/fixtures/wedged-worker.mjs`（驱动 watchdog 路径；从 S4 迁移）：

```js
// Wedged-provider fixture：开始流后只发一个 delta，然后永远沉默，无视 chat.cancel。
// 用于逼出 ProviderHost 的 cancel watchdog 强杀路径。
import { parentPort } from 'node:worker_threads';

if (!parentPort) throw new Error('must run in worker_threads');

parentPort.on('message', (msg) => {
  if (msg.kind === 'chat.start') {
    parentPort.postMessage({
      kind: 'chat.event',
      requestId: msg.requestId,
      sessionId: msg.sessionId,
      event: { type: 'delta', text: 'wedged…' },
    });
  }
  // deliberately ignore chat.cancel
});
```

- [ ] **Step 2: 写失败测试** `test/provider-host.test.ts`

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChatEvent } from '@desksoul/protocol';
import { ProviderHost } from '../electron/main/provider-host';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PROVIDER_ENTRY = require.resolve('@desksoul/sidecar/dist/workers/provider-worker-entry.js');
const WEDGED_ENTRY = path.join(__dirname, 'fixtures/wedged-worker.mjs');
const CRASH_ENTRY = path.join(__dirname, 'fixtures/crash-worker.mjs');

type Collected = { sessionId: string; event: ChatEvent };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let host: ProviderHost | null = null;
afterEach(async () => {
  await host?.dispose();
  host = null;
});

function untilEvent(
  events: Collected[],
  pred: (e: Collected) => boolean,
  timeoutMs = 4000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timed out waiting for event')), timeoutMs);
    const tick = setInterval(() => {
      if (events.some(pred)) {
        clearTimeout(t);
        clearInterval(tick);
        resolve();
      }
    }, 5);
  });
}

function untilDone(events: Collected[], sessionId: string, timeoutMs = 4000): Promise<void> {
  return untilEvent(events, (e) => e.sessionId === sessionId && e.event.type === 'done', timeoutMs);
}

function doneOf(events: Collected[], sessionId: string): ChatEvent | undefined {
  return events.find((e) => e.sessionId === sessionId && e.event.type === 'done')?.event;
}

describe('ProviderHost · streaming (S4 semantics)', () => {
  it('streams a full reply over a real worker then a stop done', async () => {
    const events: Collected[] = [];
    host = new ProviderHost(PROVIDER_ENTRY, (sessionId, event) => events.push({ sessionId, event }), {
      intervalMs: 0,
    });
    host.send('sess-a');
    await untilDone(events, 'sess-a');

    expect(events.filter((e) => e.event.type === 'delta').length).toBeGreaterThan(0);
    expect(doneOf(events, 'sess-a')).toEqual({ type: 'done', finishReason: 'stop' });
  });

  it('cancels gracefully within the grace window (no force-terminate)', async () => {
    const events: Collected[] = [];
    let forced = false;
    host = new ProviderHost(PROVIDER_ENTRY, (sessionId, event) => events.push({ sessionId, event }), {
      intervalMs: 40,
      cancelGraceMs: 200,
      onForceTerminate: () => (forced = true),
    });
    host.send('sess-b');
    await sleep(60);
    host.cancel('sess-b');
    await untilDone(events, 'sess-b');

    expect(doneOf(events, 'sess-b')).toEqual({ type: 'done', finishReason: 'cancel' });
    expect(forced).toBe(false);
  });

  it('force-terminates a wedged worker and synthesizes a cancel done', async () => {
    const events: Collected[] = [];
    let forced = false;
    host = new ProviderHost(WEDGED_ENTRY, (sessionId, event) => events.push({ sessionId, event }), {
      cancelGraceMs: 100,
      onForceTerminate: () => (forced = true),
    });
    host.send('sess-c');
    await sleep(50);
    host.cancel('sess-c');
    await untilDone(events, 'sess-c');

    expect(forced).toBe(true);
    expect(doneOf(events, 'sess-c')).toEqual({ type: 'done', finishReason: 'cancel' });
  });

  it('keeps serving after a force-terminate respawn', async () => {
    const events: Collected[] = [];
    host = new ProviderHost(WEDGED_ENTRY, (sessionId, event) => events.push({ sessionId, event }), {
      cancelGraceMs: 100,
    });
    host.send('sess-d');
    await sleep(50);
    host.cancel('sess-d');
    await untilDone(events, 'sess-d');

    host.send('sess-e');
    await untilEvent(events, (e) => e.sessionId === 'sess-e' && e.event.type === 'delta');
  });

  it('error-dones sibling sessions when force-terminate kills the shared worker', async () => {
    const events: Collected[] = [];
    host = new ProviderHost(WEDGED_ENTRY, (sessionId, event) => events.push({ sessionId, event }), {
      cancelGraceMs: 80,
    });
    host.send('w1');
    host.send('w2');
    await untilEvent(events, (e) => e.sessionId === 'w2' && e.event.type === 'delta');
    host.cancel('w1');
    await untilDone(events, 'w1');
    await untilDone(events, 'w2');

    expect(doneOf(events, 'w1')).toEqual({ type: 'done', finishReason: 'cancel' });
    expect(doneOf(events, 'w2')).toEqual({ type: 'done', finishReason: 'error' });
  });
});

describe('ProviderHost · supervision (S2 semantics)', () => {
  it('synthesizes an error done when the worker dies mid-stream, then recovers', async () => {
    const events: Collected[] = [];
    host = new ProviderHost(PROVIDER_ENTRY, (sessionId, event) => events.push({ sessionId, event }), {
      intervalMs: 30,
      baseBackoffMs: 50,
    });
    host.send('s-crash');
    await untilEvent(events, (e) => e.sessionId === 's-crash' && e.event.type === 'delta');
    host.killWorkerForTest();
    await untilDone(events, 's-crash');
    expect(doneOf(events, 's-crash')).toEqual({ type: 'done', finishReason: 'error' });

    // 退避 50ms 后重生，新流可用
    await sleep(150);
    host.send('s-after');
    await untilDone(events, 's-after');
    expect(doneOf(events, 's-after')).toEqual({ type: 'done', finishReason: 'stop' });
  });

  it('escalates backoff exponentially while the worker keeps crashing', async () => {
    const waits: number[] = [];
    const events: Collected[] = [];
    host = new ProviderHost(CRASH_ENTRY, (sessionId, event) => events.push({ sessionId, event }), {
      baseBackoffMs: 50,
      maxBackoffMs: 10_000,
      onRespawnScheduled: (ms) => waits.push(ms),
    });
    await sleep(600);
    expect(waits.length).toBeGreaterThanOrEqual(3);
    expect(waits.slice(0, 3)).toEqual([50, 100, 200]);
  });

  it('caps backoff at maxBackoffMs', async () => {
    const waits: number[] = [];
    host = new ProviderHost(CRASH_ENTRY, () => {}, {
      baseBackoffMs: 50,
      maxBackoffMs: 120,
      onRespawnScheduled: (ms) => waits.push(ms),
    });
    await sleep(700);
    expect(Math.max(...waits)).toBeLessThanOrEqual(120);
    expect(waits).toContain(120);
  });

  it('resets backoff only after a healthy response (proof of life)', async () => {
    const waits: number[] = [];
    const events: Collected[] = [];
    host = new ProviderHost(PROVIDER_ENTRY, (sessionId, event) => events.push({ sessionId, event }), {
      intervalMs: 0,
      baseBackoffMs: 50,
      onRespawnScheduled: (ms) => waits.push(ms),
    });
    // 健康流 → backoff 重置为 base → 杀掉 → 第一次重启等待 = base
    host.send('h1');
    await untilDone(events, 'h1');
    host.killWorkerForTest();
    await sleep(150);
    // 再来一轮：健康 → 杀 → 等待仍应是 base（若 spawn 即重置则此断言也过，
    // 但配合 escalates 用例共同钉死「只有响应才重置」）
    host.send('h2');
    await untilDone(events, 'h2');
    host.killWorkerForTest();
    await sleep(150);

    expect(waits).toEqual([50, 50]);
  });
});
```

- [ ] **Step 3: 跑测试看红**

Run: `pnpm --filter @desksoul/desktop test`
Expected: FAIL — `Cannot find module '../electron/main/provider-host'`

- [ ] **Step 4: 实现** `electron/main/provider-host.ts`

```ts
/**
 * ProviderHost — Main 侧 provider worker 监督者（S2+S4+S5 合并生产版）。
 *
 * 职责（M1 范围）：
 *  - 流式驱动：`send`/`cancel` 把 chat.start / chat.cancel 帧发给 worker，
 *    把 chat.event 帧经 `onEvent` 回调交给 ConversationCore。
 *  - 取消兜底（S4）：cancel 先协作，200ms watchdog 超时则强杀 worker、
 *    合成 done{cancel} 并立即重生（主动手术不计退避）。
 *  - 崩溃监督（S2）：worker 意外死亡 → 指数退避重启（封顶 30s）；
 *    **收到 worker 任何消息才重置退避**（健康证明），spawn 不重置 —— 否则
 *    crash-on-start 的 worker 会无限快速重启（S2 实证）。
 *  - 隔离（S5 子集）：`env:{}`，worker 不继承任何环境变量。
 *    `--permission` fs jail 与 fetch 网关随 M5 接入。
 *
 * 死亡清算：worker 死掉时所有 inflight 流收到合成 done —— 被 cancel 的收
 * `cancel`，其余收 `error`。UI 因此永不挂起。
 */
import { Worker } from 'node:worker_threads';
import type { ChatEvent, ChatStartFrame, ProviderOutboundFrame } from '@desksoul/protocol';

export interface ProviderHostOptions {
  /** 协作取消的宽限期，超时强杀（默认 200ms）。 */
  cancelGraceMs?: number;
  /** 意外死亡的重启退避基值（默认 1s）。 */
  baseBackoffMs?: number;
  /** 退避封顶（默认 30s）。 */
  maxBackoffMs?: number;
  /** 透传给 mock provider 的出块间隔（测试用）。 */
  intervalMs?: number;
  /** 观测钩子：watchdog 强杀时触发。 */
  onForceTerminate?: (requestId: string) => void;
  /** 观测钩子：调度重启时触发（参数为本次等待 ms）。 */
  onRespawnScheduled?: (waitMs: number) => void;
}

interface Inflight {
  sessionId: string;
  cancelTimer: ReturnType<typeof setTimeout> | null;
}

export class ProviderHost {
  private worker: Worker | null = null;
  private readonly inflight = new Map<string, Inflight>();
  private nextRequestId = 1;
  private disposed = false;
  private readonly cancelGraceMs: number;
  private readonly base: number;
  private readonly max: number;
  private backoff: number;
  private respawnTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly intervalMs: number | undefined;
  private readonly onForceTerminate: ((requestId: string) => void) | undefined;
  private readonly onRespawnScheduled: ((waitMs: number) => void) | undefined;

  constructor(
    private readonly entryPath: string,
    private readonly onEvent: (sessionId: string, event: ChatEvent) => void,
    opts: ProviderHostOptions = {},
  ) {
    this.cancelGraceMs = opts.cancelGraceMs ?? 200;
    this.base = opts.baseBackoffMs ?? 1_000;
    this.max = opts.maxBackoffMs ?? 30_000;
    this.backoff = this.base;
    this.intervalMs = opts.intervalMs;
    this.onForceTerminate = opts.onForceTerminate;
    this.onRespawnScheduled = opts.onRespawnScheduled;
    this.spawn();
  }

  private spawn(): void {
    if (this.disposed) return;
    this.respawnTimer = null;
    const worker = new Worker(this.entryPath, {
      env: {}, // S5: 不继承环境变量，密钥隔离的零成本部分
      resourceLimits: { maxOldGenerationSizeMb: 128 },
    });
    this.worker = worker;
    worker.on('message', (msg: ProviderOutboundFrame) => {
      this.backoff = this.base; // 收到任何消息 = 健康证明，此刻才重置退避
      this.onWorkerMessage(msg);
    });
    // error 与 exit 可能对同一次死亡都触发；onDeath 以 worker 身份去重。
    worker.on('error', () => this.onDeath(worker));
    worker.on('exit', () => this.onDeath(worker));
  }

  private onWorkerMessage(msg: ProviderOutboundFrame): void {
    if (msg.kind !== 'chat.event') return;
    const entry = this.inflight.get(msg.requestId);
    if (!entry) return; // 已被 force-terminate / 死亡清算掉
    this.onEvent(msg.sessionId, msg.event);
    if (msg.event.type === 'done') this.settle(msg.requestId);
  }

  /** 意外死亡：清算 inflight（合成 error done），按指数退避重生。 */
  private onDeath(dead: Worker): void {
    if (this.disposed || this.worker !== dead) return;
    this.worker = null;
    for (const [requestId, entry] of this.inflight) {
      if (entry.cancelTimer) clearTimeout(entry.cancelTimer);
      this.inflight.delete(requestId);
      this.onEvent(entry.sessionId, { type: 'done', finishReason: 'error' });
    }
    const wait = this.backoff;
    this.backoff = Math.min(this.backoff * 2, this.max);
    this.onRespawnScheduled?.(wait);
    this.respawnTimer = setTimeout(() => this.spawn(), wait);
  }

  /** 开始一个流，返回驱动它的 requestId。 */
  send(sessionId: string): string {
    if (this.disposed) throw new Error('ProviderHost disposed');
    if (!this.worker) throw new Error('provider worker not ready');
    const requestId = `r${this.nextRequestId++}`;
    this.inflight.set(requestId, { sessionId, cancelTimer: null });
    const frame: ChatStartFrame = {
      kind: 'chat.start',
      requestId,
      sessionId,
      ...(this.intervalMs !== undefined ? { intervalMs: this.intervalMs } : {}),
    };
    this.worker.postMessage(frame);
    return requestId;
  }

  /** 取消 `sessionId` 的所有 inflight：协作 cancel + 武装 watchdog。 */
  cancel(sessionId: string): void {
    for (const [requestId, entry] of this.inflight) {
      if (entry.sessionId !== sessionId || entry.cancelTimer) continue;
      this.worker?.postMessage({ kind: 'chat.cancel', requestId });
      entry.cancelTimer = setTimeout(() => this.forceTerminate(requestId), this.cancelGraceMs);
    }
  }

  /** watchdog 超时：强杀 worker，被取消者收 cancel done，连带者收 error done，立即重生。 */
  private forceTerminate(requestId: string): void {
    const entry = this.inflight.get(requestId);
    if (!entry) return;
    this.onForceTerminate?.(requestId);
    const dead = this.worker;
    this.worker = null; // 先置空：dead 稍后的 exit 在 onDeath 因身份不符成为 no-op
    void dead?.terminate();

    this.settle(requestId);
    this.onEvent(entry.sessionId, { type: 'done', finishReason: 'cancel' });
    // 同一 worker 上其他 session 的流被连带杀死
    for (const [rid, other] of this.inflight) {
      if (other.cancelTimer) clearTimeout(other.cancelTimer);
      this.inflight.delete(rid);
      this.onEvent(other.sessionId, { type: 'done', finishReason: 'error' });
    }
    this.spawn(); // 主动手术：立即重生，不计退避
  }

  private settle(requestId: string): void {
    const entry = this.inflight.get(requestId);
    if (entry?.cancelTimer) clearTimeout(entry.cancelTimer);
    this.inflight.delete(requestId);
  }

  /** 仅测试用：模拟 worker 崩溃（触发 onDeath → 退避重启路径）。 */
  killWorkerForTest(): void {
    void this.worker?.terminate();
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    if (this.respawnTimer) {
      clearTimeout(this.respawnTimer);
      this.respawnTimer = null;
    }
    for (const entry of this.inflight.values()) {
      if (entry.cancelTimer) clearTimeout(entry.cancelTimer);
    }
    this.inflight.clear();
    const w = this.worker;
    this.worker = null;
    if (w) await w.terminate();
  }
}
```

- [ ] **Step 5: 构建依赖并跑测试看绿**

Run: `pnpm --filter @desksoul/sidecar build && pnpm --filter @desksoul/desktop test`
Expected: 9 个用例 PASS（注意 fixtures 走真实 worker_threads，单次全套 ≈ 数秒）

- [ ] **Step 6: 提交**

```bash
git add apps/desktop/electron/main/provider-host.ts apps/desktop/test
git commit -m "feat(desktop): ProviderHost — supervised streaming worker host (S2+S4+S5 merge)"
```

---

### Task 6: ConversationCore 迁移（双轨拆分）

**Files:**
- Create: `apps/desktop/electron/main/conversation-core.ts`（迁移自 S4，ChatEvent 改源 protocol）
- Create: `apps/desktop/test/conversation-core.test.ts`（迁移自 S4，import 调整）

- [ ] **Step 1: 迁移测试**：复制 `apps/spikes/S4-streaming-chat/test/conversation-core.test.ts` 到 `apps/desktop/test/conversation-core.test.ts`，仅改头部两行 import：

```ts
import { ConversationCore, type Notification } from '../electron/main/conversation-core';
import type { ChatEvent } from '@desksoul/protocol';
```

（5 个用例本体零修改：单 delta 双轨拆分、跨 delta 半截标签、intent header、done 时 flush 半截标签、多 session 缓冲隔离。）

- [ ] **Step 2: 跑测试看红**

Run: `pnpm --filter @desksoul/desktop test`
Expected: FAIL — `Cannot find module '../electron/main/conversation-core'`

- [ ] **Step 3: 迁移实现**：复制 `apps/spikes/S4-streaming-chat/electron/main/conversation-core.ts` 到 `apps/desktop/electron/main/conversation-core.ts`，仅改一处 import（原 `import type { ChatEvent } from './provider-host.js'`）：

```ts
import { BehaviorParser, type BehaviorEvent, type ChatEvent } from '@desksoul/protocol';
```

类与 `Notification` 类型本体零修改（`chat.done` 的 `finishReason: 'stop'|'cancel'|'error'` 与 protocol `ChatEvent` 的 done 三态天然对齐，透传即可）。

- [ ] **Step 4: 跑测试看绿**

Run: `pnpm --filter @desksoul/desktop test`
Expected: PASS（累计 14 用例）

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/electron/main/conversation-core.ts apps/desktop/test/conversation-core.test.ts
git commit -m "feat(desktop): ConversationCore dual-channel splitter (migrated from S4)"
```

---

### Task 7: JSON-RPC 路由 — 纯函数核心（TDD）+ Electron 接线

路由层是 M1 的"schema 单一真源生效"落点：每个进站 RPC 都用 `Methods[method].params` 做 Zod 校验，违约回 `-32602`，未知方法回 `-32601`（tech-design §3）。纯函数核心不 import electron，可直接单测。

**Files:**
- Create: `apps/desktop/electron/main/router.ts`
- Create: `apps/desktop/test/router.test.ts`
- Create: `apps/desktop/electron/main/ipc-router.ts`

- [ ] **Step 1: 写失败测试** `test/router.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { createRouter, RpcError } from '../electron/main/router';

interface Ctx {
  tag: string;
}

const router = createRouter<Ctx>({
  'sys.ping': (p, ctx) => ({ pong: ctx.tag, echoNonce: p.nonce }),
  'chat.send': (p) => ({ ok: true as const, got: p.sessionId }),
});

describe('createRouter', () => {
  it('dispatches with validated params and ctx', async () => {
    const r = await router.dispatch('sys.ping', { nonce: 'n1' }, { tag: 'ok' });
    expect(r).toEqual({ pong: 'ok', echoNonce: 'n1' });
  });

  it('throws -32601 for an unknown method', async () => {
    await expect(router.dispatch('nope.nope', {}, { tag: 'x' })).rejects.toMatchObject({
      code: -32601,
    });
  });

  it('throws -32601 for a known method with no registered handler', async () => {
    await expect(router.dispatch('chat.cancel', { sessionId: 's' }, { tag: 'x' })).rejects.toMatchObject(
      { code: -32601 },
    );
  });

  it('throws -32602 when params violate the zod schema', async () => {
    await expect(router.dispatch('sys.ping', { nonce: 42 }, { tag: 'x' })).rejects.toMatchObject({
      code: -32602,
    });
    await expect(router.dispatch('chat.send', { sessionId: 's' }, { tag: 'x' })).rejects.toMatchObject(
      { code: -32602 },
    );
  });

  it('exposes RpcError with code + message', () => {
    const e = new RpcError(-32601, 'Method not found: x');
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe(-32601);
  });
});
```

- [ ] **Step 2: 跑测试看红**

Run: `pnpm --filter @desksoul/desktop test`
Expected: FAIL — `Cannot find module '../electron/main/router'`

- [ ] **Step 3: 实现** `electron/main/router.ts`

```ts
/**
 * 纯 JSON-RPC 方法路由 — Main 的唯一 RPC 校验/分发点，不依赖 Electron。
 *
 * 进站 params 一律先过 `@desksoul/protocol` 的 Zod schema（单一真源）：
 * 未注册 / 未知方法 → -32601；schema 违约 → -32602（tech-design §3）。
 */
import type { z } from 'zod';
import { Methods, type MethodName } from '@desksoul/protocol';

export class RpcError extends Error {
  constructor(
    public readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = 'RpcError';
  }
}

export type RpcHandlers<C> = {
  [M in MethodName]?: (
    params: z.infer<(typeof Methods)[M]['params']>,
    ctx: C,
  ) => unknown | Promise<unknown>;
};

export interface RpcRouter<C> {
  dispatch(method: string, params: unknown, ctx: C): Promise<unknown>;
}

export function createRouter<C>(handlers: RpcHandlers<C>): RpcRouter<C> {
  const handlerMap = handlers as Partial<
    Record<string, (params: unknown, ctx: C) => unknown | Promise<unknown>>
  >;
  const methodMap = Methods as Record<string, { params: z.ZodTypeAny }>;

  return {
    async dispatch(method, params, ctx) {
      const def = methodMap[method];
      const handler = handlerMap[method];
      if (!def || !handler) throw new RpcError(-32601, `Method not found: ${method}`);
      const parsed = def.params.safeParse(params);
      if (!parsed.success) {
        throw new RpcError(-32602, `Invalid params for ${method}: ${parsed.error.message}`);
      }
      return handler(parsed.data, ctx);
    },
  };
}
```

- [ ] **Step 4: 跑测试看绿**

Run: `pnpm --filter @desksoul/desktop test`
Expected: PASS（累计 19 用例）

- [ ] **Step 5: Electron 接线** `electron/main/ipc-router.ts`（无单测；逻辑都在被测的 router/host/core 里）

```ts
/**
 * IPC 路由接线 — Renderer ⇄ Main 的唯一缝。
 *
 * 进站：preload 的 `window.desksoul.rpc` → `ipcMain.handle('desksoul:rpc')` →
 *       纯 router（Zod 校验 + 分发）。
 * 出站：ConversationCore 的每个 Notification 广播到所有窗口的
 *       `desksoul:notify:<channel>`；各 renderer 只订阅自己关心的 channel
 *       （overlay → chat.*，character → behavior.* + chat.done）。
 */
import { ipcMain, BrowserWindow, type WebContents } from 'electron';
import { ProviderHost } from './provider-host.js';
import { ConversationCore, type Notification } from './conversation-core.js';
import { createRouter } from './router.js';

export interface IpcRouterDeps {
  targets: () => WebContents[];
  providerEntryPath: string;
}

export interface RpcContext {
  win: BrowserWindow | null;
}

export function registerIpcRouter(deps: IpcRouterDeps): { dispose: () => Promise<void> } {
  const broadcast = (n: Notification): void => {
    for (const wc of deps.targets()) {
      if (!wc.isDestroyed()) wc.send(`desksoul:notify:${n.channel}`, n.params);
    }
  };

  const core = new ConversationCore(broadcast);
  const host = new ProviderHost(deps.providerEntryPath, (sessionId, event) =>
    core.handleEvent(sessionId, event),
  );

  const router = createRouter<RpcContext>({
    'sys.ping': (p) => ({ pong: 'ok', echoNonce: p.nonce }),
    'chat.send': (p) => {
      host.send(p.sessionId);
      return { ok: true as const };
    },
    'chat.cancel': (p) => {
      host.cancel(p.sessionId);
      return { ok: true as const };
    },
    'app.window.setClickThrough': (p, ctx) => {
      ctx.win?.setIgnoreMouseEvents(p.ignore, { forward: true });
      return { ok: true as const };
    },
    'app.window.moveBy': (p, ctx) => {
      if (ctx.win) {
        const [x, y] = ctx.win.getPosition();
        ctx.win.setPosition(x + Math.round(p.dx), y + Math.round(p.dy));
      }
      return { ok: true as const };
    },
  });

  ipcMain.handle('desksoul:rpc', (e, payload: { method?: unknown; params?: unknown }) => {
    const method = typeof payload?.method === 'string' ? payload.method : '';
    return router.dispatch(method, payload?.params, {
      win: BrowserWindow.fromWebContents(e.sender),
    });
  });

  return {
    dispose: async () => {
      ipcMain.removeHandler('desksoul:rpc');
      await host.dispose();
    },
  };
}
```

- [ ] **Step 6: typecheck**

Run: `pnpm --filter @desksoul/desktop typecheck`
Expected: PASS

- [ ] **Step 7: 提交**

```bash
git add apps/desktop/electron/main/router.ts apps/desktop/electron/main/ipc-router.ts apps/desktop/test/router.test.ts
git commit -m "feat(desktop): zod-validated JSON-RPC router + ipc wiring"
```

---

### Task 8: 三窗口编排 + 崩溃自愈 + Main 入口

**Files:**
- Create: `apps/desktop/electron/main/windows.ts`
- Modify: `apps/desktop/electron/main/index.ts`（整体重写）

- [ ] **Step 1: `windows.ts`**

```ts
/**
 * 三窗口编排（tech-design §2）：
 *  - character：透明无边框桌宠窗口。Electron 已知限制：transparent:true 与
 *    sandbox:true 冲突（preload 静默失败，S1 实证），必须 sandbox:false；
 *    contextIsolation 保持开启，preload 只暴露 rpc/on，Main 路由层 Zod 校验兜底。
 *  - overlay：聊天/操作浮层（全沙箱）。
 *  - settings：常驻隐藏，按需 show（全沙箱）。
 * 所有窗口挂 render-process-gone 自愈：崩溃即 reload（进程级隔离由 Chromium 保证）。
 */
import { BrowserWindow, screen, type WebContents } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRELOAD = path.join(__dirname, '../preload/index.cjs');

export interface AppWindows {
  character: BrowserWindow;
  overlay: BrowserWindow;
  settings: BrowserWindow;
}

async function loadRenderer(
  win: BrowserWindow,
  name: 'character' | 'overlay' | 'settings',
): Promise<void> {
  if (process.env.ELECTRON_RENDERER_URL) {
    await win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/${name}/index.html`);
  } else {
    await win.loadFile(path.join(__dirname, `../renderer/${name}/index.html`));
  }
}

function attachCrashRecovery(win: BrowserWindow, name: string): void {
  win.webContents.on('render-process-gone', (_e, details) => {
    if (details.reason === 'clean-exit') return;
    console.warn(`[windows] ${name} renderer gone (${details.reason}); reloading`);
    if (!win.isDestroyed()) win.webContents.reload();
  });
}

export function createAppWindows(): AppWindows {
  const { workArea } = screen.getPrimaryDisplay();
  const margin = 24;

  const character = new BrowserWindow({
    width: 320,
    height: 480,
    x: workArea.x + workArea.width - 320 - margin,
    y: workArea.y + workArea.height - 480 - margin,
    frame: false,
    transparent: true,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: PRELOAD,
      sandbox: false, // 透明窗口必须；见文件头注释
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false, // 失焦不降频，表情驱动不卡顿
    },
  });

  const overlay = new BrowserWindow({
    width: 420,
    height: 560,
    x: workArea.x + workArea.width - 320 - margin - 420 - 16,
    y: workArea.y + workArea.height - 560 - margin,
    webPreferences: {
      preload: PRELOAD,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const settings = new BrowserWindow({
    width: 720,
    height: 520,
    show: false,
    webPreferences: {
      preload: PRELOAD,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  attachCrashRecovery(character, 'character');
  attachCrashRecovery(overlay, 'overlay');
  attachCrashRecovery(settings, 'settings');

  void loadRenderer(character, 'character');
  void loadRenderer(overlay, 'overlay');
  void loadRenderer(settings, 'settings');

  return { character, overlay, settings };
}

export function rendererTargets(wins: AppWindows): () => WebContents[] {
  return () =>
    [wins.character, wins.overlay, wins.settings]
      .filter((w) => !w.isDestroyed())
      .map((w) => w.webContents);
}
```

- [ ] **Step 2: 重写 `electron/main/index.ts`**

```ts
import { app } from 'electron';
import { createRequire } from 'node:module';
import { createAppWindows, rendererTargets, type AppWindows } from './windows.js';
import { registerIpcRouter } from './ipc-router.js';

const require = createRequire(import.meta.url);

let wins: AppWindows | null = null;
let router: { dispose: () => Promise<void> } | null = null;

app.whenReady().then(() => {
  // sidecar 的 worker entry 必须以真实文件路径喂给 new Worker()，不能被 bundle
  //（turbo 的 ^build 保证 dist 先于 desktop 构建存在）。
  const providerEntryPath = require.resolve(
    '@desksoul/sidecar/dist/workers/provider-worker-entry.js',
  );
  wins = createAppWindows();
  router = registerIpcRouter({ targets: rendererTargets(wins), providerEntryPath });

  // settings 常驻 hidden，不算"还开着"；两个可见窗口都关 = 退出。
  const maybeQuit = (): void => {
    if (wins && wins.character.isDestroyed() && wins.overlay.isDestroyed()) app.quit();
  };
  wins.character.on('closed', maybeQuit);
  wins.overlay.on('closed', maybeQuit);
});

app.on('before-quit', () => {
  void router?.dispose();
  router = null;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
```

- [ ] **Step 3: 构建 + typecheck 验证**

Run: `pnpm --filter @desksoul/desktop build && pnpm --filter @desksoul/desktop typecheck`
Expected: PASS

- [ ] **Step 4: 冒烟启动**（占位 renderer 即可）

Run: `pnpm --filter @desksoul/desktop dev`
Expected: 弹出 2 个可见窗口（character 透明区域 + overlay 占位页）；settings 不可见；DevTools 里 `await window.desksoul.rpc('sys.ping', { nonce: 'x' })` 返回 `{pong:'ok', echoNonce:'x'}`。关闭两个窗口后进程退出。

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/electron/main
git commit -m "feat(desktop): three-window orchestration + renderer crash recovery"
```

---

### Task 9: Character renderer — 迟滞（TDD）+ VRM 舞台 + 交互 + fallback 脸

**Files:**
- Create: `apps/desktop/src/renderer/character/hysteresis.ts`
- Create: `apps/desktop/test/hysteresis.test.ts`
- Create: `apps/desktop/src/renderer/character/vrm-stage.ts`
- Create: `apps/desktop/src/renderer/character/interaction.ts`
- Create: `apps/desktop/src/renderer/character/fallback-face.ts`
- Replace: `apps/desktop/src/renderer/character/index.html`、`main.ts`（占位 → 实装）

- [ ] **Step 1: 写失败测试** `test/hysteresis.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { nextIgnore } from '../src/renderer/character/hysteresis';

const T = { enter: 26, exit: 13 };

describe('nextIgnore (双阈值迟滞)', () => {
  it('initial state: solid when alpha >= enter, through when below', () => {
    expect(nextIgnore(30, null, T)).toBe(false);
    expect(nextIgnore(20, null, T)).toBe(true);
  });

  it('stays solid inside the hysteresis band (exit <= alpha < enter)', () => {
    expect(nextIgnore(20, false, T)).toBe(false);
  });

  it('leaves solid only when alpha < exit', () => {
    expect(nextIgnore(10, false, T)).toBe(true);
    expect(nextIgnore(13, false, T)).toBe(false);
  });

  it('from through-state, enters solid only at alpha >= enter', () => {
    expect(nextIgnore(20, true, T)).toBe(true);
    expect(nextIgnore(28, true, T)).toBe(false);
    expect(nextIgnore(26, true, T)).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试看红**

Run: `pnpm --filter @desksoul/desktop test`
Expected: FAIL — module not found

- [ ] **Step 3: 实现** `src/renderer/character/hysteresis.ts`

```ts
export interface HysteresisThresholds {
  /** 进入实心区（停止穿透）需要的 alpha 下限（0–255）。 */
  enter: number;
  /** 已在实心区时，alpha 低于此值才退出（重新穿透）。 */
  exit: number;
}

/**
 * 双阈值迟滞决策：enter > exit 拉开间距，光标在角色边缘游走时穿透状态不抖动。
 * `last === false`（当前实心/可命中）→ 仅 alpha < exit 才切回穿透；
 * 否则（穿透中或初始）→ alpha < enter 即维持/进入穿透。
 */
export function nextIgnore(
  alpha: number,
  last: boolean | null,
  t: HysteresisThresholds,
): boolean {
  return last === false ? alpha < t.exit : alpha < t.enter;
}
```

- [ ] **Step 4: 跑测试看绿**

Run: `pnpm --filter @desksoul/desktop test`
Expected: PASS（累计 23 用例）

- [ ] **Step 5: `vrm-stage.ts`**（S3 迁移：去掉按钮面板 / stats.js / OrbitControls，保留已验证的加载三件套、400ms 情绪过渡、眨眼呼吸 idle）

```ts
/**
 * VRM 舞台 — Character 窗口的渲染引擎封装（S3 验证形态的生产化）。
 * 职责：加载 VRM → 性能优化三件套 → 渲染循环（idle 眨眼/呼吸 + 情绪过渡插值）。
 * 不持有业务状态：情绪指令由外部（behavior.* 订阅者）调 applyEmotion 注入。
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm';

const TRANSITION_MS = 400; // 350–500ms 平滑区间中值（S3 实测）

// 8 种情绪 → VRM expression 权重映射；前 5 个是 VRM 1.0 标准 preset，
// 后 3 个无标准 preset 用组合近似（S3 验证）。
export const EMOTIONS: Record<string, Record<string, number>> = {
  happy: { happy: 1 },
  angry: { angry: 1 },
  sad: { sad: 1 },
  relaxed: { relaxed: 1 },
  surprised: { surprised: 1 },
  shy: { happy: 0.45, relaxed: 0.55 },
  thinking: { relaxed: 0.35, sad: 0.15 },
  confused: { sad: 0.4, surprised: 0.35 },
};

export interface VrmStage {
  /** interaction 需要拿 renderer 做 readPixels 命中检测。 */
  readonly renderer: THREE.WebGLRenderer;
  applyEmotion(name: string, weight?: number): void;
  dispose(): void;
}

export async function createVrmStage(container: HTMLElement, modelUrl: string): Promise<VrmStage> {
  const width = container.clientWidth || 320;
  const height = container.clientHeight || 480;

  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true, // 事件回调里 readPixels 需保留 buffer（S1）
  });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, width / height, 0.1, 20);
  camera.position.set(0, 1.3, 2.2);
  camera.lookAt(0, 1.2, 0);

  const light = new THREE.DirectionalLight(0xffffff, Math.PI);
  light.position.set(1, 1, 1).normalize();
  scene.add(light);
  scene.add(new THREE.AmbientLight(0xffffff, 0.4 * Math.PI));

  // ---- 加载 VRM + 性能三件套（S3 实证 ≥30 FPS 的前提）----
  const vrm = await new Promise<VRM>((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    loader.load(
      modelUrl,
      (gltf) => {
        const v = gltf.userData.vrm as VRM | undefined;
        if (!v) {
          reject(new Error('file loaded but contains no VRM'));
          return;
        }
        VRMUtils.removeUnnecessaryVertices(gltf.scene);
        VRMUtils.combineSkeletons(gltf.scene);
        VRMUtils.combineMorphs(v);
        v.scene.traverse((obj) => {
          obj.frustumCulled = false;
        });
        resolve(v);
      },
      undefined,
      (err) => reject(err instanceof Error ? err : new Error(String(err))),
    );
  });
  scene.add(vrm.scene);

  // ---- 情绪过渡（支持中途打断：以当前帧权重为新起点）----
  const allExpressionNames = [...new Set(Object.values(EMOTIONS).flatMap((m) => Object.keys(m)))];
  let fromWeights: Record<string, number> = {};
  let toWeights: Record<string, number> = {};
  let transitionStart = 0;

  const easeInOut = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

  function applyEmotion(name: string, weight = 1): void {
    const em = vrm.expressionManager;
    if (!em) return;
    const snapshot: Record<string, number> = {};
    for (const n of allExpressionNames) snapshot[n] = em.getValue(n) ?? 0;
    fromWeights = snapshot;
    const target: Record<string, number> = {};
    for (const n of allExpressionNames) target[n] = 0;
    for (const [n, w] of Object.entries(EMOTIONS[name] ?? {})) target[n] = w * weight;
    toWeights = target;
    transitionStart = performance.now();
  }

  function updateTransition(): void {
    const em = vrm.expressionManager;
    if (!em) return;
    const t = Math.min((performance.now() - transitionStart) / TRANSITION_MS, 1);
    const k = easeInOut(t);
    for (const n of allExpressionNames) {
      const from = fromWeights[n] ?? 0;
      const to = toWeights[n] ?? 0;
      em.setValue(n, from + (to - from) * k);
    }
  }

  // ---- idle：自动眨眼 + 呼吸（S3）----
  let nextBlinkAt = performance.now() + 1500;
  let blinkPhase = -1;

  function updateIdle(now: number, delta: number): void {
    const em = vrm.expressionManager;
    if (!em) return;
    if (blinkPhase < 0 && now >= nextBlinkAt) blinkPhase = 0;
    if (blinkPhase >= 0) {
      blinkPhase += delta / 0.12;
      const v = blinkPhase < 1 ? blinkPhase : 2 - blinkPhase;
      em.setValue('blink', Math.max(0, Math.min(1, v)));
      if (blinkPhase >= 2) {
        blinkPhase = -1;
        em.setValue('blink', 0);
        nextBlinkAt = now + 2000 + Math.random() * 4000;
      }
    }
    const chest = vrm.humanoid?.getNormalizedBoneNode('chest');
    if (chest) chest.rotation.x = Math.sin(now / 1000) * 0.02;
  }

  // ---- 渲染循环 ----
  const clock = new THREE.Clock();
  let raf = 0;
  let disposed = false;

  function loop(): void {
    if (disposed) return;
    raf = requestAnimationFrame(loop);
    const delta = clock.getDelta();
    const now = performance.now();
    updateIdle(now, delta);
    updateTransition();
    vrm.update(delta);
    renderer.render(scene, camera);
  }
  loop();

  return {
    renderer,
    applyEmotion,
    dispose(): void {
      disposed = true;
      cancelAnimationFrame(raf);
      VRMUtils.deepDispose(vrm.scene);
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
```

- [ ] **Step 6: `interaction.ts`**（S1 迁移：RPC 走统一 `app.window.*`；拖拽冻结穿透耦合保留）

```ts
/**
 * Character 窗口交互（S1 验证形态）：
 *  - alpha 命中穿透：30Hz 节流 readPixels + 双阈值迟滞 + 高 DPI 像素换算
 *  - 长按 200ms 拖拽：增量经 app.window.moveBy 移动窗口
 *  - 耦合（必须保留）：拖拽期间冻结穿透切换，否则窗口中途变穿透后
 *    mouseup 落到桌面、dragging 永不复位（S1 实证）。
 * VRM 加载失败的 fallback（DOM 脸）没有 alpha buffer：renderer 传 null，
 * 仅启用拖拽、不开穿透。
 */
import type * as THREE from 'three';
import { nextIgnore } from './hysteresis';

const ENTER = 26; // ~0.10 * 255
const EXIT = 13; // ~0.05 * 255
const MOVE_THROTTLE_MS = 33; // ~30Hz
const LONG_PRESS_MS = 200;

export function setupInteraction(renderer: THREE.WebGLRenderer | null): void {
  const shared = { dragging: false };
  if (renderer) setupClickThrough(renderer, shared);
  setupDrag(renderer?.domElement ?? document.body, shared);
}

function setupClickThrough(renderer: THREE.WebGLRenderer, shared: { dragging: boolean }): void {
  const gl = renderer.getContext();
  const px = new Uint8Array(4);
  let lastIgnore: boolean | null = null;
  let lastT = 0;

  function checkAlpha(clientX: number, clientY: number): void {
    // clientX/Y 是 CSS 像素，drawing buffer 是 device 像素：按 pixelRatio 换算
    // 再翻转 y 轴（GL 原点在左下）。150% 缩放下命中才正确（S1 实证）。
    const dpr = renderer.getPixelRatio();
    const bufW = renderer.domElement.width;
    const bufH = renderer.domElement.height;
    const x = Math.floor(clientX * dpr);
    const y = Math.floor(bufH - clientY * dpr);
    if (x < 0 || y < 0 || x >= bufW || y >= bufH) return;

    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const ignore = nextIgnore(px[3] ?? 0, lastIgnore, { enter: ENTER, exit: EXIT });
    if (ignore !== lastIgnore) {
      lastIgnore = ignore;
      void window.desksoul.rpc('app.window.setClickThrough', { ignore });
    }
  }

  window.addEventListener('mousemove', (e: MouseEvent) => {
    if (shared.dragging) return; // 拖拽期间冻结穿透切换
    const now = performance.now();
    if (now - lastT < MOVE_THROTTLE_MS) return;
    lastT = now;
    checkAlpha(e.clientX, e.clientY);
  });

  // 鼠标进入 canvas 时立即检查一次：否则 ignore 态下静止点击会丢 mousedown。
  renderer.domElement.addEventListener('mouseenter', (e: MouseEvent) => {
    checkAlpha(e.clientX, e.clientY);
  });
}

function setupDrag(target: HTMLElement, shared: { dragging: boolean }): void {
  let pressTimer: number | null = null;
  let lastX = 0;
  let lastY = 0;

  target.addEventListener('mousedown', (e: MouseEvent) => {
    lastX = e.screenX;
    lastY = e.screenY;
    pressTimer = window.setTimeout(() => {
      shared.dragging = true;
    }, LONG_PRESS_MS);
  });

  window.addEventListener('mousemove', (e: MouseEvent) => {
    if (!shared.dragging) return;
    const dx = e.screenX - lastX;
    const dy = e.screenY - lastY;
    lastX = e.screenX;
    lastY = e.screenY;
    if (dx !== 0 || dy !== 0) void window.desksoul.rpc('app.window.moveBy', { dx, dy });
  });

  window.addEventListener('mouseup', () => {
    if (pressTimer !== null) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
    shared.dragging = false;
  });
}
```

- [ ] **Step 7: `fallback-face.ts`**（S4 character 重构成接口；VRM 缺失/加载失败时的降级显示，也是 CI 无模型环境的 E2E 载体）

```ts
/** 8 情绪 emoji 脸 —— VRM 不可用时的降级渲染（S4 验证的行为通道载体）。 */
const FACE: Record<string, string> = {
  neutral: '😐',
  happy: '😊',
  angry: '😠',
  sad: '😢',
  relaxed: '😌',
  surprised: '😲',
  shy: '😳',
  thinking: '🤔',
  confused: '😕',
};

export interface FallbackFace {
  apply(name: string): void;
  setAction(name: string, durationMs: number | null): void;
  setIntent(mood: string, energy: string): void;
  reset(): void;
}

export function mountFallbackFace(root: HTMLElement): FallbackFace {
  root.innerHTML = `
    <div class="face-disc">
      <div class="face" id="fb-face">😐</div>
    </div>
    <div class="hud" id="fb-emotion">emotion: neutral</div>
    <div class="hud" id="fb-intent"></div>
    <div class="hud" id="fb-action"></div>
  `;
  const faceEl = root.querySelector<HTMLDivElement>('#fb-face')!;
  const emotionEl = root.querySelector<HTMLDivElement>('#fb-emotion')!;
  const intentEl = root.querySelector<HTMLDivElement>('#fb-intent')!;
  const actionEl = root.querySelector<HTMLDivElement>('#fb-action')!;

  return {
    apply(name) {
      faceEl.textContent = FACE[name] ?? '🙂';
      emotionEl.textContent = `emotion: ${name}`;
      faceEl.classList.add('pop');
      setTimeout(() => faceEl.classList.remove('pop'), 180);
    },
    setAction(name, durationMs) {
      actionEl.textContent = `action: ${name}${durationMs ? ` (${durationMs}ms)` : ''}`;
      setTimeout(() => {
        if (actionEl.textContent?.startsWith(`action: ${name}`)) actionEl.textContent = '';
      }, durationMs ?? 800);
    },
    setIntent(mood, energy) {
      intentEl.textContent = `intent: mood=${mood} energy=${energy}`;
    },
    reset() {
      faceEl.textContent = FACE['neutral']!;
      emotionEl.textContent = 'emotion: neutral';
      intentEl.textContent = '';
      actionEl.textContent = '';
    },
  };
}
```

- [ ] **Step 8: `character/index.html`**（替换占位）

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>DeskSoul · Character</title>
    <style>
      html,
      body {
        margin: 0;
        width: 100%;
        height: 100%;
        background: transparent;
        overflow: hidden;
        user-select: none;
      }
      #stage {
        width: 100%;
        height: 100%;
      }
      #fallback {
        display: none;
        position: absolute;
        inset: 0;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 8px;
        font-family: system-ui, sans-serif;
      }
      #fallback .face-disc {
        width: 160px;
        height: 160px;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.82);
        box-shadow: 0 8px 28px rgba(0, 0, 0, 0.18);
        display: flex;
        align-items: center;
        justify-content: center;
      }
      #fallback .face {
        font-size: 88px;
        transition: transform 0.18s ease;
      }
      #fallback .face.pop {
        transform: scale(1.18);
      }
      #fallback .hud {
        font-family: ui-monospace, monospace;
        font-size: 11px;
        color: #555;
        background: rgba(255, 255, 255, 0.7);
        border-radius: 6px;
        padding: 1px 8px;
        min-height: 1.2em;
      }
    </style>
  </head>
  <body>
    <div id="stage"></div>
    <div id="fallback"></div>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
```

- [ ] **Step 9: `character/main.ts`**（替换占位；行为通道订阅 → 双形态分发）

```ts
// Character renderer — "愚蠢的播放器"：只订阅 behavior.* 并反映之，无业务状态。
// 优先 VRM（S3 形态）；模型缺失/加载失败 → DOM 情绪脸（S4 形态），行为契约不变。
import { createVrmStage, type VrmStage } from './vrm-stage';
import { mountFallbackFace, type FallbackFace } from './fallback-face';
import { setupInteraction } from './interaction';

const MODEL_URL = '/models/sample.vrm';

async function boot(): Promise<void> {
  const stageEl = document.getElementById('stage')!;
  const fallbackEl = document.getElementById('fallback')!;

  let stage: VrmStage | null = null;
  let face: FallbackFace | null = null;
  try {
    stage = await createVrmStage(stageEl, MODEL_URL);
    setupInteraction(stage.renderer);
  } catch (e) {
    console.warn('[character] VRM unavailable, using fallback face:', e);
    fallbackEl.style.display = 'flex';
    face = mountFallbackFace(fallbackEl);
    setupInteraction(null); // DOM 无 alpha buffer：只拖拽，不穿透
  }

  window.desksoul.on('behavior.applyEmotion', (payload) => {
    const { name, weight } = payload as { name: string; weight: number };
    if (stage) stage.applyEmotion(name, weight);
    else face?.apply(name);
  });

  window.desksoul.on('behavior.playAction', (payload) => {
    const { name, durationMs } = payload as { name: string; durationMs: number | null };
    // M1：VRM 动作剪辑池随 M4 落地，先记录；fallback 直接显示
    if (face) face.setAction(name, durationMs);
    else console.log(`[character] action: ${name} (${durationMs ?? '∞'}ms)`);
  });

  window.desksoul.on('behavior.setIntent', (payload) => {
    const { mood, energy } = payload as { mood: string; energy: string };
    if (face) face.setIntent(mood, energy);
    else console.log(`[character] intent: mood=${mood} energy=${energy}`);
  });

  // 回合结束 1.2s 后复位 neutral（S4 行为）
  window.desksoul.on('chat.done', () => {
    setTimeout(() => {
      if (stage) stage.applyEmotion('neutral' as never, 0);
      else face?.reset();
    }, 1200);
  });
}

void boot();
export {};
```

注意：`stage.applyEmotion('neutral', 0)` 中 `neutral` 不在 `EMOTIONS` 表内，`EMOTIONS[name] ?? {}` 兜底为全零目标权重 = 复位，这是有意行为（S3 的 neutral 按钮同语义）。直接传 `('neutral', 0)` 即可，不需要 `as never`——按此写：`stage.applyEmotion('neutral', 0)`。

- [ ] **Step 10: 拷贝本地模型（可选，不进 git）**

```bash
cp apps/spikes/S3-vrm/public/models/sample.vrm apps/desktop/public/models/sample.vrm 2>/dev/null || echo "no local model — fallback face will be used"
```

- [ ] **Step 11: 构建 + typecheck + 测试**

Run: `pnpm --filter @desksoul/desktop build && pnpm --filter @desksoul/desktop typecheck && pnpm --filter @desksoul/desktop test`
Expected: 全 PASS

- [ ] **Step 12: 提交**

```bash
git add apps/desktop/src/renderer/character apps/desktop/test/hysteresis.test.ts
git commit -m "feat(desktop): character renderer — VRM stage + alpha hit-test + drag + fallback face"
```

---

### Task 10: Overlay 聊天 UI（Vue 3）+ Settings 占位

**Files:**
- Replace: `apps/desktop/src/renderer/overlay/index.html`、`main.ts`
- Create: `apps/desktop/src/renderer/overlay/App.vue`
- Replace: `apps/desktop/src/renderer/settings/index.html`、`main.ts`

- [ ] **Step 1: `overlay/index.html`**

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>DeskSoul · Overlay</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
```

- [ ] **Step 2: `overlay/main.ts`**

```ts
import { createApp } from 'vue';
import App from './App.vue';

createApp(App).mount('#app');
```

- [ ] **Step 3: `overlay/App.vue`**（S4 overlay 行为的 Vue 化 + 输入框；设计系统随 M7 引入，此处仅结构正确）

```vue
<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';

const SESSION_ID = 'default';

const bubble = ref('');
const draft = ref('你好呀');
const streaming = ref(false);
const meta = ref('○ idle');
const unsubs: Array<() => void> = [];

onMounted(() => {
  unsubs.push(
    window.desksoul.on('chat.stream', (payload) => {
      const { sessionId, text } = payload as { sessionId: string; text: string };
      if (sessionId !== SESSION_ID) return;
      bubble.value += text;
    }),
    window.desksoul.on('chat.done', (payload) => {
      const { sessionId, finishReason } = payload as { sessionId: string; finishReason: string };
      if (sessionId !== SESSION_ID) return;
      streaming.value = false;
      meta.value = `○ done (${finishReason})`;
    }),
  );
});

onUnmounted(() => {
  for (const u of unsubs) u();
});

async function send(): Promise<void> {
  if (streaming.value) return;
  bubble.value = '';
  streaming.value = true;
  meta.value = '● streaming…';
  try {
    await window.desksoul.rpc('chat.send', { sessionId: SESSION_ID, text: draft.value });
  } catch (e) {
    streaming.value = false;
    meta.value = `✗ ${(e as Error).message}`;
  }
}

function cancel(): void {
  if (!streaming.value) return;
  void window.desksoul.rpc('chat.cancel', { sessionId: SESSION_ID });
  meta.value = '○ cancelling…';
}
</script>

<template>
  <div class="overlay">
    <h2>DeskSoul · 对话（M1 骨架）</h2>
    <div class="bubble">{{ bubble }}<span v-if="streaming" class="caret" /></div>
    <div class="meta">{{ meta }}</div>
    <div class="row">
      <input v-model="draft" :disabled="streaming" @keydown.enter="send" />
      <button class="send" :disabled="streaming" @click="send">发送</button>
      <button :disabled="!streaming" @click="cancel">取消</button>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  display: flex;
  flex-direction: column;
  height: 100vh;
  padding: 16px;
  gap: 12px;
  box-sizing: border-box;
  font-family: system-ui, sans-serif;
  background: #f6f7fb;
  color: #15151a;
}
h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: #5b6472;
}
.bubble {
  flex: 1;
  overflow-y: auto;
  background: #fff;
  border: 1px solid #e3e6ee;
  border-radius: 12px;
  padding: 14px 16px;
  font-size: 15px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
}
.caret {
  display: inline-block;
  width: 7px;
  height: 1.1em;
  margin-left: 1px;
  vertical-align: text-bottom;
  background: #5b8def;
  animation: blink 1s steps(2) infinite;
}
@keyframes blink {
  0%,
  50% {
    opacity: 1;
  }
  50.01%,
  100% {
    opacity: 0;
  }
}
.meta {
  font-family: ui-monospace, monospace;
  font-size: 12px;
  color: #8a93a3;
  min-height: 1.4em;
}
.row {
  display: flex;
  gap: 8px;
}
input {
  flex: 1;
  font-size: 14px;
  padding: 9px 12px;
  border-radius: 8px;
  border: 1px solid #cdd3df;
}
button {
  font-size: 14px;
  padding: 9px 18px;
  border-radius: 8px;
  border: 1px solid #cdd3df;
  background: #fff;
  cursor: pointer;
}
button:disabled {
  opacity: 0.5;
  cursor: default;
}
.send {
  background: #5b8def;
  border-color: #5b8def;
  color: #fff;
}
</style>
```

- [ ] **Step 4: `settings/index.html` + `main.ts`**（占位；Hub Window 随 M7 落地）

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>DeskSoul · Settings</title>
    <style>
      body {
        margin: 0;
        height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: system-ui, sans-serif;
        color: #5b6472;
        background: #f6f7fb;
      }
    </style>
  </head>
  <body>
    <p>Settings（常驻隐藏；Hub Window 随 M7 落地）</p>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
```

```ts
console.log('[settings] placeholder window (hidden by default)');
export {};
```

- [ ] **Step 5: 构建 + typecheck**

Run: `pnpm --filter @desksoul/desktop build && pnpm --filter @desksoul/desktop typecheck`
Expected: PASS（vue-tsc 覆盖 App.vue）

- [ ] **Step 6: 提交**

```bash
git add apps/desktop/src/renderer/overlay apps/desktop/src/renderer/settings
git commit -m "feat(desktop): overlay chat UI (vue) + settings placeholder"
```

---

### Task 11: 全仓验证 + 手动 E2E + RESULTS + 收尾

**Files:**
- Create: `apps/desktop/RESULTS-M1.md`

- [ ] **Step 1: 全仓四连**

```bash
pnpm -r typecheck && pnpm -r lint && pnpm -r test && pnpm --filter @desksoul/desktop build
```

Expected: 全绿（M1 验收"protocol schema 单一真源"由此钉死：任何端删字段，typecheck 即红）。

- [ ] **Step 2: 单一真源破坏性抽查（验收演示，做完还原）**

临时把 `packages/protocol/src/methods.ts` 里 `chat.send` 的 `sessionId` 字段改名为 `sid`，跑 `pnpm -r typecheck`。
Expected: `apps/desktop`（router 处 `p.sessionId`）与 protocol 测试同时编译报错 → 还原改动。把结论记入 RESULTS-M1.md。

- [ ] **Step 3: 启动手动 E2E**

```bash
pnpm --filter @desksoul/desktop dev
```

按下表逐项验证并记入 `apps/desktop/RESULTS-M1.md`：

```markdown
# M1 验收结果（手动 E2E）

环境：Win 11 · Node 22 · Electron 30 · 日期 YYYY-MM-DD

| # | 检查项 | 判据 | 结果 |
| --- | --- | --- | --- |
| 1 | 三窗口启动 | character（右下透明）+ overlay 可见；settings 隐藏不在任务栏 | ☐ |
| 2 | E2E 流式双轨 | overlay 点「发送」→ 文本流式出现；character 表情同步切换（shy→happy），动作/intent 显示 | ☐ |
| 3 | 取消 | 流式中点「取消」→ ≤200ms 停止，meta 显示 done (cancel) | ☐ |
| 4 | 崩溃隔离 · character | 在 character DevTools 跑 `process.crash()`（sandbox:false 窗口可用）或任务管理器杀其渲染进程 → overlay 不受影响；character 自动 reload 并恢复订阅（再次发送仍切表情） | ☐ |
| 5 | 崩溃隔离 · overlay | 杀 overlay 渲染进程 → character 不受影响；overlay reload 后再次发送可用 | ☐ |
| 6 | Worker 崩溃恢复 | 流式中等 done 后（或直接）连续发送多轮 → 无僵死；（已由 provider-host.test 自动化钉死退避/重生语义） | ☐ |
| 7 | sys.ping | overlay DevTools：`await window.desksoul.rpc('sys.ping',{nonce:'x'})` 返回 echoNonce | ☐ |
| 8 | schema 校验 | `await window.desksoul.rpc('chat.send',{wrong:1})` 被拒（-32602 message） | ☐ |
| 9 | （有模型时）VRM 渲染 | sample.vrm 加载、idle 眨眼呼吸、8 情绪平滑过渡 ~400ms | ☐ |
| 10 | （有模型时）alpha 穿透 | 角色外透明区点击落到桌面；角色本体可命中；边缘无抖动 | ☐ |
| 11 | （有模型时）长按拖拽 | 长按 ≥200ms 拖动窗口；短按不拖；拖拽中穿透不切换 | ☐ |
| 12 | （无模型时）fallback | 情绪脸显示并随流切换 emoji；窗口可长按拖拽 | ☐ |
| 13 | 单一真源演示 | methods.ts 改字段名 → desktop typecheck 红（已还原） | ☐ |

备注 / 偏差：
```

- [ ] **Step 4: 提交 RESULTS 并打里程碑 tag**

```bash
git add apps/desktop/RESULTS-M1.md
git commit -m "docs(desktop): M1 manual E2E acceptance results"
git tag mvp/M1-done
```

- [ ] **Step 5: 收尾**：用 `superpowers:finishing-a-development-branch` 完成分支（验证全量测试 → merge `feat/m1-skeleton` → main → push）。

---

## Self-Review 结论

- **验收覆盖**：三窗口 + 崩溃隔离 → Task 8/11；schema 单一真源 → Task 1/2/3/7/11(Step 2)；E2E mock 流式双轨 → Task 5/6/9/10/11。impl-plan M1 的关键文件清单全部出现在任务中（`plugin-host.ts` 在本仓库语境下定名 `provider-host.ts`，S2 通用 request/response 监督已并入；`schemas.ts` 落在 protocol）。
- **类型一致性**：`ChatEvent`/帧类型统一源自 `@desksoul/protocol`（Task 1 定义，Task 3/5/6 消费）；`Notification` 由 conversation-core 导出、ipc-router 消费；`nextIgnore` 签名在 Task 9 的定义与 interaction 调用一致。
- **顺序依赖**：Task 5 依赖 Task 1/3/4（protocol 帧 + sidecar dist + vitest）；Task 7 依赖 Task 2（app.window.*）；Task 9/10 依赖 Task 4 的目录与 Task 8 的窗口。串行执行即满足。
