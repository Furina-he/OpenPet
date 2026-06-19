# M7b-1 P4 · D3 模型 API（双栏）+ chat 集成 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: 用 `superpowers:executing-plans` 逐 task 推进（本仓约定 **inline 执行**，勿派 subagent——429 限流，见 [[project-subagent-inline]]）。Steps 用 `- [ ]` 复选框跟踪。

**Goal:** 在 Hub 落地 D3 模型 API 双栏面板，并把 chat.send 接到「当前 provider/model」，满足 **「配 Key → 听到回复」** 验收。

**Architecture:** 纯增量集成，**worker / protocol 零改动**——`chat.send{providerId?}`、`ChatRequest.model?`、`provider.*` 6 RPC、`model.activeProvider/activeModel` prefs 全部已就绪（M5/M7a）。新增点：① ChatService 注入 `resolveModel()`，`send()` 无显式 providerId 时由它定 chain 首项 + `request.model`；解析逻辑抽成**纯函数** `resolveSendTarget()` 单测。② D3 SFC 薄渲染，逻辑下沉纯 TS（`provider-status` / `key-reveal`）。③ ipc-router 从 PrefsStore 注入 `resolveModel`。

**Tech Stack:** Vue 3 SFC + Tailwind v3 + 设计 token；Zod；Vitest（纯逻辑红绿，不引入 `@vue/test-utils`）；`lucide-vue-next`；Playwright MCP 视觉闭环。

**视觉真源:** D3 **无专属 PNG**（已 Read 核实 `UI/3c9a77c6` = P1 E2/E3 角色详情/导入，非 D3；ui-design §4.1 line 255/259 确认）→ 参照 **`UI/1d7669e3`（设置设计语言）+ §7.3 文字版图 + §2 token**。⚠ ui-design §4.1 之外仍有 4 处残留旧映射（line 265/290/624/1793 写「3c9a77c6=D3」），是 PM 待修订的文档债，**实现时一律以 §4.1 修订块为准**。

---

## 范围与边界（PM 已定，避免过度实现）

**做实（验收路径）**：provider 列表（`provider.listProviders`）+ 状态点 + 选 provider→`prefs.set model.activeProvider` + Key 配置（`provider.saveKey/deleteKey`）+ 模型选择（`provider.listModels`→`prefs.set model.activeModel`）+ `[测试连接]`（`provider.testConnection`）+ Ollama 检测（`provider.ollamaDetect`）+ **chat.send 动态解析**。

**渲染 + 持久、但存而不接**（§7.1「全量渲染+持久化」原则；prefs 键已在 schema）：
- **预算告警卡**（`budget.enabled/monthlyCap/warnAt/onExceed`）：渲染 + 持久；「已使用 ¥X」**无 cost 聚合源 → 占位显示 `¥0.00 / —`**（真实计量留后续）。
- **离线兜底卡**（`offline.fallbackMode/ollamaModel`）：渲染 + 持久；真实「全 provider 不可用→切 demo/error」行为留后续（现 ChatService 仅有 providerChain 顺位降级）。
- **Endpoint 字段**：显示 dialect `baseUrl`（只读灰字）；用户覆盖需 `model.providers` 持久化（当前 PrefsSchema 无此键）→ 留后续。

**留后续（明确不做，RESULTS 记残留）**：添加自定义/兼容 provider、多套同 provider 配置 + 右键复制、per-provider enabled 开关、baseUrl/默认模型覆盖持久化、高级（超时/重试/代理/Stream 协议）、`app.openExternal` 文档外链（随 P5 D8 一起）。

---

## 文件结构

