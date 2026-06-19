# M7b-1 P1 地基 Implementation Plan（PrefsSchema 扩容 + effects 接依赖 + openExternal）

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans（或 subagent-driven-development）逐 task 实现。步骤用 `- [ ]`。

**Goal:** 把 D 系列要用的全部 prefs 键补进单一真源、给"有后端"的开关接通真实 Main 副作用、加 `app.openExternal`——产出可测的后端地基，面板（P2–P4）即可纯前端消费。

**Architecture:** 延续 M7a：扁平 dotted-key `PrefsSchema` 单一真源；`prefs-service.set` 对所有键广播 `app.prefs.changed`（renderer 自响应 theme/lookAt/footGlow，无需 Main effect）；effects 表只装"有 Main 动作"的键（launchAtLogin/alwaysOnTop/clickThrough），由 ipc-router 用 broadcast+characterWindow+setLoginItem 构造，启动 hydrate 还原窗口态。

**Tech Stack:** TS strict、Zod、Electron Main（BrowserWindow/app/shell）、Vitest。

**关联 spec:** `docs/plans/2026-06-17-m7b1-d-series-spec.md`（本计划覆盖其 §7 的 **P1**）。分支 `feat/m7b1-d-series`。

**测试运行：** protocol `pnpm --filter @desksoul/protocol exec vitest run test/<f>.test.ts`；desktop `pnpm --filter @desksoul/desktop exec vitest run test/<f>.test.ts`；全量 `pnpm --filter @desksoul/desktop test`；typecheck `pnpm --filter @desksoul/desktop typecheck`；格式 `pnpm exec prettier --write <files>`。每 task 末提交。

---

## 文件结构
- 改 `packages/protocol/src/prefs.ts`（加键）、`packages/protocol/src/methods.ts`（+`app.openExternal`）
- 新 `apps/desktop/electron/main/app-service.ts`（openExternal handler 工厂）
- 改 `apps/desktop/electron/main/prefs/effects.ts`（deps 化 + 3 effects）
- 改 `apps/desktop/electron/main/ipc-router.ts`（effects 用 deps 构造、spread appService、加 setLoginItem dep）
- 改 `apps/desktop/electron/main/index.ts`（传 setLoginItem + appService；import shell；去掉 createPrefEffects）
- 测试：`packages/protocol/test/prefs.test.ts`(追加)、`apps/desktop/test/app-service.test.ts`(新)、`apps/desktop/test/prefs/effects.test.ts`(改)、`apps/desktop/test/prefs/wiring.test.ts`(改)

---

## Task 1: PrefsSchema 扩容（§7 全量键）

**Files:** Modify `packages/protocol/src/prefs.ts`；Test `packages/protocol/test/prefs.test.ts`

- [ ] **Step 1: 追加失败测试**

```ts
// packages/protocol/test/prefs.test.ts — 追加到末尾
describe('PrefsSchema D-series expansion', () => {
  it('defaults the new D-series keys per §14.1', () => {
    expect(DEFAULT_PREFS['general.hour24']).toBe(true);
    expect(DEFAULT_PREFS['general.startupShow']).toBe('character+tray');
    expect(DEFAULT_PREFS['privacy.contextWindow']).toBe(20);
    expect(DEFAULT_PREFS['privacy.clipboard']).toBe(false);
    expect(DEFAULT_PREFS['model.activeProvider']).toBe('');
    expect(DEFAULT_PREFS['offline.fallbackMode']).toBe('ollama');
    expect(DEFAULT_PREFS['budget.warnAt']).toBe(80);
  });
  it('validates enum + range on new fields', () => {
    expect(PrefsSchema.shape['general.updateChannel'].safeParse('preview').success).toBe(true);
    expect(PrefsSchema.shape['general.updateChannel'].safeParse('nightly').success).toBe(false);
    expect(PrefsSchema.shape['privacy.contextWindow'].safeParse(0).success).toBe(false);
    expect(PrefsSchema.shape['budget.warnAt'].safeParse(150).success).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @desksoul/protocol exec vitest run test/prefs.test.ts`
Expected: FAIL — `DEFAULT_PREFS['general.hour24']` undefined 等。

- [ ] **Step 3: 实现（在 `PrefsSchema` 对象内、`privacy.crashReport` 之后追加这些键）**

