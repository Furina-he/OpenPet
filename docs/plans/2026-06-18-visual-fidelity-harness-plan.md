# 视觉保真 Harness 设计 + 计划（render→screenshot→compare 闭环 / Playwright MCP）

| 版本 | 日期 | 状态 | 关联 |
| --- | --- | --- | --- |
| v0.1 | 2026-06-18 | Approved（用户「这样干吧」） | [[ui-must-match-design-pngs]] · ui-design §2/§4.1/§7 · `docs/status/CURRENT.md` |

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans 逐 task。步骤 `- [ ]`。执行需 **Playwright MCP**（用户环境已具备）。

**Goal:** 给 headless 实现者补上"渲染→截图→对照设计图→迭代"的闭环，使 UI 能高还原 `UI/*.png`。一次投入，吃到 M7b 全部面板 + M8。

**为什么需要它（瓶颈）：** 实现是"盲写"——能写 SFC/跑单测，但看不到渲染结果，只能把"脑内理解"翻成代码，翻译损耗=还原度损耗。token 化（已做）解决"原子级"对齐；本 harness 解决"成屏级"对齐。

**核心思路：** renderer 是 Vue+Tailwind，Hub 是普通不透明窗，**只要 mock 掉 `window.desksoul`（preload 注入的 bridge）就能在纯浏览器渲染** → Playwright MCP 开浏览器到 renderer dev URL → 截图 → 实现者 `Read` 截图 ↔ 设计 PNG 比对 → 改 SFC → 再截 → 收敛 → 人工终审。

---

## 架构 / 文件
- 新 `apps/desktop/src/renderer/dev/mock-bridge.ts` — 内存版 `window.desksoul`（dev/浏览器预览用；真 bridge 在则不装）
- 新 `apps/desktop/src/renderer/dev/route.ts` — 从 URL `?page=` 解析初始路由（截特定页用；纯函数）
- 改 `apps/desktop/src/renderer/settings/main.ts`、`overlay/main.ts` — mount 前 `installMockBridge()`（守卫）
- 改 `apps/desktop/src/renderer/settings/App.vue` — 初始 active 读 `?page=`（dev 便利，prod 无害）
- 测试：`apps/desktop/test/dev/mock-bridge.test.ts`、`apps/desktop/test/dev/route.test.ts`
- 文档：本文件 §「Runbook」即执行者操作手册

> 安全：mock 仅在 `window.desksoul` 缺席时注入（打包/Electron 下 preload 必在 → 不生效）；纯 dev/测试设施，不进生产路径。

---

## Task 1: dev mock-bridge（内存版 window.desksoul）

**Files:** Create `apps/desktop/src/renderer/dev/mock-bridge.ts`；Test `apps/desktop/test/dev/mock-bridge.test.ts`

- [ ] **Step 1: 失败测试**

```ts
// apps/desktop/test/dev/mock-bridge.test.ts
import { describe, it, expect } from 'vitest';
import { createMockBridge } from '../../src/renderer/dev/mock-bridge';

describe('dev mock bridge', () => {
  it('getAll returns default prefs', async () => {
    const b = createMockBridge();
    const prefs = (await b.rpc('app.prefs.getAll', {})) as Record<string, unknown>;
    expect(prefs['display.theme']).toBe('system');
  });
  it('set updates local prefs and emits app.prefs.changed to subscribers', async () => {
    const b = createMockBridge();
    const seen: unknown[] = [];
    b.on('app.prefs.changed', (p) => seen.push(p));
    await b.rpc('app.prefs.set', { key: 'display.theme', value: 'dark' });
    expect(seen).toEqual([{ key: 'display.theme', value: 'dark' }]);
    expect(((await b.rpc('app.prefs.getAll', {})) as Record<string, unknown>)['display.theme']).toBe('dark');
  });
  it('on returns an unsubscribe', async () => {
    const b = createMockBridge();
    const seen: unknown[] = [];
    const off = b.on('app.prefs.changed', (p) => seen.push(p));
    off();
    await b.rpc('app.prefs.set', { key: 'display.theme', value: 'light' });
    expect(seen).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @desksoul/desktop exec vitest run test/dev/mock-bridge.test.ts`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 实现**

