# M7a 前端地基 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 立起前端地基（Prefs 持久化 + RPC、Tailwind+主题 token、Hub 壳、组件子集），并用"界面主题"walking skeleton 端到端验证"设置即时生效"契约。

**Architecture:** Main 持单写者 `PrefsStore`（`prefs.json` 原子写）；`@desksoul/protocol` 的 Zod `PrefsSchema` 是开关+默认的单一真源；`app.prefs.getAll/set` + `app.prefs.changed` 通知构成"即时生效"契约；renderer 用 Tailwind + CSS 变量做主题，`[data-theme]` 运行时切换。逻辑下沉纯 TS 单测，Vue SFC 只做薄渲染（不引入 @vue/test-utils）。

**Tech Stack:** TypeScript（strict）、Zod、Electron Main、Vue 3 SFC、Tailwind v3 + PostCSS、Vitest、node:fs。

**关联 spec:** `docs/plans/2026-06-17-m7a-foundation-spec.md`

**测试运行约定：**
- protocol：`pnpm --filter @desksoul/protocol exec vitest run test/<f>.test.ts`
- desktop：`pnpm --filter @desksoul/desktop exec vitest run test/<f>.test.ts`
- 全量：`pnpm --filter @desksoul/desktop test` / `pnpm --filter @desksoul/protocol test`
- typecheck：`pnpm --filter @desksoul/desktop typecheck`；格式：`pnpm exec prettier --write <files>`
- 分支：`feat/m7a-foundation`（已建，含 spec 提交）。每 Task 末提交（Conventional Commits）。

---

## 文件结构（先定边界）

**protocol（新增/改）**
- `packages/protocol/src/prefs.ts` — `PrefsSchema`/`Prefs`/`PrefKey`/`DEFAULT_PREFS`（单一真源）
- `packages/protocol/src/index.ts` — 加 `export * from './prefs.js'`
- `packages/protocol/src/methods.ts` — 加 `app.prefs.getAll/set/changed`

**Main（新增/改）**
- `apps/desktop/electron/main/prefs/store.ts` — `PrefsStore` 接口
- `apps/desktop/electron/main/prefs/memory-store.ts` — `MemoryPrefsStore`（测试/降级）
- `apps/desktop/electron/main/prefs/json-store.ts` — `JsonPrefsStore`（原子写 + 坏文件降级）
- `apps/desktop/electron/main/prefs/index.ts` — `createPrefsStore` 工厂 + re-export
- `apps/desktop/electron/main/prefs/effects.ts` — effects registry（M7a 空 seam）
- `apps/desktop/electron/main/prefs-service.ts` — `app.prefs.*` handler 工厂
- `apps/desktop/electron/main/ipc-router.ts` — 构造 prefs-service、spread、dispose（改）
- `apps/desktop/electron/main/index.ts` — 构造 PrefsStore/effects 注入、prefs.json 路径（改）

**Renderer（新增/改）**
- `apps/desktop/tailwind.config.js` / `apps/desktop/postcss.config.js`（新增）
- `apps/desktop/package.json` — tailwindcss/postcss/autoprefixer devDeps（改）
- `apps/desktop/src/renderer/theme/tokens.css` — @tailwind + CSS 变量（浅/深）
- `apps/desktop/src/renderer/theme/theme-resolver.ts` — 纯 TS：pref+系统 → 具体主题；applyTheme/watchSystem
- `apps/desktop/src/renderer/components/{GlassPanel,Button,Switch,Select,Input,Slider,SettingCard,ToastHost}.vue`
- `apps/desktop/src/renderer/components/toast-queue.ts` — 纯 TS toast 队列逻辑
- `apps/desktop/src/renderer/settings/{index.html(改),main.ts(改),App.vue(新),nav-tree.ts(新),pages/*}`
- `apps/desktop/src/renderer/overlay/main.ts` + `character/main.ts` — 订阅 app.prefs.changed 应用主题（改）

**收尾**
- `apps/desktop/RESULTS-M7a.md`、`CLAUDE.md` 状态行

---

# Phase A · Prefs 后端（protocol + Main）

## Task 1: PrefsSchema（protocol 单一真源）

**Files:**
- Create: `packages/protocol/src/prefs.ts`
- Modify: `packages/protocol/src/index.ts`
- Test: `packages/protocol/test/prefs.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// packages/protocol/test/prefs.test.ts
import { describe, it, expect } from 'vitest';
import { PrefsSchema, DEFAULT_PREFS } from '../src/prefs.js';

describe('PrefsSchema', () => {
  it('fills every key from defaults when parsing {}', () => {
    expect(DEFAULT_PREFS['display.theme']).toBe('system');
    expect(DEFAULT_PREFS['display.alwaysOnTop']).toBe(true);
    expect(DEFAULT_PREFS['display.characterScale']).toBe(1);
    expect(DEFAULT_PREFS['general.launchAtLogin']).toBe(true);
  });

  it('exposes per-field schemas via .shape for single-key validation', () => {
    expect(PrefsSchema.shape['display.theme'].safeParse('dark').success).toBe(true);
    expect(PrefsSchema.shape['display.theme'].safeParse('neon').success).toBe(false);
    expect(PrefsSchema.shape['display.characterScale'].safeParse(3).success).toBe(false);
  });

  it('strips unknown keys instead of throwing', () => {
    const parsed = PrefsSchema.parse({ 'bogus.key': 1, 'display.theme': 'light' });
    expect('bogus.key' in parsed).toBe(false);
    expect(parsed['display.theme']).toBe('light');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @desksoul/protocol exec vitest run test/prefs.test.ts`
Expected: FAIL — `Cannot find module '../src/prefs.js'`

- [ ] **Step 3: 写实现**

```ts
// packages/protocol/src/prefs.ts
import { z } from 'zod';

/** 界面主题（walking skeleton 用）；'system' 未指明时降级浅色（ui-design §2.2）。 */
export const ThemeSchema = z.enum(['system', 'light', 'dark']);
export type ThemePref = z.infer<typeof ThemeSchema>;

/**
 * 全量 prefs 单一真源（ui-design §14.1）。扁平 dotted key 便于 set(key,value) 单点校验：
 *   PrefsSchema.shape['display.theme'].safeParse(value)
 * M7a 定义全量 key + 默认，但只接通 display.theme 的端到端；其余副作用/UI 留 M7b。
 */
export const PrefsSchema = z.object({
  'general.launchAtLogin': z.boolean().default(true),
  'general.developerMode': z.boolean().default(false),
  'general.agentThinkingDisplay': z.enum(['full', 'tools', 'hidden']).default('full'),
  'display.theme': ThemeSchema.default('system'),
  'display.alwaysOnTop': z.boolean().default(true),
  'display.clickThrough': z.boolean().default(false),
  'display.lookAt': z.boolean().default(true),
  'display.footGlow': z.boolean().default(false),
  'display.characterScale': z.number().min(0.5).max(2).default(1),
  'privacy.longTermMemory': z.boolean().default(true),
  'privacy.anonymousStats': z.boolean().default(false),
  'privacy.crashReport': z.boolean().default(true),
});

export type Prefs = z.infer<typeof PrefsSchema>;
export type PrefKey = keyof Prefs;
export const DEFAULT_PREFS: Prefs = PrefsSchema.parse({});
```

```ts
// packages/protocol/src/index.ts  — 在文件末尾追加一行
export * from './prefs.js';
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @desksoul/protocol exec vitest run test/prefs.test.ts`
Expected: PASS (3)

- [ ] **Step 5: 提交**

```bash
git add packages/protocol/src/prefs.ts packages/protocol/src/index.ts packages/protocol/test/prefs.test.ts
git commit -m "feat(protocol): PrefsSchema single-source-of-truth (§14.1 keys + defaults)"
```

---

## Task 2: 注册 app.prefs.* RPC（methods.ts）

**Files:**
- Modify: `packages/protocol/src/methods.ts`
- Test: `packages/protocol/test/methods.test.ts`（追加用例）