```ts
  // general（D2 通用）
  'general.startupShow': z.enum(['character+tray', 'tray', 'none']).default('character+tray'),
  'general.language': z.string().default('zh-CN'),
  'general.timezone': z.string().default('Asia/Shanghai'),
  'general.hour24': z.boolean().default(true),
  'general.autoUpdate': z.boolean().default(true),
  'general.updateChannel': z.enum(['stable', 'preview']).default('stable'),
  'general.desktopNotifications': z.boolean().default(true),
  'general.proactiveSpeech': z.boolean().default(false),
  'general.proactiveFreq': z.number().min(0).max(100).default(30),
  'general.dndStart': z.string().default('23:00'),
  'general.dndEnd': z.string().default('08:00'),
  // display（D4 显示与窗口）
  'display.lookAtStrength': z.number().min(0).max(100).default(50),
  'display.physics': z.boolean().default(true),
  'display.clickThroughBar': z.boolean().default(false),
  'display.wallpaperMode': z.boolean().default(false),
  'display.followDisplay': z.string().default('primary'),
  'display.crossScreenDrag': z.enum(['snap', 'free']).default('snap'),
  'display.fullscreenHide': z.boolean().default(true),
  'display.gameDetect': z.boolean().default(true),
  'display.meetingDowngrade': z.boolean().default(true),
  // privacy（D6 隐私）
  'privacy.masterPassword': z.boolean().default(false),
  'privacy.contentUpload': z.boolean().default(true),
  'privacy.masking': z.boolean().default(true),
  'privacy.contextWindow': z.number().int().min(1).max(200).default(20),
  'privacy.clipboard': z.boolean().default(false),
  'privacy.screenshot': z.boolean().default(false),
  'privacy.camera': z.boolean().default(false),
  'privacy.microphone': z.boolean().default(true),
  'privacy.systemNotify': z.boolean().default(true),
  'privacy.affectionProfile': z.boolean().default(true),
  'privacy.logRetentionDays': z.number().int().min(1).max(90).default(7),
  // model（D3 模型 API）
  'model.activeProvider': z.string().default(''),
  'model.activeModel': z.string().default(''),
  // budget（D3 预算告警；本期仅持久化）
  'budget.enabled': z.boolean().default(false),
  'budget.monthlyCap': z.number().min(0).default(0),
  'budget.warnAt': z.number().min(0).max(100).default(80),
  'budget.onExceed': z.enum(['warn', 'pause']).default('warn'),
  // offline（D3 离线兜底；本期仅持久化）
  'offline.fallbackMode': z.enum(['ollama', 'demo', 'error']).default('ollama'),
  'offline.ollamaModel': z.string().default(''),
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @desksoul/protocol exec vitest run test/prefs.test.ts`
Expected: PASS（原有 + 新增 2 用例）。

- [ ] **Step 5: 提交**

```bash
git add packages/protocol/src/prefs.ts packages/protocol/test/prefs.test.ts
git commit -m "feat(protocol): expand PrefsSchema with D-series keys (general/display/privacy/model/budget/offline)"
```

---

## Task 2: app.openExternal（method + app-service）

**Files:** Modify `packages/protocol/src/methods.ts`；Create `apps/desktop/electron/main/app-service.ts`；Test `apps/desktop/test/app-service.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// apps/desktop/test/app-service.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createAppService } from '../electron/main/app-service';

describe('app-service · openExternal', () => {
  it('opens http(s) urls via the injected opener', async () => {
    const opener = vi.fn();
    const svc = createAppService({ openExternal: opener });
    const r = await svc['app.openExternal']({ url: 'https://desksoul.app' });
    expect(r).toEqual({ ok: true });
    expect(opener).toHaveBeenCalledWith('https://desksoul.app');
  });
  it('refuses non-http(s) schemes with -32602 and does not open', async () => {
    const opener = vi.fn();
    const svc = createAppService({ openExternal: opener });
    await expect(svc['app.openExternal']({ url: 'file:///etc/passwd' })).rejects.toMatchObject({
      code: -32602,
    });
    expect(opener).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @desksoul/desktop exec vitest run test/app-service.test.ts`
Expected: FAIL — cannot find module app-service。

- [ ] **Step 3: 实现**

`methods.ts`：在 `app.exportData` 之后插入：
```ts
  'app.openExternal': {
    params: z.object({ url: z.string().url() }),
    result: z.object({ ok: z.literal(true) }),
  },
```