```ts
// apps/desktop/src/renderer/dev/mock-bridge.ts
// 仅 dev/浏览器预览：真 preload bridge（window.desksoul）缺席时装内存版，
// 让 renderer 在纯浏览器（Playwright MCP 截图）里可交互渲染，做设计图比对。
// 打包/Electron 下 window.desksoul 存在 → installMockBridge no-op。
import { DEFAULT_PREFS, type Prefs } from '@desksoul/protocol';

type Cb = (payload: unknown) => void;

export interface MockBridge {
  rpc: (method: string, params?: unknown) => Promise<unknown>;
  on: (channel: string, cb: Cb) => () => void;
}

export function createMockBridge(): MockBridge {
  const prefs: Prefs = { ...DEFAULT_PREFS };
  const subs = new Map<string, Set<Cb>>();
  const emit = (channel: string, payload: unknown): void => {
    for (const cb of subs.get(channel) ?? []) cb(payload);
  };
  return {
    rpc: async (method, params) => {
      const p = (params ?? {}) as Record<string, unknown>;
      switch (method) {
        case 'app.prefs.getAll':
          return { ...prefs };
        case 'app.prefs.set':
          (prefs as Record<string, unknown>)[p.key as string] = p.value;
          emit('app.prefs.changed', { key: p.key, value: p.value });
          return { ok: true };
        case 'character.current':
          return { characterId: 'default', manifest: { name: '小灵' } };
        case 'chat.snapshot':
          return { sessionId: p.sessionId ?? 'default', messages: [], streaming: false, seq: 0 };
        default:
          return { ok: true };
      }
    },
    on: (channel, cb) => {
      let set = subs.get(channel);
      if (!set) subs.set(channel, (set = new Set<Cb>()));
      set.add(cb);
      return () => {
        set!.delete(cb);
      };
    },
  };
}

export function installMockBridge(): void {
  if (typeof window === 'undefined') return;
  if ('desksoul' in window) return; // 真 bridge 在 → 不动
  (window as unknown as { desksoul: MockBridge }).desksoul = createMockBridge();
}
```

- [ ] **Step 4: 跑测试确认通过** — `pnpm --filter @desksoul/desktop exec vitest run test/dev/mock-bridge.test.ts` → PASS (3)
- [ ] **Step 5: 提交** — `git commit -m "feat(desktop): dev mock-bridge for in-browser renderer preview (visual harness)"`

---

## Task 2: URL 路由解析 + 注入入口

**Files:** Create `apps/desktop/src/renderer/dev/route.ts`；Modify `settings/main.ts`、`overlay/main.ts`、`settings/App.vue`；Test `apps/desktop/test/dev/route.test.ts`

- [ ] **Step 1: 失败测试**

```ts
// apps/desktop/test/dev/route.test.ts
import { describe, it, expect } from 'vitest';
import { initialRoute } from '../../src/renderer/dev/route';

describe('initialRoute', () => {
  it('reads ?page= when present', () => {
    expect(initialRoute('?page=system.display', 'overview')).toBe('system.display');
  });
  it('falls back to default when absent', () => {
    expect(initialRoute('', 'system.display')).toBe('system.display');
  });
});
```

- [ ] **Step 2: 失败** — `... vitest run test/dev/route.test.ts` → FAIL（模块缺）

- [ ] **Step 3: 实现**

```ts
// apps/desktop/src/renderer/dev/route.ts
/** 从 location.search 取 ?page= 作初始路由（截特定 Hub 页用；prod 无该参数则回退默认）。 */
export function initialRoute(search: string, fallback: string): string {
  return new URLSearchParams(search).get('page') ?? fallback;
}
```

`settings/main.ts` 顶部（在 `subscribeTheme()` 和 `createApp` 之前）：
```ts
import { installMockBridge } from '../dev/mock-bridge';
installMockBridge();
```
`overlay/main.ts` 同样在 mount 前加这两行（让 overlay 也能浏览器预览）。

`settings/App.vue`：把 `const active = ref('system.display');` 改为：
```ts
import { initialRoute } from '../dev/route';
const active = ref(initialRoute(window.location.search, 'system.display'));
```