- 新 `apps/desktop/src/renderer/settings/provider-status.ts`（点色映射，纯）
- 新 `apps/desktop/src/renderer/settings/key-reveal.ts`（Key 遮罩 + 5s 遮回，纯）
- 新 `apps/desktop/electron/main/chat-resolve.ts`（`resolveSendTarget` 纯函数）
- 改 `apps/desktop/electron/main/context-assembler.ts`（`AssembleInput.model?` 透传）
- 改 `apps/desktop/electron/main/chat-service.ts`（`resolveModel` 注入 + 用 `resolveSendTarget`）
- 改 `apps/desktop/electron/main/ipc-router.ts`（注入 `resolveModel` 读 prefs；句柄名以现有为准）
- 新 `apps/desktop/src/renderer/components/KeyInput.vue`、`ProviderList.vue`
- 新 `apps/desktop/src/renderer/settings/pages/ModelApiPage.vue`（D3 双栏）
- 改 `apps/desktop/src/renderer/settings/App.vue`（空组标题可点 + `model`→ModelApiPage）
- 测试：`test/provider-status.test.ts`、`test/key-reveal.test.ts`、`test/chat-resolve.test.ts`、`test/context-assembler.test.ts`（追加 model 用例）

---

## Task 1: `provider-status.ts` 点色映射（纯逻辑）

**Files:** Create `src/renderer/settings/provider-status.ts`、`test/provider-status.test.ts`

- [ ] **Step 1: 写失败测试** — `test/provider-status.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { providerDot } from '../src/renderer/settings/provider-status';

describe('providerDot（§7.3 绿=可用/灰=待填Key/红=测失败）', () => {
  it('测失败优先 → fail', () => {
    expect(providerDot({ hasKey: true, lastTestOk: false })).toBe('fail');
  });
  it('有 Key（或免 Key）且未测失败 → ok', () => {
    expect(providerDot({ hasKey: true })).toBe('ok');
    expect(providerDot({ hasKey: true, lastTestOk: true })).toBe('ok');
  });
  it('无 Key → pending', () => {
    expect(providerDot({ hasKey: false })).toBe('pending');
  });
});
```

- [ ] **Step 2: 跑红** — `pnpm exec vitest run test/provider-status.test.ts`（在 `apps/desktop`）。Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现** — `src/renderer/settings/provider-status.ts`

```ts
/** §7.3 左栏状态点：红=测失败 / 绿=已配置可用 / 灰=待填 Key。 */
export type ProviderDot = 'ok' | 'pending' | 'fail';

export function providerDot(input: { hasKey: boolean; lastTestOk?: boolean | null }): ProviderDot {
  if (input.lastTestOk === false) return 'fail';
  if (input.hasKey) return 'ok';
  return 'pending';
}

/** 点色 → CSS 变量（绿用品牌暖色，红用 danger，灰用 sub）。 */
export const DOT_COLOR: Record<ProviderDot, string> = {
  ok: 'var(--ds-brand-to)',
  fail: 'var(--ds-danger)',
  pending: 'var(--ds-text-sub)',
};
```

- [ ] **Step 4: 跑绿** — 同 Step 2 命令。Expected: PASS（3 tests）。
- [ ] **Step 5: 提交** — `git commit -m "feat(desktop): provider-status dot mapping (§7.3)"`

---

## Task 2: `key-reveal.ts` Key 遮罩 + 5s 自动遮回（纯逻辑）

**Files:** Create `src/renderer/settings/key-reveal.ts`、`test/key-reveal.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect, vi } from 'vitest';
import { maskKey, KeyReveal } from '../src/renderer/settings/key-reveal';

describe('maskKey', () => {
  it('短串全遮', () => expect(maskKey('abcd', false)).toBe('••••'));
  it('长串留首尾 4', () =>
    expect(maskKey('sk-ant-0123456789', false)).toBe('sk-a•••••••••6789'));
  it('revealed 原样', () => expect(maskKey('sk-ant', true)).toBe('sk-ant'));
});

describe('KeyReveal 5s 遮回', () => {
  it('reveal → revealed=true，holdMs 后回 false；再 reveal 重置计时', () => {
    let cb: (() => void) | null = null;
    const timer = {
      set: (f: () => void) => {
        cb = f;
        return 1 as unknown as ReturnType<typeof setTimeout>;
      },
      clear: vi.fn(),
    };
    const r = new KeyReveal(5000, timer);
    r.reveal();
    expect(r.revealed).toBe(true);
    cb!(); // 模拟 5s 到点
    expect(r.revealed).toBe(false);
    r.reveal();
    r.reveal(); // 第二次应先 clear 前一个计时
    expect(timer.clear).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑红** — `pnpm exec vitest run test/key-reveal.test.ts`。Expected: FAIL。

- [ ] **Step 3: 实现** — `src/renderer/settings/key-reveal.ts`

```ts
/** Key 遮罩：>8 留首尾各 4，其余全 •（§7.3「默认遮罩，点眼睛显示 5s」）。 */
export function maskKey(key: string, revealed: boolean): string {
  if (revealed) return key;
  if (key.length <= 8) return '•'.repeat(key.length);
  return key.slice(0, 4) + '•'.repeat(key.length - 8) + key.slice(-4);
}