```ts
// apps/desktop/electron/main/app-service.ts
/**
 * AppService —— app.* 杂项 handler 工厂（M7b1：openExternal）。注入 opener 便于测；
 * 仅放行 http/https（防 file://、命令型 scheme）。由 ipc-router spread 进 router。
 */
import { RpcError } from './router.js';

export interface AppServiceDeps {
  openExternal: (url: string) => void;
}

export function createAppService(deps: AppServiceDeps) {
  return {
    'app.openExternal': async (p: { url: string }) => {
      if (!/^https?:\/\//i.test(p.url)) {
        throw new RpcError(-32602, `refused non-http(s) url: ${p.url}`);
      }
      deps.openExternal(p.url);
      return { ok: true as const };
    },
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @desksoul/desktop exec vitest run test/app-service.test.ts`
Expected: PASS (2)

- [ ] **Step 5: 提交**

```bash
git add packages/protocol/src/methods.ts apps/desktop/electron/main/app-service.ts apps/desktop/test/app-service.test.ts
git commit -m "feat(desktop): app.openExternal RPC (http/https only) + app-service factory"
```

---

## Task 3: effects 接真实依赖（launchAtLogin / alwaysOnTop / clickThrough）

**Files:** Modify `apps/desktop/electron/main/prefs/effects.ts`；Modify `apps/desktop/test/prefs/effects.test.ts`

> theme/lookAt/footGlow 不在此表——它们靠 prefs-service 对所有键的 `app.prefs.changed` 广播由 renderer 自响应。characterScale 入 P2（与 D4 + setScale 收编一起）。

- [ ] **Step 1: 重写 effects.test（先红：断言新表与行为）**

```ts
// apps/desktop/test/prefs/effects.test.ts  — 整体替换
import { describe, it, expect, vi } from 'vitest';
import { createPrefEffects, applyAllEffects } from '../../electron/main/prefs/effects';
import { DEFAULT_PREFS } from '@desksoul/protocol';

function fakeWin() {
  return {
    isDestroyed: () => false,
    setAlwaysOnTop: vi.fn(),
    setIgnoreMouseEvents: vi.fn(),
  };
}

describe('pref effects (D-series, with deps)', () => {
  it('launchAtLogin → setLoginItem', () => {
    const setLoginItem = vi.fn();
    const effects = createPrefEffects({ setLoginItem });
    effects['general.launchAtLogin']!(false);
    expect(setLoginItem).toHaveBeenCalledWith(false);
  });

  it('alwaysOnTop / clickThrough → character window', () => {
    const win = fakeWin();
    const effects = createPrefEffects({ characterWindow: () => win as never });
    effects['display.alwaysOnTop']!(true);
    expect(win.setAlwaysOnTop).toHaveBeenCalledWith(true);
    effects['display.clickThrough']!(true);
    expect(win.setIgnoreMouseEvents).toHaveBeenCalledWith(true, { forward: true });
  });

  it('window effects no-op safely when no character window', () => {
    const effects = createPrefEffects({ characterWindow: () => null });
    expect(() => effects['display.alwaysOnTop']!(true)).not.toThrow();
  });

  it('theme/lookAt/footGlow are NOT in the registry (renderer reacts to broadcast)', () => {
    const effects = createPrefEffects();
    expect(effects['display.theme']).toBeUndefined();
    expect(effects['display.lookAt']).toBeUndefined();
    expect(effects['display.footGlow']).toBeUndefined();
  });

  it('applyAllEffects sweeps current prefs, applying registered keys', () => {
    const win = fakeWin();
    const setLoginItem = vi.fn();
    const effects = createPrefEffects({ characterWindow: () => win as never, setLoginItem });
    applyAllEffects(effects, DEFAULT_PREFS);
    expect(setLoginItem).toHaveBeenCalledWith(DEFAULT_PREFS['general.launchAtLogin']);
    expect(win.setAlwaysOnTop).toHaveBeenCalledWith(DEFAULT_PREFS['display.alwaysOnTop']);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @desksoul/desktop exec vitest run test/prefs/effects.test.ts`
Expected: FAIL — 现 `createPrefEffects` 返回空表，`effects['general.launchAtLogin']` undefined。

- [ ] **Step 3: 实现（替换 effects.ts 的 EffectsDeps + createPrefEffects）**