- [ ] **Step 4: 通过 + typecheck** — `... vitest run test/dev/route.test.ts` PASS；`pnpm --filter @desksoul/desktop typecheck` 干净。
- [ ] **Step 5: 提交** — `git commit -m "feat(desktop): in-browser preview wiring (mock bridge install + ?page= route)"`

---

## Task 3: Runbook —— Playwright MCP 截图比对流程（执行者操作手册）

> 无代码产物；这是每个 UI 阶段做保真闭环的标准动作。验证：能产出截图并与设计 PNG 并排比对。

- [ ] **Step 1: 起 renderer dev server**

`pnpm --filter @desksoul/desktop dev`（electron-vite 会起 renderer 的 Vite dev server）。记下其 URL（形如 `http://localhost:5173`）。Hub 页 = `<URL>/settings/index.html`。

- [ ] **Step 2: Playwright MCP 渲染 + 截图（逐屏）**

对每个要验的页（用 `?page=` 直达）：
1. `browser_navigate` → `<URL>/settings/index.html?page=system.display`（D4；其余：`model`/`system.privacy`/`system.about`/`system.general`）。
2. 设视口（Hub 默认 1080×720，min 880×600）：`browser_resize` → 1080×720。
3. `browser_take_screenshot` → 存 `artifacts/visual/<page>.png`。
4. （主题暗色）`browser_evaluate` 调 `window.desksoul.rpc('app.prefs.set',{key:'display.theme',value:'dark'})` → 再截一张 `<page>-dark.png`（验浅/深双主题）。

- [ ] **Step 3: 比对 + 迭代**

`Read` 渲染截图 + `Read` 对应设计 PNG（D4=`UI/4ba6005f-0abc-45f4-9690-2c5e7af15242.png`，D3=`UI/3c9a77c6-…`，D6=`UI/1d7669e3-…`，D8=`UI/6a38a202-…`；映射见 ui-design §4.1/§7）。逐项列偏差（布局/分组/间距/玻璃/色阶/组件状态）→ 改 SFC（严格用 §2 token）→ 回 Step 2 重截 → 收敛到"够像"。

- [ ] **Step 4: 归档 + 终审**

把"设计 PNG ↔ 渲染截图"并排 + 残留偏差清单写进该阶段 RESULTS。最后人工真机 `dev` 目视签收（兜最后一公里）。

> 注：`artifacts/` 应进 `.gitignore`（截图是过程产物，不入库；RESULTS 里引用/嵌即可）。

---

## Task 4: 验收接法（制度化）

**Files:** Modify `docs/status/CURRENT.md`（已由 PM 维护）；`.gitignore`

- [ ] **Step 1:** `.gitignore` 加 `apps/desktop/artifacts/`（如未忽略）。
- [ ] **Step 2:** 确认 CURRENT.md §5「UI 视觉对齐设计图」已要求每 UI 阶段跑本 Runbook（PM 已写）；本 harness 落地后，**Hub/D4 立即做一轮保真审计**（PM 下一步规划）。
- [ ] **Step 3:** 全量回归 + 提交 — `pnpm --filter @desksoul/desktop test`（mock-bridge/route 新测）+ `typecheck`；`git commit -m "chore(desktop): ignore visual artifacts; wire visual harness into acceptance"`。

---

## Self-Review
- **闭环成立**：mock-bridge(T1) 让浏览器可渲染 → Playwright MCP 截图(T3) → Read 比对 PNG → 迭代。✓
- **交互 demo**：mock 的 set→changed 让主题/缩放在浏览器里当场生效（活 demo，非死图）。✓
- **prod 安全**：installMockBridge 守卫 `'desksoul' in window`；route 读 query 在 prod 无害。✓
- **占位符**：无；T1/T2 含完整代码 + TDD，T3 是可执行 Runbook。
- **范围**：组件画廊页（component gallery）留作可选增强，本期不做（YAGNI；逐屏截图已够）。
- **依赖**：Playwright MCP（用户环境具备）；renderer dev server（electron-vite dev 现成）。