interface TimerLike {
  set: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clear: (h: ReturnType<typeof setTimeout>) => void;
}

/** 显示 Key 后 holdMs 自动遮回；timer 可注入便于测。 */
export class KeyReveal {
  revealed = false;
  private h: ReturnType<typeof setTimeout> | null = null;
  constructor(
    private readonly holdMs = 5000,
    private readonly timer: TimerLike = { set: setTimeout, clear: clearTimeout },
  ) {}
  reveal(): void {
    if (this.h) this.timer.clear(this.h);
    this.revealed = true;
    this.h = this.timer.set(() => {
      this.revealed = false;
      this.h = null;
    }, this.holdMs);
  }
  hideNow(): void {
    if (this.h) this.timer.clear(this.h);
    this.revealed = false;
    this.h = null;
  }
}
```

- [ ] **Step 4: 跑绿** — 同 Step 2。Expected: PASS。
- [ ] **Step 5: 提交** — `git commit -m "feat(desktop): key-reveal mask + 5s auto-hide (§7.3)"`

---

## Task 3: `context-assembler` 透传 model（纯逻辑）

**Files:** Modify `electron/main/context-assembler.ts`、`test/context-assembler.test.ts`（追加用例）

- [ ] **Step 1: 追加失败测试** — `test/context-assembler.test.ts` 末尾加

```ts
it('透传 model 进 ChatRequest.model；未给则不带该键', () => {
  const store = new MemoryStore();
  const base = { store, character: { id: 'default', name: '小灵' }, sessionId: 's1', userText: 'hi' };
  expect(assembleContext({ ...base, model: 'claude-sonnet-4-6' }).model).toBe('claude-sonnet-4-6');
  expect('model' in assembleContext(base)).toBe(false);
});
```

> 若文件未 import `MemoryStore`/`assembleContext`，按现有 import 补上（`../electron/main/db/memory-store`、`../electron/main/context-assembler`）。

- [ ] **Step 2: 跑红** — `pnpm exec vitest run test/context-assembler.test.ts`。Expected: FAIL（`model` undefined / 键存在）。

- [ ] **Step 3: 实现** — `context-assembler.ts`：`AssembleInput` 加字段 + return 条件展开

```ts
export interface AssembleInput {
  store: ConversationStore;
  character: { id: string; name: string; emotions?: readonly string[]; actions?: readonly string[] };
  sessionId: string;
  userText: string;
  /** 当前选定模型；下沉到 ChatRequest.model（worker honor）。 */
  model?: string;
}
```

return 改为（`exactOptionalPropertyTypes`：用条件展开而非 `model: input.model`）：

```ts
  return {
    messages: [
      { role: 'system', content: system },
      ...history,
      { role: 'user', content: input.userText },
    ],
    ...(input.model ? { model: input.model } : {}),
  };
```

- [ ] **Step 4: 跑绿** — 同 Step 2。Expected: PASS（含原有 6 + 新增）。
- [ ] **Step 5: 提交** — `git commit -m "feat(desktop): assembleContext passes model into ChatRequest"`

---

## Task 4: `resolveSendTarget` 纯函数（chain + model 解析）

**Files:** Create `electron/main/chat-resolve.ts`、`test/chat-resolve.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest';
import { resolveSendTarget } from '../electron/main/chat-resolve';