```ts
// apps/desktop/electron/main/prefs/effects.ts
import type { BrowserWindow } from 'electron';
import type { Prefs, PrefKey } from '@desksoul/protocol';

/**
 * Main 侧副作用表：pref → 系统状态实际作用。set() 时与启动 hydrate 时各跑一遍。
 * 只装"有 Main 动作"的键；theme/lookAt/footGlow 靠 prefs-service 的 app.prefs.changed
 * 广播由 renderer 自响应，不进此表。characterScale 在 P2（与 D4 一起）。
 */
export type PrefEffects = Partial<{ [K in PrefKey]: (value: Prefs[K]) => void }>;

export interface EffectsDeps {
  characterWindow?: () => BrowserWindow | null;
  setLoginItem?: (open: boolean) => void;
  broadcast?: (channel: string, params: unknown) => void;
}

export function createPrefEffects(deps: EffectsDeps = {}): PrefEffects {
  const cw = deps.characterWindow ?? (() => null);
  const setLoginItem = deps.setLoginItem ?? (() => {});
  const win = (): BrowserWindow | null => {
    const w = cw();
    return w && !w.isDestroyed() ? w : null;
  };
  return {
    'general.launchAtLogin': (v) => setLoginItem(v),
    'display.alwaysOnTop': (v) => win()?.setAlwaysOnTop(v),
    'display.clickThrough': (v) => win()?.setIgnoreMouseEvents(v, { forward: true }),
  };
}

/** 按当前 prefs 全量施加已注册副作用（启动 hydrate）。未注册的 key 安全跳过。 */
export function applyAllEffects(effects: PrefEffects, prefs: Prefs): void {
  for (const key of Object.keys(prefs) as PrefKey[]) {
    const fn = effects[key] as ((v: Prefs[PrefKey]) => void) | undefined;
    fn?.(prefs[key]);
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @desksoul/desktop exec vitest run test/prefs/effects.test.ts`
Expected: PASS (5)

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/electron/main/prefs/effects.ts apps/desktop/test/prefs/effects.test.ts
git commit -m "feat(desktop): wire real pref effects (launchAtLogin/alwaysOnTop/clickThrough) via deps"
```

---

## Task 4: 接线 ipc-router + index（effects 用 broadcast 构造 + appService + hydrate）

**Files:** Modify `apps/desktop/electron/main/ipc-router.ts`、`apps/desktop/electron/main/index.ts`；Modify `apps/desktop/test/prefs/wiring.test.ts`

- [ ] **Step 1: 改 wiring.test（先红：effects 经 deps 施加副作用 + openExternal 经 router）**

```ts
// apps/desktop/test/prefs/wiring.test.ts — 整体替换
import { describe, it, expect, vi } from 'vitest';
import { createRouter } from '../../electron/main/router';
import { createPrefsService } from '../../electron/main/prefs-service';
import { createAppService } from '../../electron/main/app-service';
import { MemoryPrefsStore } from '../../electron/main/prefs/memory-store';
import { createPrefEffects } from '../../electron/main/prefs/effects';