- [ ] **Step 1: 写失败测试（追加到 methods.test.ts 末尾）**

```ts
// packages/protocol/test/methods.test.ts — 追加
import { Methods } from '../src/methods.js';

describe('app.prefs.* methods', () => {
  it('registers getAll/set/changed', () => {
    expect(Methods['app.prefs.getAll']).toBeDefined();
    expect(Methods['app.prefs.set'].params.safeParse({ key: 'display.theme', value: 'dark' }).success).toBe(true);
    expect(Methods['app.prefs.set'].params.safeParse({ key: 'display.theme' }).success).toBe(false);
    expect(Methods['app.prefs.changed'].params.safeParse({ key: 'display.theme', value: 'dark' }).success).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @desksoul/protocol exec vitest run test/methods.test.ts`
Expected: FAIL — `Cannot read properties of undefined (reading 'params')` on `Methods['app.prefs.set']`

- [ ] **Step 3: 写实现（methods.ts）**

在 `methods.ts` 顶部 import 区追加：
```ts
import { PrefsSchema } from './prefs.js';
```
在 `Methods` 对象内（`app.exportData` 之后、`character.current` 之前）插入：
```ts
  // --- request/response: Renderer → Main（应用偏好，M7a；UI 在 D 系列）---
  'app.prefs.getAll': {
    params: z.object({}),
    result: PrefsSchema,
  },
  'app.prefs.set': {
    // value 的深校验在 prefs-service 按 key 对应字段做（命中非法 → -32602）。
    params: z.object({ key: z.string().min(1), value: z.unknown() }),
    result: z.object({ ok: z.literal(true) }),
  },
  // --- notification: Main → 所有 renderer（某 pref 变更，驱动即时生效）---
  'app.prefs.changed': {
    params: z.object({ key: z.string().min(1), value: z.unknown() }),
    result: z.null(),
  },
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @desksoul/protocol exec vitest run test/methods.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/protocol/src/methods.ts packages/protocol/test/methods.test.ts
git commit -m "feat(protocol): register app.prefs.getAll/set/changed methods"
```

---

## Task 3: PrefsStore 接口 + MemoryPrefsStore

**Files:**
- Create: `apps/desktop/electron/main/prefs/store.ts`
- Create: `apps/desktop/electron/main/prefs/memory-store.ts`
- Test: `apps/desktop/test/prefs/memory-store.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// apps/desktop/test/prefs/memory-store.test.ts
import { describe, it, expect } from 'vitest';
import { MemoryPrefsStore } from '../../electron/main/prefs/memory-store';

describe('MemoryPrefsStore', () => {
  it('returns defaults when constructed empty', () => {
    const s = new MemoryPrefsStore();
    expect(s.getAll()['display.theme']).toBe('system');
  });

  it('overrides a single key on set, leaving others at default', () => {
    const s = new MemoryPrefsStore();
    s.set('display.theme', 'dark');
    expect(s.getAll()['display.theme']).toBe('dark');
    expect(s.getAll()['display.alwaysOnTop']).toBe(true);
  });

  it('seeds from a partial initial object', () => {
    const s = new MemoryPrefsStore({ 'display.theme': 'light' });
    expect(s.getAll()['display.theme']).toBe('light');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @desksoul/desktop exec vitest run test/prefs/memory-store.test.ts`
Expected: FAIL — cannot find module memory-store

- [ ] **Step 3: 写实现**

```ts
// apps/desktop/electron/main/prefs/store.ts
import type { Prefs, PrefKey } from '@desksoul/protocol';

/**
 * PrefsStore — 应用偏好持久化（tech-design §6 prefs.json）。单写者归 Main。
 * 两个实现：JsonPrefsStore（生产，原子写）/ MemoryPrefsStore（单测 + 降级）。
 * 与 ConversationStore 同构的接口化 + DI。
 */
export interface PrefsStore {
  getAll(): Prefs;
  set<K extends PrefKey>(key: K, value: Prefs[K]): void;
  close(): void;
}
```

```ts
// apps/desktop/electron/main/prefs/memory-store.ts
import { PrefsSchema, type Prefs, type PrefKey } from '@desksoul/protocol';
import type { PrefsStore } from './store.js';

/** 纯内存 PrefsStore：单测真源 / JsonPrefsStore 不可用时降级。 */
export class MemoryPrefsStore implements PrefsStore {
  private prefs: Prefs;
  constructor(initial: Partial<Prefs> = {}) {
    this.prefs = PrefsSchema.parse(initial);
  }
  getAll(): Prefs {
    return { ...this.prefs };
  }
  set<K extends PrefKey>(key: K, value: Prefs[K]): void {
    this.prefs = { ...this.prefs, [key]: value };
  }
  close(): void {
    /* no-op */
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @desksoul/desktop exec vitest run test/prefs/memory-store.test.ts`
Expected: PASS (3)

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/electron/main/prefs/store.ts apps/desktop/electron/main/prefs/memory-store.ts apps/desktop/test/prefs/memory-store.test.ts
git commit -m "feat(desktop): PrefsStore interface + MemoryPrefsStore"
```

---

## Task 4: JsonPrefsStore（原子写 + 坏文件降级）

**Files:**
- Create: `apps/desktop/electron/main/prefs/json-store.ts`
- Test: `apps/desktop/test/prefs/json-store.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// apps/desktop/test/prefs/json-store.test.ts
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { JsonPrefsStore } from '../../electron/main/prefs/json-store';

let dir: string | null = null;
function tmpFile(): string {
  dir = mkdtempSync(path.join(tmpdir(), 'ds-prefs-'));
  return path.join(dir, 'prefs.json');
}
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