describe('resolveSendTarget', () => {
  it('显式 providerId 优先，忽略 resolved', () => {
    expect(resolveSendTarget('openai', ['claude'], { providerId: 'gemini', model: 'g' })).toEqual({
      chain: ['openai'],
    });
  });
  it('无显式时用 resolved.providerId 作 chain 首项 + 透传 model', () => {
    expect(resolveSendTarget(undefined, ['claude'], { providerId: 'gemini', model: 'g-1.5' })).toEqual({
      chain: ['gemini'],
      model: 'g-1.5',
    });
  });
  it('resolved 无 providerId → 回退静态 chain；无 model 则不带键', () => {
    expect(resolveSendTarget(undefined, ['claude'], { model: 'x' })).toEqual({
      chain: ['claude'],
      model: 'x',
    });
    expect(resolveSendTarget(undefined, [], undefined)).toEqual({ chain: [] });
  });
});
```

- [ ] **Step 2: 跑红** — `pnpm exec vitest run test/chat-resolve.test.ts`。Expected: FAIL。

- [ ] **Step 3: 实现** — `electron/main/chat-resolve.ts`

```ts
/** 决定一轮 send 的 provider 降级链首项与 model（纯函数，便于单测，不碰 host）。 */
export function resolveSendTarget(
  explicitProviderId: string | undefined,
  staticChain: string[],
  resolved: { providerId?: string; model?: string } | undefined,
): { chain: string[]; model?: string } {
  if (explicitProviderId) return { chain: [explicitProviderId] };
  const chain = resolved?.providerId ? [resolved.providerId] : staticChain;
  return { chain, ...(resolved?.model ? { model: resolved.model } : {}) };
}
```

- [ ] **Step 4: 跑绿** — 同 Step 2。Expected: PASS。
- [ ] **Step 5: 提交** — `git commit -m "feat(desktop): resolveSendTarget (chain + model resolution)"`

---

## Task 5: ChatService 接 `resolveModel` + ipc-router 注入

**Files:** Modify `electron/main/chat-service.ts`、`electron/main/ipc-router.ts`

> 这是接线 task：行为由 Task 3/4 的纯函数测覆盖；本 task 验证**不回归**（现有 `chat-service.test.ts` 22 测仍绿）。

- [ ] **Step 1: chat-service.ts 加注入 + 用纯函数**

`ChatServiceOptions` 加：

```ts
  /** 动态解析当前 provider/model（无显式 providerId 时用）；ipc-router 从 prefs 注入。 */
  resolveModel?: () => { providerId?: string; model?: string };
```

类字段 + 构造赋值：`private readonly resolveModel?: () => { providerId?: string; model?: string };` / `this.resolveModel = opts.resolveModel;`

`send()` 顶部 import 并替换 chain/request 构造：

```ts
import { resolveSendTarget } from './chat-resolve.js';
// ...
  send(sessionId: string, text: string, providerId?: string): { ok: true } {
    if (this.session.isStreaming(sessionId)) {
      throw new RpcError(-32001, `session busy: ${sessionId} is still streaming`);
    }
    const resolved = providerId ? undefined : this.resolveModel?.();
    const { chain, model } = resolveSendTarget(providerId, this.providerChain, resolved);
    const request = assembleContext({
      store: this.conv,
      character: this.getCharacter(),
      sessionId,
      userText: text,
      ...(model ? { model } : {}),
    });
    // ...（this.turns.set / this.host.send / appendUser / beginAssistant 不变）
  }
```

- [ ] **Step 2: ipc-router.ts 注入 resolveModel**

先 `Read electron/main/ipc-router.ts` 确认 ChatService 构造处与 PrefsStore 句柄名。在 `new ChatService({ ... })` 选项里加（句柄名以现有为准，prefs 单值读 = `getAll()[key]`）：

```ts
      resolveModel: () => {
        const p = prefsStore.getAll();
        return {
          providerId: p['model.activeProvider'] || undefined,
          model: p['model.activeModel'] || undefined,
        };
      },