describe('prefs + app RPC wired through createRouter', () => {
  it('set with a real effect applies the Main-side action', async () => {
    const store = new MemoryPrefsStore();
    const win = { isDestroyed: () => false, setAlwaysOnTop: vi.fn(), setIgnoreMouseEvents: vi.fn() };
    const effects = createPrefEffects({ characterWindow: () => win as never });
    const router = createRouter<null>({
      ...createPrefsService({ store, broadcast: () => {}, effects }),
    });
    await router.dispatch('app.prefs.set', { key: 'display.alwaysOnTop', value: false }, null);
    expect(store.getAll()['display.alwaysOnTop']).toBe(false);
    expect(win.setAlwaysOnTop).toHaveBeenCalledWith(false);
  });

  it('routes app.openExternal through app-service', async () => {
    const opener = vi.fn();
    const router = createRouter<null>({ ...createAppService({ openExternal: opener }) });
    const r = await router.dispatch('app.openExternal', { url: 'https://x.dev' }, null);
    expect(r).toEqual({ ok: true });
    expect(opener).toHaveBeenCalledWith('https://x.dev');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @desksoul/desktop exec vitest run test/prefs/wiring.test.ts`
Expected: FAIL — `createAppService` 模块不存在前会报 import 错；或 effects 旧空表导致 setAlwaysOnTop 未被调。
（注：T2 已建 app-service，故此处主要红在 effects 行为/Task 自身的 import。先确保红，再做 Step 3 生产接线。）

- [ ] **Step 3a: 改 ipc-router.ts**

import 区把 prefs import 旁加 app-service：
```ts
import { createAppService } from './app-service.js';
```
`IpcRouterDeps` 内：把 `prefEffects?: PrefEffects;` 上方加，并新增两个 dep：
```ts
  /** 开机自启动开关施加器（index 注入 app.setLoginItemSettings）。 */
  setLoginItem?: (open: boolean) => void;
  /** app.* 杂项 handlers（openExternal）；index 注入 shell.openExternal。 */
  appService?: ReturnType<typeof createAppService>;
```
把 L87 effects 构造改为用 deps（broadcast 在本作用域已定义）：
```ts
  const prefEffects =
    deps.prefEffects ??
    createPrefEffects({
      characterWindow: deps.characterWindow,
      setLoginItem: deps.setLoginItem ?? (() => {}),
      broadcast,
    });
```
在 `createRouter({ ... })` 顶部，`...prefsService,` 旁加：
```ts
    ...(deps.appService ?? {}),
```

- [ ] **Step 3b: 改 index.ts**

import：`import { app, screen, protocol, shell } from 'electron';`（加 `shell`）；prefs import 去掉 `createPrefEffects`：
```ts
import { createPrefsStore } from './prefs/index.js';
```
删除 `const prefEffects = createPrefEffects();`（原 L46）。
在 `registerIpcRouter({ ... })` 参数里：删除 `prefEffects,`，新增：
```ts
    setLoginItem: (open) => app.setLoginItemSettings({ openAtLogin: open }),
    appService: createAppService({ openExternal: (url) => shell.openExternal(url) }),
```
并在 index.ts import 区加：`import { createAppService } from './app-service.js';`

- [ ] **Step 4: 跑测试 + 全量回归 + typecheck + 格式**

Run:
```bash
pnpm --filter @desksoul/desktop exec vitest run test/prefs/wiring.test.ts
pnpm --filter @desksoul/protocol test
pnpm --filter @desksoul/desktop test
pnpm --filter @desksoul/desktop typecheck
pnpm exec prettier --write packages/protocol/src/prefs.ts apps/desktop/electron/main/app-service.ts apps/desktop/electron/main/prefs/effects.ts apps/desktop/electron/main/ipc-router.ts apps/desktop/electron/main/index.ts
```
Expected: wiring PASS；protocol/desktop 全量绿（启动 hydrate 现会施加 alwaysOnTop/clickThrough，effects 测 + wiring 测覆盖）；typecheck 干净；prettier 改完无遗留 → 若改动文件，重 add。

- [ ] **Step 5: 提交**

```bash
git add packages/protocol apps/desktop/electron/main/ipc-router.ts apps/desktop/electron/main/index.ts apps/desktop/test/prefs/wiring.test.ts
git commit -m "feat(desktop): construct pref effects with broadcast+window deps; wire setLoginItem + app.openExternal"
```

---

## Self-Review（plan vs spec P1）
- **spec §2.1 schema 扩容**：T1 覆盖全部新 key（general/display/privacy/model/budget/offline）✓。
- **spec §2.2 effects 接依赖**：T3 接 launchAtLogin/alwaysOnTop/clickThrough；theme/lookAt/footGlow 走广播（不进表）已说明；characterScale 显式延 P2 ✓。
- **spec §2.4 app.openExternal**：T2 method+service+http(s) 限制 ✓。
- **接线**：T4 effects 用 broadcast 构造、index 传 setLoginItem/appService、hydrate 沿用既有 applyAllEffects ✓。
- **占位符**：无 TBD；每步含完整代码/命令/预期。
- **类型一致**：`EffectsDeps`(T3) ↔ ipc-router 构造(T4) 字段一致；`createAppService` 返回(T2) ↔ ipc-router spread/ index 注入(T4) 一致；新 key(T1) 被 effects(T3) 引用的 `general.launchAtLogin/display.alwaysOnTop/display.clickThrough` 均属 M7a 既有键（不依赖 T1 新键），T1 与 T3 无顺序耦合 ✓。
- **回归点**：启动 hydrate 现非空——`applyAllEffects` 会在 app 启动对 character 窗口施加 alwaysOnTop(默认true)/clickThrough(默认false)；默认值与 M7a 窗口初始一致（windows.ts 未设 alwaysOnTop=默认 false，但 pref 默认 true → 启动后置顶），属预期行为变化，记入 RESULTS。