describe('JsonPrefsStore', () => {
  it('returns defaults when the file does not exist', () => {
    const s = new JsonPrefsStore(tmpFile());
    expect(s.getAll()['display.theme']).toBe('system');
  });

  it('persists a set atomically and survives reopen', () => {
    const file = tmpFile();
    const s = new JsonPrefsStore(file);
    s.set('display.theme', 'dark');
    expect(existsSync(file)).toBe(true);
    expect(JSON.parse(readFileSync(file, 'utf8'))['display.theme']).toBe('dark');
    const reborn = new JsonPrefsStore(file);
    expect(reborn.getAll()['display.theme']).toBe('dark');
  });

  it('falls back to defaults on a corrupt file (no throw)', () => {
    const file = tmpFile();
    writeFileSync(file, '{ this is not json', 'utf8');
    const s = new JsonPrefsStore(file);
    expect(s.getAll()['display.theme']).toBe('system');
  });

  it('back-fills missing keys from defaults for a partial file', () => {
    const file = tmpFile();
    writeFileSync(file, JSON.stringify({ 'display.theme': 'light' }), 'utf8');
    const s = new JsonPrefsStore(file);
    expect(s.getAll()['display.theme']).toBe('light');
    expect(s.getAll()['display.alwaysOnTop']).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @desksoul/desktop exec vitest run test/prefs/json-store.test.ts`
Expected: FAIL — cannot find module json-store

- [ ] **Step 3: 写实现**

```ts
// apps/desktop/electron/main/prefs/json-store.ts
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { PrefsSchema, DEFAULT_PREFS, type Prefs, type PrefKey } from '@desksoul/protocol';
import type { PrefsStore } from './store.js';

/**
 * 生产 PrefsStore：prefs.json 原子写（写 .tmp 再 rename）。
 * 读时用 PrefsSchema 解析：缺失 key 由默认回填；坏 JSON / 校验失败 → 全量默认（不崩）。
 */
export class JsonPrefsStore implements PrefsStore {
  private prefs: Prefs;
  constructor(private readonly filePath: string) {
    this.prefs = this.load();
  }
  private load(): Prefs {
    try {
      const parsed = PrefsSchema.safeParse(JSON.parse(readFileSync(this.filePath, 'utf8')));
      return parsed.success ? parsed.data : { ...DEFAULT_PREFS };
    } catch {
      return { ...DEFAULT_PREFS };
    }
  }
  getAll(): Prefs {
    return { ...this.prefs };
  }
  set<K extends PrefKey>(key: K, value: Prefs[K]): void {
    this.prefs = { ...this.prefs, [key]: value };
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.prefs, null, 2), 'utf8');
    renameSync(tmp, this.filePath);
  }
  close(): void {
    /* no-op */
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @desksoul/desktop exec vitest run test/prefs/json-store.test.ts`
Expected: PASS (4)

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/electron/main/prefs/json-store.ts apps/desktop/test/prefs/json-store.test.ts
git commit -m "feat(desktop): JsonPrefsStore (atomic write + corrupt-file fallback)"
```

---

## Task 5: createPrefsStore 工厂 + effects registry

**Files:**
- Create: `apps/desktop/electron/main/prefs/index.ts`
- Create: `apps/desktop/electron/main/prefs/effects.ts`
- Test: `apps/desktop/test/prefs/effects.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// apps/desktop/test/prefs/effects.test.ts
import { describe, it, expect } from 'vitest';
import { createPrefEffects, applyAllEffects } from '../../electron/main/prefs/effects';
import { DEFAULT_PREFS } from '@desksoul/protocol';

describe('pref effects registry', () => {
  it('M7a registry has no Main-side effects (theme reaches renderers via broadcast)', () => {
    const effects = createPrefEffects();
    expect(effects['display.theme']).toBeUndefined();
  });

  it('applyAllEffects is a no-op-safe sweep over current prefs', () => {
    const calls: string[] = [];
    // 注入一个临时 effect 验证 sweep 会按 key 调用
    const effects = { 'display.alwaysOnTop': () => calls.push('aot') } as ReturnType<typeof createPrefEffects>;
    applyAllEffects(effects, DEFAULT_PREFS);
    expect(calls).toEqual(['aot']); // 仅注册了的 key 被调用，其余无副作用
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @desksoul/desktop exec vitest run test/prefs/effects.test.ts`
Expected: FAIL — cannot find module effects

- [ ] **Step 3: 写实现**

```ts
// apps/desktop/electron/main/prefs/effects.ts
import type { Prefs, PrefKey } from '@desksoul/protocol';

/**
 * Main 侧副作用表：pref → 对系统状态的实际作用（如 alwaysOnTop → 窗口 setAlwaysOnTop）。
 * set() 时与启动 hydrate 时各跑一遍，维持"单写者施加副作用"。
 *
 * M7a：界面主题靠 app.prefs.changed 广播让 renderer 自行换肤，无需 Main 副作用，故表为空。
 * 这是给 M7b 的 seam（alwaysOnTop / clickThrough / characterScale / lookAt 在 M7b 注册）。
 */
export type PrefEffects = Partial<{ [K in PrefKey]: (value: Prefs[K]) => void }>;

export interface EffectsDeps {
  // M7b 注入：characterWindow()、broadcast 等。M7a 暂无依赖。
}

export function createPrefEffects(_deps: EffectsDeps = {}): PrefEffects {
  return {};
}

/** 按当前 prefs 全量施加已注册的副作用（启动 hydrate）。未注册的 key 安全跳过。 */
export function applyAllEffects(effects: PrefEffects, prefs: Prefs): void {
  for (const key of Object.keys(prefs) as PrefKey[]) {
    const fn = effects[key] as ((v: Prefs[PrefKey]) => void) | undefined;
    fn?.(prefs[key]);
  }
}
```

```ts
// apps/desktop/electron/main/prefs/index.ts
import type { PrefsStore } from './store.js';
import { MemoryPrefsStore } from './memory-store.js';
import { JsonPrefsStore } from './json-store.js';

export type { PrefsStore } from './store.js';
export { MemoryPrefsStore } from './memory-store.js';
export { JsonPrefsStore } from './json-store.js';
export { createPrefEffects, applyAllEffects, type PrefEffects } from './effects.js';

export interface CreatePrefsStoreOptions {
  /** 给路径 → JsonPrefsStore；构造失败降级 MemoryPrefsStore。缺省纯内存（测试）。 */
  prefsPath?: string;
}

export function createPrefsStore(opts: CreatePrefsStoreOptions = {}): PrefsStore {
  if (!opts.prefsPath) return new MemoryPrefsStore();
  try {
    return new JsonPrefsStore(opts.prefsPath);
  } catch (e) {
    console.warn('[prefs] JsonPrefsStore unavailable, falling back to in-memory:', e);
    return new MemoryPrefsStore();
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @desksoul/desktop exec vitest run test/prefs/effects.test.ts`
Expected: PASS (2)

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/electron/main/prefs/index.ts apps/desktop/electron/main/prefs/effects.ts apps/desktop/test/prefs/effects.test.ts
git commit -m "feat(desktop): createPrefsStore factory + (empty) pref effects seam"
```

---

## Task 6: prefs-service（app.prefs.* handler 工厂）

**Files:**
- Create: `apps/desktop/electron/main/prefs-service.ts`
- Test: `apps/desktop/test/prefs-service.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// apps/desktop/test/prefs-service.test.ts
import { describe, it, expect } from 'vitest';
import { createPrefsService } from '../electron/main/prefs-service';
import { MemoryPrefsStore } from '../electron/main/prefs/memory-store';
import { createPrefEffects } from '../electron/main/prefs/effects';

function make() {
  const store = new MemoryPrefsStore();
  const sent: Array<{ channel: string; params: any }> = [];
  const svc = createPrefsService({
    store,
    broadcast: (channel, params) => sent.push({ channel, params }),
    effects: createPrefEffects(),
  });
  return { store, sent, svc };
}

describe('prefs-service', () => {
  it('getAll returns the full prefs object', async () => {
    const { svc } = make();
    const all = await svc['app.prefs.getAll']({});
    expect(all['display.theme']).toBe('system');
  });

  it('set persists, then broadcasts app.prefs.changed with the parsed value', async () => {
    const { store, sent, svc } = make();
    const r = await svc['app.prefs.set']({ key: 'display.theme', value: 'dark' });
    expect(r).toEqual({ ok: true });
    expect(store.getAll()['display.theme']).toBe('dark');
    expect(sent).toContainEqual({
      channel: 'app.prefs.changed',
      params: { key: 'display.theme', value: 'dark' },
    });
  });

  it('rejects an unknown key with -32602', async () => {
    const { svc } = make();
    await expect(svc['app.prefs.set']({ key: 'bogus.key', value: 1 })).rejects.toMatchObject({
      code: -32602,
    });
  });

  it('rejects an invalid value with -32602 and does not persist', async () => {
    const { store, svc } = make();
    await expect(
      svc['app.prefs.set']({ key: 'display.theme', value: 'neon' }),
    ).rejects.toMatchObject({ code: -32602 });
    expect(store.getAll()['display.theme']).toBe('system');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @desksoul/desktop exec vitest run test/prefs-service.test.ts`
Expected: FAIL — cannot find module prefs-service

- [ ] **Step 3: 写实现**

```ts
// apps/desktop/electron/main/prefs-service.ts
/**
 * PrefsService —— app.prefs.* handler 工厂（getAll/set）。纯函数集合，注入
 * PrefsStore + broadcast + effects；由 ipc-router spread 进 createRouter（仿 provider-service）。
 *
 * set 契约（"即时生效"）：按 key 对应字段深校验 → 落盘 → 广播 app.prefs.changed
 *（renderer 据此换肤等）→ 施加 Main 侧副作用（M7a 为空）。
 */
import { PrefsSchema, type PrefKey } from '@desksoul/protocol';
import type { ZodTypeAny } from 'zod';
import type { PrefsStore } from './prefs/store.js';
import type { PrefEffects } from './prefs/effects.js';
import { RpcError } from './router.js';

export interface PrefsServiceDeps {
  store: PrefsStore;
  broadcast: (channel: string, params: unknown) => void;
  effects: PrefEffects;
}

export function createPrefsService(deps: PrefsServiceDeps) {
  const shape = PrefsSchema.shape as Record<string, ZodTypeAny>;
  return {
    'app.prefs.getAll': async (_p: Record<string, never>) => deps.store.getAll(),
    'app.prefs.set': async (p: { key: string; value: unknown }) => {
      const field = shape[p.key];
      if (!field) throw new RpcError(-32602, `unknown pref key: ${p.key}`);
      const parsed = field.safeParse(p.value);
      if (!parsed.success) {
        throw new RpcError(-32602, `invalid value for ${p.key}: ${parsed.error.message}`);
      }
      const key = p.key as PrefKey;
      deps.store.set(key, parsed.data as never);
      deps.broadcast('app.prefs.changed', { key: p.key, value: parsed.data });
      (deps.effects[key] as ((v: unknown) => void) | undefined)?.(parsed.data);
      return { ok: true as const };
    },
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @desksoul/desktop exec vitest run test/prefs-service.test.ts`
Expected: PASS (4)

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/electron/main/prefs-service.ts apps/desktop/test/prefs-service.test.ts
git commit -m "feat(desktop): prefs-service (app.prefs.getAll/set + changed broadcast)"
```

---

## Task 7: 接线 ipc-router + index（构造 + spread + dispose + hydrate）

**Files:**
- Modify: `apps/desktop/electron/main/ipc-router.ts`
- Modify: `apps/desktop/electron/main/index.ts`
- Test: `apps/desktop/test/prefs/wiring.test.ts`

- [ ] **Step 1: 写失败测试（验证 router 经 prefs-service 分发，且 dispose 关 store）**

```ts
// apps/desktop/test/prefs/wiring.test.ts
import { describe, it, expect } from 'vitest';
import { createRouter } from '../../electron/main/router';
import { createPrefsService } from '../../electron/main/prefs-service';
import { MemoryPrefsStore } from '../../electron/main/prefs/memory-store';
import { createPrefEffects } from '../../electron/main/prefs/effects';

describe('prefs RPC wired through createRouter', () => {
  it('dispatches app.prefs.set with Zod-validated params then broadcasts', async () => {
    const store = new MemoryPrefsStore();
    const sent: Array<{ channel: string; params: any }> = [];
    const router = createRouter<null>({
      ...createPrefsService({
        store,
        broadcast: (channel, params) => sent.push({ channel, params }),
        effects: createPrefEffects(),
      }),
    });
    const r = await router.dispatch('app.prefs.set', { key: 'display.theme', value: 'dark' }, null);
    expect(r).toEqual({ ok: true });
    expect(store.getAll()['display.theme']).toBe('dark');
    expect(sent[0]).toMatchObject({ channel: 'app.prefs.changed' });
  });

  it('router rejects malformed params before reaching the service (-32602)', async () => {
    const router = createRouter<null>({
      ...createPrefsService({
        store: new MemoryPrefsStore(),
        broadcast: () => {},
        effects: createPrefEffects(),
      }),
    });
    // 缺 value → params schema 违约
    await expect(router.dispatch('app.prefs.set', { key: 'display.theme' }, null)).rejects.toMatchObject({
      code: -32602,
    });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @desksoul/desktop exec vitest run test/prefs/wiring.test.ts`
Expected: FAIL — `createPrefsService` 已存在但 router 泛型/spread 尚未在生产 ipc-router 接线时，本测试已可过；若 import 路径错误则报错。
（注：本测试独立验证 spread 语义；下一步把同样的 spread 落进生产 ipc-router。）

> 说明：本 Task 的"生产接线"无独立单元断言（属集成），靠 Step 4 的全量回归 + 手动冒烟保证。Step 1 测试钉死 prefs-service 经 createRouter 的分发契约。

- [ ] **Step 3: 写实现 —— ipc-router.ts**

在 import 区追加：
```ts
import { createPrefsService } from './prefs-service.js';
import { type PrefsStore, type PrefEffects, applyAllEffects } from './prefs/index.js';
```
在 `IpcRouterDeps` 接口内追加：
```ts
  /** 应用偏好持久化（M7a）；index.ts 注入 JsonPrefsStore。缺省纯内存（测试）。 */
  prefsStore?: PrefsStore;
  /** pref 副作用表（M7a 空 seam）。 */
  prefEffects?: PrefEffects;
```
在 `registerIpcRouter` 内、`createRouter` 调用之前构造（紧跟 `const idleResponder = ...` 之后）：
```ts
  const prefsStore = deps.prefsStore ?? createPrefsStore({});
  const prefEffects = deps.prefEffects ?? createPrefEffects();
  // 启动 hydrate：按当前 prefs 施加 Main 侧副作用（M7a 为空 sweep）。
  applyAllEffects(prefEffects, prefsStore.getAll());
  const prefsService = createPrefsService({ store: prefsStore, broadcast, effects: prefEffects });
```
（同时在 import 区把 `createConversationStore` 那行旁补 `import { createPrefsStore, createPrefEffects } from './prefs/index.js';` —— 合并进上面的 prefs import：）
```ts
import {
  createPrefsStore,
  createPrefEffects,
  applyAllEffects,
  type PrefsStore,
  type PrefEffects,
} from './prefs/index.js';
import { createPrefsService } from './prefs-service.js';
```
在 `createRouter({ ... })` 的对象里，把 prefs handlers spread 进去（与 `...(deps.providerService ?? {})` 并列）：
```ts
    ...prefsService,
```
在 `dispose` 内、`store.close();` 旁追加：
```ts
      prefsStore.close();
```

- [ ] **Step 3b: 写实现 —— index.ts**

在 import 区追加：
```ts
import { createPrefsStore, createPrefEffects } from './prefs/index.js';
```
在 `const dataDir = ...; mkdirSync(...)` 之后、`router = registerIpcRouter({...})` 之前：
```ts
  const prefsStore = createPrefsStore({ prefsPath: path.join(dataDir, 'prefs.json') });
  const prefEffects = createPrefEffects();
```
在 `registerIpcRouter({...})` 的参数对象里追加：
```ts
    prefsStore,
    prefEffects,
```

- [ ] **Step 4: 跑测试 + 全量回归 + typecheck**

Run:
```bash
pnpm --filter @desksoul/desktop exec vitest run test/prefs/wiring.test.ts
pnpm --filter @desksoul/desktop test
pnpm --filter @desksoul/desktop typecheck
```
Expected: prefs/wiring PASS；全量 = 旧 226 + 新增 prefs 用例全绿；typecheck 干净。

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/electron/main/ipc-router.ts apps/desktop/electron/main/index.ts apps/desktop/test/prefs/wiring.test.ts
git commit -m "feat(desktop): wire PrefsStore + prefs-service into Main (userData/data/prefs.json)"
```

---

# Phase B · Renderer 主题地基

## Task 8: Tailwind + PostCSS + tokens.css

**Files:**
- Modify: `apps/desktop/package.json`（devDeps）
- Create: `apps/desktop/tailwind.config.js`
- Create: `apps/desktop/postcss.config.js`
- Create: `apps/desktop/src/renderer/theme/tokens.css`

> 无单元测试（构建配置）；由 Task 13 的 dev/build 冒烟验证 Tailwind 编译。

- [ ] **Step 1: 安装依赖（镜像见 [[Windows 开发环境网络约束]]）**

Run:
```bash
pnpm --filter @desksoul/desktop add -D tailwindcss@^3.4 postcss@^8.4 autoprefixer@^10.4
```
Expected: 三个 devDeps 写入 `apps/desktop/package.json`。

- [ ] **Step 2: 写配置（ESM，因 package "type":"module"）**

```js
// apps/desktop/postcss.config.js
export default {
  plugins: { tailwindcss: {}, autoprefixer: {} },
};
```

```js
// apps/desktop/tailwind.config.js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/**/*.{vue,ts,html}'],
  theme: {
    extend: {
      colors: {
        'glass-bg': 'var(--ds-glass-bg)',
        'glass-border': 'var(--ds-glass-border)',
        'text-main': 'var(--ds-text-main)',
        'text-sub': 'var(--ds-text-sub)',
        'brand-from': 'var(--ds-brand-from)',
        'brand-to': 'var(--ds-brand-to)',
        cool: 'var(--ds-cool)',
        success: 'var(--ds-success)',
        warning: 'var(--ds-warning)',
        danger: 'var(--ds-danger)',
      },
      borderRadius: { btn: '8px', input: '10px', card: '12px', panel: '16px', bubble: '18px' },
      spacing: { 1: '4px', 2: '8px', 3: '12px', 4: '16px', 6: '24px', 8: '32px', 12: '48px' },
      fontSize: {
        xs: '12px', sm: '13px', base: '14px', md: '16px', lg: '20px', xl: '28px', '2xl': '36px',
      },
      transitionTimingFunction: { ds: 'cubic-bezier(0.22, 1, 0.36, 1)' },
      backdropBlur: { glass: '28px' },
    },
  },
  plugins: [],
};
```

```css
/* apps/desktop/src/renderer/theme/tokens.css — ui-design §2 token，浅色默认 + 深色覆盖 */
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --ds-glass-bg: rgba(255, 255, 255, 0.72);
  --ds-glass-border: rgba(0, 0, 0, 0.06);
  --ds-text-main: #171821;
  --ds-text-sub: rgba(23, 24, 33, 0.55);
  --ds-brand-from: #ffb4a2;
  --ds-brand-to: #ff8fab;
  --ds-cool: #6fa8ff;
  --ds-success: #7fe3a1;
  --ds-warning: #ffb454;
  --ds-danger: #ff6b7a;
  --ds-glass-shadow: 0 8px 32px rgba(0, 0, 0, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.55);
}

[data-theme='dark'] {
  --ds-glass-bg: rgba(18, 20, 28, 0.62);
  --ds-glass-border: rgba(255, 255, 255, 0.1);
  --ds-text-main: #f2f3f8;
  --ds-text-sub: rgba(242, 243, 248, 0.62);
  --ds-glass-shadow: 0 16px 48px rgba(0, 0, 0, 0.36), inset 0 1px 0 rgba(255, 255, 255, 0.08);
}

html,
body {
  margin: 0;
  background: transparent;
  color: var(--ds-text-main);
  font-family: 'PingFang SC', 'Inter', system-ui, sans-serif;
}
```

- [ ] **Step 3: 提交**

```bash
git add apps/desktop/package.json apps/desktop/pnpm-lock.yaml apps/desktop/tailwind.config.js apps/desktop/postcss.config.js apps/desktop/src/renderer/theme/tokens.css
git commit -m "build(desktop): Tailwind v3 + PostCSS + design-system token (light/dark CSS vars)"
```
> 注：pnpm-lock.yaml 在仓库根；若 add 改的是根 lock，按 `git add pnpm-lock.yaml`。

---

## Task 9: theme-resolver（纯 TS）

**Files:**
- Create: `apps/desktop/src/renderer/theme/theme-resolver.ts`
- Test: `apps/desktop/test/theme-resolver.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// apps/desktop/test/theme-resolver.test.ts
import { describe, it, expect } from 'vitest';
import { resolveTheme } from '../src/renderer/theme/theme-resolver';

describe('resolveTheme', () => {
  it("maps 'light'/'dark' straight through", () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it("'system' follows the OS preference", () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @desksoul/desktop exec vitest run test/theme-resolver.test.ts`
Expected: FAIL — cannot find module theme-resolver

- [ ] **Step 3: 写实现**

```ts
// apps/desktop/src/renderer/theme/theme-resolver.ts
import type { ThemePref } from '@desksoul/protocol';

export type ConcreteTheme = 'light' | 'dark';

/** pref + 系统是否暗色 → 具体主题。'system' 跟随系统（未指明=false→浅色，ui-design §2.2）。 */
export function resolveTheme(pref: ThemePref, systemPrefersDark: boolean): ConcreteTheme {
  if (pref === 'system') return systemPrefersDark ? 'dark' : 'light';
  return pref;
}

/** 把具体主题写到 <html data-theme>（薄 DOM 操作，逻辑在 resolveTheme）。 */
export function applyTheme(pref: ThemePref): void {
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = resolveTheme(pref, dark);
}

/** 当 pref='system' 时监听系统切换并重应用；返回退订函数。 */
export function watchSystemTheme(getPref: () => ThemePref): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = (): void => {
    if (getPref() === 'system') applyTheme('system');
  };
  mq.addEventListener('change', handler);
  return () => mq.removeEventListener('change', handler);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @desksoul/desktop exec vitest run test/theme-resolver.test.ts`
Expected: PASS (2)

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/renderer/theme/theme-resolver.ts apps/desktop/test/theme-resolver.test.ts
git commit -m "feat(desktop): theme-resolver (pref + system → concrete theme) + applyTheme/watch"
```

---

# Phase C · 组件库子集

> 约定：每个组件是薄 SFC（`<script setup lang="ts">` + `<template>` + Tailwind class）。有分支逻辑的（ToastHost 队列）下沉纯 TS 测；纯展示组件靠 typecheck + skeleton 集成验证（不引入 @vue/test-utils）。

## Task 10: GlassPanel + Button + SettingCard

**Files:**
- Create: `apps/desktop/src/renderer/components/GlassPanel.vue`
- Create: `apps/desktop/src/renderer/components/Button.vue`
- Create: `apps/desktop/src/renderer/components/SettingCard.vue`

- [ ] **Step 1: 写组件（无独立单测；Task 13 集成验证）**

```vue
<!-- apps/desktop/src/renderer/components/GlassPanel.vue -->
<script setup lang="ts">
defineProps<{ size?: 's' | 'm' | 'l' }>();
</script>
<template>
  <div
    class="border border-glass-border bg-glass-bg backdrop-blur-glass"
    :class="size === 'l' ? 'rounded-panel' : size === 's' ? 'rounded-card' : 'rounded-panel'"
    style="box-shadow: var(--ds-glass-shadow)"
  >
    <slot />
  </div>
</template>
```

```vue
<!-- apps/desktop/src/renderer/components/Button.vue -->
<script setup lang="ts">
defineProps<{ variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; disabled?: boolean }>();
</script>
<template>
  <button
    :disabled="disabled"
    class="rounded-btn px-4 py-2 text-base transition ease-ds active:scale-[0.97] disabled:opacity-50"
    :class="{
      'text-white': variant === 'primary' || variant === 'danger',
      'border border-glass-border bg-glass-bg text-text-main': variant === 'secondary' || !variant,
      'bg-transparent text-text-main': variant === 'ghost',
    }"
    :style="
      variant === 'primary'
        ? 'background: linear-gradient(90deg, var(--ds-brand-from), var(--ds-brand-to))'
        : variant === 'danger'
          ? 'background: var(--ds-danger)'
          : ''
    "
  >
    <slot />
  </button>
</template>
```

```vue
<!-- apps/desktop/src/renderer/components/SettingCard.vue -->
<!-- §7.1 卡片行：左 Label+Description，右控件（slot）。 -->
<script setup lang="ts">
defineProps<{ label: string; description?: string }>();
</script>
<template>
  <div class="flex items-center justify-between gap-4 px-4 py-3">
    <div class="min-w-0">
      <div class="text-base text-text-main">{{ label }}</div>
      <div v-if="description" class="text-sm text-text-sub">{{ description }}</div>
    </div>
    <div class="shrink-0"><slot /></div>
  </div>
</template>
```

- [ ] **Step 2: typecheck**

Run: `pnpm --filter @desksoul/desktop typecheck`
Expected: 干净（vue-tsc 通过）。

- [ ] **Step 3: 提交**

```bash
git add apps/desktop/src/renderer/components/GlassPanel.vue apps/desktop/src/renderer/components/Button.vue apps/desktop/src/renderer/components/SettingCard.vue
git commit -m "feat(desktop): GlassPanel + Button + SettingCard components (§2.6/§7.1)"
```

---

## Task 11: 表单控件 Switch / Select / Input / Slider

**Files:**
- Create: `apps/desktop/src/renderer/components/{Switch,Select,Input,Slider}.vue`

> 这些为 M7b 面板预备（spec §2.7）；M7a 仅 Select/Switch 在 skeleton 可能用到。统一 `v-model`（`modelValue` + `update:modelValue`）。

- [ ] **Step 1: 写组件**

```vue
<!-- apps/desktop/src/renderer/components/Switch.vue -->
<script setup lang="ts">
defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [boolean] }>();
</script>
<template>
  <button
    role="switch"
    :aria-checked="modelValue"
    class="relative h-6 w-11 rounded-full transition ease-ds"
    :style="modelValue ? 'background: var(--ds-brand-to)' : 'background: var(--ds-glass-border)'"
    @click="emit('update:modelValue', !modelValue)"
  >
    <span
      class="absolute top-0.5 h-5 w-5 rounded-full bg-white transition ease-ds"
      :style="modelValue ? 'left: 22px' : 'left: 2px'"
    />
  </button>
</template>
```

```vue
<!-- apps/desktop/src/renderer/components/Select.vue -->
<script setup lang="ts">
defineProps<{ modelValue: string; options: ReadonlyArray<{ value: string; label: string }> }>();
const emit = defineEmits<{ 'update:modelValue': [string] }>();
</script>
<template>
  <select
    class="rounded-input border border-glass-border bg-glass-bg px-3 py-2 text-base text-text-main"
    :value="modelValue"
    @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
  >
    <option v-for="o in options" :key="o.value" :value="o.value">{{ o.label }}</option>
  </select>
</template>
```

```vue
<!-- apps/desktop/src/renderer/components/Input.vue -->
<script setup lang="ts">
defineProps<{ modelValue: string; placeholder?: string }>();
const emit = defineEmits<{ 'update:modelValue': [string] }>();
</script>
<template>
  <input
    class="rounded-input border border-glass-border bg-glass-bg px-3 py-2 text-base text-text-main"
    :value="modelValue"
    :placeholder="placeholder"
    @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
  />
</template>
```

```vue
<!-- apps/desktop/src/renderer/components/Slider.vue -->
<script setup lang="ts">
defineProps<{ modelValue: number; min?: number; max?: number; step?: number }>();
const emit = defineEmits<{ 'update:modelValue': [number] }>();
</script>
<template>
  <input
    type="range"
    :min="min ?? 0"
    :max="max ?? 100"
    :step="step ?? 1"
    :value="modelValue"
    @input="emit('update:modelValue', Number(($event.target as HTMLInputElement).value))"
  />
</template>
```

- [ ] **Step 2: typecheck**

Run: `pnpm --filter @desksoul/desktop typecheck`
Expected: 干净。

- [ ] **Step 3: 提交**

```bash
git add apps/desktop/src/renderer/components/Switch.vue apps/desktop/src/renderer/components/Select.vue apps/desktop/src/renderer/components/Input.vue apps/desktop/src/renderer/components/Slider.vue
git commit -m "feat(desktop): form controls Switch/Select/Input/Slider (v-model)"
```

---

## Task 12: Toast 队列（纯 TS）+ ToastHost

**Files:**
- Create: `apps/desktop/src/renderer/components/toast-queue.ts`
- Create: `apps/desktop/src/renderer/components/ToastHost.vue`
- Test: `apps/desktop/test/toast-queue.test.ts`

- [ ] **Step 1: 写失败测试（队列逻辑：顶栏薄条最多 1 条，浮卡最多 3 条挤旧）**

```ts
// apps/desktop/test/toast-queue.test.ts
import { describe, it, expect } from 'vitest';
import { ToastQueue } from '../src/renderer/components/toast-queue';

describe('ToastQueue', () => {
  it('keeps at most 3 float toasts, dropping the oldest', () => {
    const q = new ToastQueue();
    q.push({ kind: 'float', text: 'a' });
    q.push({ kind: 'float', text: 'b' });
    q.push({ kind: 'float', text: 'c' });
    q.push({ kind: 'float', text: 'd' });
    expect(q.items.filter((t) => t.kind === 'float').map((t) => t.text)).toEqual(['b', 'c', 'd']);
  });

  it('keeps only the latest top-bar toast', () => {
    const q = new ToastQueue();
    q.push({ kind: 'bar', text: '✓ 已保存' });
    q.push({ kind: 'bar', text: '✓ 已保存' });
    expect(q.items.filter((t) => t.kind === 'bar')).toHaveLength(1);
  });

  it('dismiss removes by id', () => {
    const q = new ToastQueue();
    const id = q.push({ kind: 'float', text: 'x' });
    q.dismiss(id);
    expect(q.items).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @desksoul/desktop exec vitest run test/toast-queue.test.ts`
Expected: FAIL — cannot find module toast-queue

- [ ] **Step 3: 写实现**

```ts
// apps/desktop/src/renderer/components/toast-queue.ts
/** Toast 队列纯逻辑（ui-design §2.6.3）：顶栏薄条保留最新 1 条；浮卡最多 3 条挤旧。 */
export interface Toast {
  id: number;
  kind: 'bar' | 'float';
  text: string;
}

export class ToastQueue {
  items: Toast[] = [];
  private nextId = 1;

  push(t: { kind: 'bar' | 'float'; text: string }): number {
    const id = this.nextId++;
    if (t.kind === 'bar') {
      this.items = this.items.filter((x) => x.kind !== 'bar');
    }
    this.items.push({ id, ...t });
    const floats = this.items.filter((x) => x.kind === 'float');
    if (floats.length > 3) {
      const dropId = floats[0]!.id;
      this.items = this.items.filter((x) => x.id !== dropId);
    }
    return id;
  }

  dismiss(id: number): void {
    this.items = this.items.filter((x) => x.id !== id);
  }
}
```

```vue
<!-- apps/desktop/src/renderer/components/ToastHost.vue -->
<script setup lang="ts">
import { reactive } from 'vue';
import { ToastQueue } from './toast-queue';

const queue = reactive(new ToastQueue());
// 顶栏薄条 600ms / 浮卡 3s 自动消失（§2.6.3）。
function show(kind: 'bar' | 'float', text: string): void {
  const id = queue.push({ kind, text });
  setTimeout(() => queue.dismiss(id), kind === 'bar' ? 600 : 3000);
}
defineExpose({ show });
</script>
<template>
  <div
    v-for="t in queue.items.filter((x) => x.kind === 'bar')"
    :key="t.id"
    class="pointer-events-none fixed left-0 top-0 z-50 flex h-8 w-full items-center justify-center text-sm text-text-main"
    style="background: var(--ds-glass-bg)"
  >
    {{ t.text }}
  </div>
  <div class="pointer-events-none fixed bottom-6 right-6 z-50 flex flex-col gap-2">
    <div
      v-for="t in queue.items.filter((x) => x.kind === 'float')"
      :key="t.id"
      class="rounded-card border border-glass-border bg-glass-bg px-4 py-3 text-base text-text-main backdrop-blur-glass"
    >
      {{ t.text }}
    </div>
  </div>
</template>
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @desksoul/desktop exec vitest run test/toast-queue.test.ts`
Expected: PASS (3)

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/renderer/components/toast-queue.ts apps/desktop/src/renderer/components/ToastHost.vue apps/desktop/test/toast-queue.test.ts
git commit -m "feat(desktop): ToastQueue logic + ToastHost (top-bar 已保存 + float)"
```

---

# Phase D · Hub 壳 + 主题 walking skeleton

## Task 13: 导航树（数据 + 纯逻辑）

**Files:**
- Create: `apps/desktop/src/renderer/settings/nav-tree.ts`
- Test: `apps/desktop/test/nav-tree.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// apps/desktop/test/nav-tree.test.ts
import { describe, it, expect } from 'vitest';
import { NAV_TREE, flattenRoutes, isActive } from '../src/renderer/settings/nav-tree';

describe('Hub nav-tree', () => {
  it('exposes the §3.3 top groups', () => {
    expect(NAV_TREE.map((g) => g.id)).toContain('system');
    expect(NAV_TREE.map((g) => g.id)).toContain('model');
  });

  it('flattenRoutes yields every leaf route id', () => {
    expect(flattenRoutes()).toContain('system.display');
  });

  it('isActive matches the current route', () => {
    expect(isActive('system.display', 'system.display')).toBe(true);
    expect(isActive('system.display', 'system.privacy')).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @desksoul/desktop exec vitest run test/nav-tree.test.ts`
Expected: FAIL — cannot find module nav-tree

- [ ] **Step 3: 写实现**

```ts
// apps/desktop/src/renderer/settings/nav-tree.ts
/** Hub 左导航树（ui-design §3.3）。M7a 只有 system.display 有真实内容，其余占位。 */
export interface NavLeaf {
  id: string;
  label: string;
}
export interface NavGroup {
  id: string;
  label: string;
  children: NavLeaf[];
}

export const NAV_TREE: NavGroup[] = [
  { id: 'overview', label: '总览', children: [] },
  {
    id: 'character',
    label: '角色',
    children: [
      { id: 'character.library', label: '角色库' },
      { id: 'character.editor', label: '编辑器' },
    ],
  },
  {
    id: 'conversation',
    label: '对话',
    children: [
      { id: 'conversation.history', label: '历史' },
      { id: 'conversation.memory', label: '记忆' },
      { id: 'conversation.persona', label: '人格' },
    ],
  },
  { id: 'model', label: '模型 API', children: [] },
  { id: 'plugins', label: '插件', children: [] },
  { id: 'knowledge', label: '知识库', children: [] },
  {
    id: 'system',
    label: '系统',
    children: [
      { id: 'system.display', label: '显示与窗口' },
      { id: 'system.voice', label: '语音' },
      { id: 'system.hotkeys', label: '热键' },
      { id: 'system.privacy', label: '隐私' },
      { id: 'system.data', label: '数据' },
      { id: 'system.about', label: '关于' },
    ],
  },
];

export function flattenRoutes(): string[] {
  return NAV_TREE.flatMap((g) => (g.children.length ? g.children.map((c) => c.id) : [g.id]));
}

export function isActive(route: string, current: string): boolean {
  return route === current;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @desksoul/desktop exec vitest run test/nav-tree.test.ts`
Expected: PASS (3)

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/renderer/settings/nav-tree.ts apps/desktop/test/nav-tree.test.ts
git commit -m "feat(desktop): Hub nav-tree data + active-state logic (§3.3)"
```

---

## Task 14: Hub 壳 App.vue + 入口（含主题 skeleton 与 hydrate）

**Files:**
- Modify: `apps/desktop/src/renderer/settings/index.html`
- Modify: `apps/desktop/src/renderer/settings/main.ts`
- Create: `apps/desktop/src/renderer/settings/App.vue`
- Create: `apps/desktop/src/renderer/settings/pages/DisplayPage.vue`

> Hub 壳渲染 + walking skeleton（界面主题）。无独立单测（集成）；逻辑已在 nav-tree / theme-resolver / toast-queue 单测覆盖。Step 4 用 dev 冒烟验证。

- [ ] **Step 1: index.html 加 #app**

```html
<!-- apps/desktop/src/renderer/settings/index.html -->
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>DeskSoul · Hub</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
```

- [ ] **Step 2: main.ts 挂载 + 引入 token 样式 + 启动 hydrate 主题**

```ts
// apps/desktop/src/renderer/settings/main.ts
import { createApp } from 'vue';
import App from './App.vue';
import '../theme/tokens.css';
import { applyTheme, watchSystemTheme } from '../theme/theme-resolver';
import type { Prefs } from '@desksoul/protocol';

// 启动 hydrate：拉 prefs → 应用当前主题；并监听系统主题变化（pref='system' 时）。
let currentTheme: Prefs['display.theme'] = 'system';
void window.desksoul.rpc('app.prefs.getAll', {}).then((prefs) => {
  currentTheme = (prefs as Prefs)['display.theme'];
  applyTheme(currentTheme);
});
watchSystemTheme(() => currentTheme);
// 跨 renderer 即时生效：监听 changed（其它窗口改了主题也跟随）。
window.desksoul.on('app.prefs.changed', (p) => {
  const { key, value } = p as { key: string; value: unknown };
  if (key === 'display.theme') {
    currentTheme = value as Prefs['display.theme'];
    applyTheme(currentTheme);
  }
});

createApp(App).mount('#app');
```

- [ ] **Step 3: App.vue 壳 + DisplayPage（主题分段控件）**

```vue
<!-- apps/desktop/src/renderer/settings/App.vue -->
<script setup lang="ts">
import { ref } from 'vue';
import { NAV_TREE, isActive } from './nav-tree';
import DisplayPage from './pages/DisplayPage.vue';
import ToastHost from '../components/ToastHost.vue';

const active = ref('system.display');
const toast = ref<InstanceType<typeof ToastHost> | null>(null);
function saved(): void {
  toast.value?.show('bar', '✓ 已保存');
}
</script>
<template>
  <div class="flex h-screen text-base" style="background: var(--ds-glass-bg)">
    <ToastHost ref="toast" />
    <!-- 左导航 280px -->
    <nav class="w-[280px] shrink-0 overflow-y-auto border-r border-glass-border p-3">
      <template v-for="g in NAV_TREE" :key="g.id">
        <div class="px-2 py-1 text-sm text-text-sub">{{ g.label }}</div>
        <button
          v-for="c in g.children"
          :key="c.id"
          class="block w-full rounded-btn px-3 py-2 text-left text-base"
          :class="isActive(c.id, active) ? 'text-text-main' : 'text-text-sub'"
          :style="isActive(c.id, active) ? 'background: var(--ds-glass-border)' : ''"
          @click="active = c.id"
        >
          {{ c.label }}
        </button>
      </template>
    </nav>
    <!-- 顶栏 56px + 内容区 + 状态条 32px -->
    <div class="flex min-w-0 flex-1 flex-col">
      <header class="flex h-[56px] items-center border-b border-glass-border px-4 text-text-main">
        DeskSoul · 设置
      </header>
      <main class="flex-1 overflow-y-auto p-6">
        <DisplayPage v-if="active === 'system.display'" @saved="saved" />
        <div v-else class="text-text-sub">（{{ active }} 留待 M7b）</div>
      </main>
      <footer class="flex h-8 items-center border-t border-glass-border px-4 text-sm text-text-sub">
        ● 就绪
      </footer>
    </div>
  </div>
</template>
```

```vue
<!-- apps/desktop/src/renderer/settings/pages/DisplayPage.vue -->
<!-- walking skeleton：界面主题端到端（设置 → prefs.set → 落盘 → 广播 → 换肤 → ✓已保存）。 -->
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { Prefs, ThemePref } from '@desksoul/protocol';
import GlassPanel from '../../components/GlassPanel.vue';
import SettingCard from '../../components/SettingCard.vue';
import Select from '../../components/Select.vue';

const emit = defineEmits<{ saved: [] }>();
const theme = ref<ThemePref>('system');
const OPTIONS = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
];

onMounted(async () => {
  const prefs = (await window.desksoul.rpc('app.prefs.getAll', {})) as Prefs;
  theme.value = prefs['display.theme'];
});

async function onChange(v: string): Promise<void> {
  theme.value = v as ThemePref;
  await window.desksoul.rpc('app.prefs.set', { key: 'display.theme', value: v });
  emit('saved'); // 触发顶栏 ✓ 已保存（换肤由 main.ts 的 changed 订阅完成）
}
</script>
<template>
  <GlassPanel size="l" class="max-w-[640px]">
    <SettingCard label="界面主题" description="跟随系统 / 浅色 / 深色">
      <Select :model-value="theme" :options="OPTIONS" @update:model-value="onChange" />
    </SettingCard>
  </GlassPanel>
</template>
```

- [ ] **Step 4: dev 冒烟（手动）**

Run: `pnpm --filter @desksoul/desktop dev`
Expected（手动观察）：Hub 窗口渲染左导航 + 显示页；切"深色"→ 全窗换肤 + 顶栏闪 `✓ 已保存`；重启 app 后主题保持（已落 prefs.json）。记入 RESULTS-M7a。

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/renderer/settings/index.html apps/desktop/src/renderer/settings/main.ts apps/desktop/src/renderer/settings/App.vue apps/desktop/src/renderer/settings/pages/DisplayPage.vue
git commit -m "feat(desktop): Hub shell + theme walking-skeleton (prefs.set→changed→reskin→saved toast)"
```

---

## Task 15: overlay / character renderer 跟随主题

**Files:**
- Modify: `apps/desktop/src/renderer/overlay/main.ts`
- Modify: `apps/desktop/src/renderer/character/main.ts`

> 让另两个 renderer 也订阅 `app.prefs.changed` 并 hydrate 主题，验证"跨 renderer 即时生效"。

- [ ] **Step 1: 抽共享 helper（避免三处重复）**

```ts
// apps/desktop/src/renderer/theme/subscribe.ts
import type { Prefs } from '@desksoul/protocol';
import { applyTheme, watchSystemTheme } from './theme-resolver';

/** renderer 通用：hydrate 当前主题 + 订阅 changed + 跟随系统。返回退订。 */
export function subscribeTheme(): () => void {
  let theme: Prefs['display.theme'] = 'system';
  void window.desksoul.rpc('app.prefs.getAll', {}).then((p) => {
    theme = (p as Prefs)['display.theme'];
    applyTheme(theme);
  });
  const offSys = watchSystemTheme(() => theme);
  const offChanged = window.desksoul.on('app.prefs.changed', (raw) => {
    const { key, value } = raw as { key: string; value: unknown };
    if (key === 'display.theme') {
      theme = value as Prefs['display.theme'];
      applyTheme(theme);
    }
  });
  return () => {
    offSys();
    offChanged();
  };
}
```

并把 `settings/main.ts` 里手写的那段（Step 2 of Task 14）替换为 `import { subscribeTheme } from '../theme/subscribe'; subscribeTheme();`（DRY）。

- [ ] **Step 2: overlay/main.ts 接入**

```ts
// apps/desktop/src/renderer/overlay/main.ts
import { createApp } from 'vue';
import App from './App.vue';
import '../theme/tokens.css';
import { subscribeTheme } from '../theme/subscribe';

subscribeTheme();
createApp(App).mount('#app');
```

- [ ] **Step 3: character/main.ts 接入**

在 `character/main.ts` 顶部 import 后追加（character 是非 Vue 的 Three.js renderer；只需主题 helper）：
```ts
import '../theme/tokens.css';
import { subscribeTheme } from '../theme/subscribe';
subscribeTheme();
```
（若 character/main.ts 无现成 import 区，加在文件首部即可；不影响 Three.js 初始化。）

- [ ] **Step 4: typecheck + 全量回归**

Run:
```bash
pnpm --filter @desksoul/desktop typecheck
pnpm --filter @desksoul/desktop test
```
Expected: 干净；全量绿。

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/renderer/theme/subscribe.ts apps/desktop/src/renderer/settings/main.ts apps/desktop/src/renderer/overlay/main.ts apps/desktop/src/renderer/character/main.ts
git commit -m "feat(desktop): all renderers subscribe app.prefs.changed for live theming (DRY helper)"
```

---

# Phase E · 验收与收尾

## Task 16: 全量验收 + 构建冒烟

**Files:** 无（验证）

- [ ] **Step 1: 全量测试（protocol + desktop）**

Run:
```bash
pnpm --filter @desksoul/protocol test
pnpm --filter @desksoul/desktop test
```
Expected: 全绿（desktop = 旧 226 + 本里程碑新增 prefs/theme/toast/nav 用例）。

- [ ] **Step 2: typecheck + prettier + 构建**

Run:
```bash
pnpm --filter @desksoul/desktop typecheck
pnpm exec prettier --check "apps/desktop/src/renderer/**/*.{ts,vue}" "apps/desktop/electron/main/prefs/**/*.ts" "apps/desktop/electron/main/prefs-service.ts"
pnpm --filter @desksoul/desktop build
```
Expected: typecheck 干净；prettier 全通过（不过则 `--write` 后重测重 commit）；`electron-vite build` 成功（Tailwind 编译进 renderer CSS，无 PostCSS 报错）。

- [ ] **Step 3: 手动冒烟（walking skeleton 验收）**

`pnpm --filter @desksoul/desktop dev`，确认：
- Hub 壳按 §3.3 渲染（左导航 280 / 顶栏 56 / 状态条 32）。
- 改"界面主题"→ Hub + overlay 同时换肤 + 顶栏 `✓ 已保存`。
- 重启 app → 主题保持（prefs.json 落盘生效）。
- 删/坏 `userData/data/prefs.json` → app 正常启动用默认（不崩）。

---

## Task 17: RESULTS-M7a + CLAUDE.md 状态行

**Files:**
- Create: `apps/desktop/RESULTS-M7a.md`
- Modify: `CLAUDE.md`

按 [[里程碑收尾清单]] 执行。

- [ ] **Step 1: 写 RESULTS-M7a.md**

包含：交付项清单（PrefsStore/RPC、Tailwind+token、组件子集、Hub 壳、主题 skeleton）、测试统计（各文件用例数 + 全量绿）、手动冒烟结果（换肤/持久化/坏文件降级截图或描述）、M7b 衔接（待接 effects/面板/引导）。

- [ ] **Step 2: 更新 CLAUDE.md 项目概览状态行**

把"下一个里程碑是 M7（设置面板 UI…）"改为：M7a（地基：PrefsStore+RPC / Tailwind+token / Hub 壳 / 主题 walking-skeleton）已完成；下一步 M7b（D 系列面板 + C 系列引导）。

- [ ] **Step 3: 提交（+ 按惯例打 tag，可选）**

```bash
git add apps/desktop/RESULTS-M7a.md CLAUDE.md
git commit -m "docs(m7a): RESULTS-M7a + status line (foundation done)"
# 可选：git tag mvp/M7a-done
```

---

## Self-Review（plan vs spec 覆盖核对）

- **spec §1 范围 IN**：PrefsStore（T3/4/5）✓ / PrefsSchema（T1）✓ / 3 RPC（T2）✓ / effects（T5）✓ / Tailwind+token（T8）✓ / Hub 壳无 router（T13/14）✓ / 组件子集（T10/11/12）✓ / 主题 skeleton（T14/15）✓。
- **spec §1 OUT**：D 系列面板/引导/Bubble 等/搜索/总览 —— 未建任务，符合（留 M7b）✓。
- **spec §6 测试**：JsonPrefsStore（含坏文件，T4）✓ / prefs-service+effects（T6, T5）✓ / theme-resolver（T9）✓ / nav-tree（T13）✓ / 不引入 @vue/test-utils（贯穿，Phase C 注明）✓。
- **占位符扫描**：无 TBD；每代码步均含完整代码与确切命令/预期。
- **类型一致**：`PrefKey`/`Prefs`/`PrefsSchema.shape`（T1）↔ MemoryPrefsStore/JsonPrefsStore（T3/4）↔ prefs-service（T6）↔ effects（T5）签名一致；`app.prefs.set` params `{key,value}`（T2）↔ service 入参（T6）↔ wiring 测试（T7）一致；`ThemePref`（protocol，T1）↔ theme-resolver（T9）一致。
- **已知衔接缺口（非本期）**：`character.setScale` 仍走旧路径，M7b 收编进 `display.characterScale` effect（spec §8 已记）。