```

- [ ] **Step 3: 全量回归（不重跑无关，确认 chat 不回归）** — 先 `pnpm --filter @desksoul/sidecar build`，再 `pnpm exec vitest run test/chat-service.test.ts test/chat-resolve.test.ts test/context-assembler.test.ts`。Expected: 全 PASS（chat-service 22 不回归）。
- [ ] **Step 4: typecheck** — `pnpm --filter @desksoul/desktop typecheck` 干净。
- [ ] **Step 5: 提交** — `git commit -m "feat(desktop): ChatService resolveModel → dynamic provider+model from prefs (§7.1)"`

---

## Task 6: `KeyInput.vue` + `ProviderList.vue`（薄渲染组件）

**Files:** Create `src/renderer/components/KeyInput.vue`、`ProviderList.vue`

> 逻辑已在 Task 1/2 测过；SFC 仅薄渲染。无独立单测。

- [ ] **Step 1: KeyInput.vue** — 受控输入 + 眼睛切换（用 `KeyReveal` + `maskKey`），保存触发 emit

```vue
<!-- components/KeyInput.vue — §7.3 API Key 输入（遮罩 + 点眼睛显示 5s） -->
<script setup lang="ts">
import { ref, reactive } from 'vue';
import { Eye, EyeOff } from 'lucide-vue-next';
import { maskKey, KeyReveal } from '../settings/key-reveal';

const props = defineProps<{ hasKey: boolean }>();
const emit = defineEmits<{ save: [key: string]; clear: [] }>();
const draft = ref('');
const reveal = reactive(new KeyReveal());
</script>
<template>
  <div class="ds-glass flex items-center gap-2 rounded-btn px-3 py-2">
    <input
      class="flex-1 bg-transparent text-base text-text-main outline-none"
      :type="reveal.revealed ? 'text' : 'password'"
      :placeholder="props.hasKey ? '已配置（重新输入以替换）' : 'sk-...'"
      v-model="draft"
    />
    <button class="text-text-sub" @click="reveal.revealed ? reveal.hideNow() : reveal.reveal()">
      <component :is="reveal.revealed ? EyeOff : Eye" :size="16" :stroke-width="1.5" />
    </button>
    <button
      class="rounded-btn px-3 py-1 text-sm text-white"
      style="background: linear-gradient(90deg, var(--ds-brand-from), var(--ds-brand-to))"
      :disabled="!draft"
      @click="(emit('save', draft), (draft = ''))"
    >
      保存
    </button>
  </div>
</template>
```

> 注：`maskKey` 在自定义遮罩展示场景用；本组件用原生 `type=password` 即可遮罩，`maskKey`/`KeyReveal.revealed` 驱动「眼睛」切换。若评审要求显示遮罩态明文预览，再用 `maskKey`。

- [ ] **Step 2: ProviderList.vue** — 左栏列表 + 状态点（用 `providerDot`/`DOT_COLOR`）

```vue
<!-- components/ProviderList.vue — §7.3 左栏 provider 列表 + 状态点 -->
<script setup lang="ts">
import { providerDot, DOT_COLOR } from '../settings/provider-status';

interface Row {
  id: string;
  name: string;
  model: string;
  hasKey: boolean;
  lastTestOk?: boolean | null;
}
const props = defineProps<{ rows: Row[]; activeId: string }>();
const emit = defineEmits<{ select: [id: string] }>();
</script>
<template>
  <div class="flex flex-col gap-1">
    <button
      v-for="r in props.rows"
      :key="r.id"
      class="flex items-center gap-2 rounded-btn px-3 py-2 text-left"
      :class="r.id === props.activeId ? 'text-text-main' : 'text-text-sub'"
      :style="r.id === props.activeId ? 'background: var(--ds-glass-border)' : ''"
      @click="emit('select', r.id)"
    >
      <span
        class="h-2 w-2 shrink-0 rounded-full"
        :style="`background: ${DOT_COLOR[providerDot(r)]}`"
      />
      <span class="flex-1">
        <span class="block text-base">{{ r.name }}</span>
        <span v-if="r.model" class="block text-sm text-text-sub">{{ r.model }}</span>
      </span>
    </button>
  </div>
</template>
```

- [ ] **Step 3: typecheck** — `pnpm --filter @desksoul/desktop typecheck` 干净。
- [ ] **Step 4: 提交** — `git commit -m "feat(desktop): KeyInput + ProviderList components (§7.3)"`

---

## Task 7: `ModelApiPage.vue` 双栏 + 预算卡 + 离线卡

**Files:** Create `src/renderer/settings/pages/ModelApiPage.vue`

- [ ] **Step 1: 双栏骨架 + provider.\* 调用 + prefs 绑定**

要点（沿用 GeneralPage/PrivacyPage 的 `onMounted getAll` + `set` 范式）：
- `onMounted`：`provider.listProviders` → rows；`app.prefs.getAll` → prefs（取 `model.activeProvider/activeModel` + `budget.*` + `offline.*`）；若 `ollama` 在列，`provider.ollamaDetect` 补 models/可用。
- 左栏 `<ProviderList :rows :active-id="prefs['model.activeProvider']" @select="onSelect" />`。
- `onSelect(id)`：`set('model.activeProvider', id)`；记 `activeId`。
- 右栏（选中 provider）：
  - 标题 `name · format`
  - `<KeyInput :has-key @save="(k)=>saveKey(id,k)" @clear="clearKey(id)" />` → `provider.saveKey/deleteKey` 后刷新 `hasKey`。
  - Endpoint：dialect `baseUrl` 只读灰字（存而不接覆盖）。
  - 默认模型：`<Select>` options = 该 provider models（`provider.listModels`），`@update` → `set('model.activeModel', v)`。
  - `[测试连接]`：`provider.testConnection` → 存 `lastTestOk` 驱动点色 + toast。
- 页底 `<SettingSection title="预算与告警">`：`budget.enabled`(Switch)/`budget.monthlyCap`(数字)/已使用占位 `¥0.00`/`budget.warnAt`(Slider 翼标)/`budget.onExceed`(Select 提醒|提醒并暂停)，全 `set` 持久。
- `<SettingSection title="离线兜底">`：`offline.fallbackMode`(三选一 RadioGroup 或 Select：ollama/demo/error) + `offline.ollamaModel`(Select)，`set` 持久。

> 完整 SFC 较长，按上述结构 + 复用 `SettingSection/SettingCard/Switch/Select/Slider/ProviderList/KeyInput` 实现；Key/Endpoint/模型在右栏，预算/离线在页底。`emit('saved')` 触发顶栏 toast（与 D2/D6 一致）。

- [ ] **Step 2: typecheck** — 干净。
- [ ] **Step 3: 提交** — `git commit -m "feat(desktop): D3 model API two-pane panel + budget/offline cards (§7.3)"`

---

## Task 8: App.vue 接入 D3 + nav 空组可点

**Files:** Modify `src/renderer/settings/App.vue`

- [ ] **Step 1: import + active 分支**

```ts
import ModelApiPage from './pages/ModelApiPage.vue';
```

`<main>` 内加分支（在占位 `v-else` 前）：

```vue
        <ModelApiPage v-else-if="active === 'model'" @saved="saved" />
```

- [ ] **Step 2: 空 children 组标题可点**（闭合 P3 残留「带图标不可点组」）

把 `<nav>` 里组标题 `<div>` 改为：有 children → 原样不可点小标题；无 children → 可点 button（`active=g.id`、复用高亮态）。

```vue
      <template v-for="g in NAV_TREE" :key="g.id">
        <button
          v-if="g.children.length === 0"
          class="flex w-full items-center gap-2 rounded-btn px-2 py-2 text-left text-base"
          :class="isActive(g.id, active) ? 'text-text-main' : 'text-text-sub'"
          :style="isActive(g.id, active) ? 'background: var(--ds-glass-border)' : ''"
          @click="active = g.id"
        >
          <component :is="g.icon" :size="16" :stroke-width="1.5" />
          <span>{{ g.label }}</span>
        </button>
        <div v-else class="flex items-center gap-2 px-2 py-1 text-sm text-text-sub">
          <component :is="g.icon" :size="16" :stroke-width="1.5" />
          <span>{{ g.label }}</span>
        </div>
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
```

> 总览/插件/知识库点击后仍落占位「留待 M7b」，但**可点了**——nav 语义统一（空组=可点叶子）。

- [ ] **Step 3: typecheck + 提交** — typecheck 干净；`git commit -m "feat(desktop): wire D3 model page + clickable empty nav groups"`

---

## Task 9: 视觉闭环 + 全量回归 + RESULTS P4

**Files:** Modify `apps/desktop/RESULTS-M7b1.md`

- [ ] **Step 1: 视觉闭环**（按 harness Runbook）

`pnpm --filter @desksoul/desktop dev` → Playwright MCP 截 `?page=model`，浅/深双版，1080×720 → `Read` 比对 **`UI/1d7669e3` + §7.3**（双栏：左 provider 列表+状态点 / 右 Key+Endpoint+模型选择+测试连接 / 页底预算+离线卡）+ §2 token。逐项修偏差（优先调已复用件，勿引入散装样式）。重截收敛到「够像」。

- [ ] **Step 2: 全量回归** — `pnpm --filter @desksoul/sidecar build` 后 `pnpm --filter @desksoul/desktop test`。Expected: 262 + 新增（provider-status 3 / key-reveal ~4 / chat-resolve 3 / context-assembler +1）≈ **273 绿，0 回归**。`pnpm typecheck` 全绿。

- [ ] **Step 3: RESULTS + prettier** — RESULTS-M7b1.md 追加 P4 段（task 表 / chat 集成做实 / 视觉比对 / 残留：存而不接预算计量·离线行为·Endpoint 覆盖，留后续自定义 provider 等 / 真 Electron 终审仍 P5）；prettier 仅本阶段新写文件。
- [ ] **Step 4: 提交** — `git commit -m "docs(m7b1): RESULTS P4 (D3 model API + chat integration + visual pass)"`

---

## Self-Review（写后自查）

- **spec 覆盖**：D3 复用 provider.*（T6/T7）✓；新增 active prefs 已存 schema、选中即 set（T7）✓；chat.send 动态解析 resolveModel（T3/4/5）✓；ProviderList/KeyInput/provider-status/key-reveal（T1/2/6）✓；ChatService resolveModel 测（T4 纯函数）✓；nav `model`→D3（T8）✓；预算/离线（T7，存而不接）✓。**未覆盖且明确留后续**：app.openExternal（P5）、自定义 provider/高级/覆盖持久化（范围段已声明）。
- **类型一致**：`resolveModel(): {providerId?,model?}` 在 ChatServiceOptions / ipc-router / resolveSendTarget 三处签名一致 ✓；`providerDot` 入参 `{hasKey,lastTestOk?}` 在 provider-status / ProviderList Row 一致 ✓。
- **placeholder 扫描**：T1–T5 + T8 给全代码；T6/T7 SFC 给结构 + 关键片段（页面级 SFC 较长，按复用件组合，符合 D2/D6 已验范式）——执行时若需逐字，参照 PrivacyPage.vue。

---

## 执行交接

Plan 已存 `docs/plans/2026-06-18-m7b1-p4-d3-chat-plan.md`。**执行用 `superpowers:executing-plans` inline 逐 task**（本仓 subagent 429 限流，不走 subagent-driven）。验收硬门槛：273 绿 + typecheck + D3 视觉对照 `1d7669e3`/§7.3 够像 + 「配真实 Key→overlay 发消息听到该 provider 流式回复」的 90s 旅程（可留 P5 真 Electron 一起目视）。
