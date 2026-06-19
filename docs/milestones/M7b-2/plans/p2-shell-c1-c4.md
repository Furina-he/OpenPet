# M7b-2 P2 引导壳 + C1 + C4 骨架 Implementation Plan（wizard 状态机 + 步骤指示器/跳过 + 欢迎页 + 首句互动 + 完成页）

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans（或 subagent-driven-development）逐 task 实现。步骤用 `- [ ]`。

**Goal:** 把 P1 的空引导壳填成可走通的骨架——4 步指示器 + 跳过确认 + C1 欢迎 + C4 首句互动（chip→`chat.send`）+ 完成页（→`finishOnboarding`），C2/C3 先留占位（P3/P4 填）。

**Architecture:** 纯逻辑下沉 `wizard.ts`（步骤状态机，pure reducer）+ `chips.ts`（启动话术集），单测覆盖；SFC 薄渲染（不引入 @vue/test-utils），靠 typecheck + dev 视觉 harness（`?step=`）。复用 M7a/M7b-1 组件（Select/ConfirmDialog + token 玻璃样式）。

**Tech Stack:** Vue 3 `<script setup>`、TS strict、Tailwind/设计 token、Vitest。

**关联 spec:** [`../spec.md`](../spec.md)（§7 的 **P2**；§2.4 C4 复用 overlay、§2.7 组件/模块）。**前置：P1 已落**（引导窗 + finishOnboarding RPC + 脚手架）。

**测试运行：** desktop `pnpm --filter @desksoul/desktop exec vitest run test/<f>.test.ts`；typecheck `pnpm --filter @desksoul/desktop typecheck`；dev 视觉 `pnpm --filter @desksoul/desktop dev` 后开 `onboarding/index.html?step=welcome`。每 task 末提交。

---

## 文件结构
- 新 `apps/desktop/src/renderer/onboarding/wizard.ts`（步骤状态机，pure）
- 新 `apps/desktop/src/renderer/onboarding/chips.ts`（C4 启动话术）
- 改 `apps/desktop/src/renderer/onboarding/App.vue`（引导壳：指示器 + 跳过 + 步骤路由）
- 新 `apps/desktop/src/renderer/onboarding/steps/{Step1Welcome,Step4FirstChat,StepDone}.vue`
- 新 `apps/desktop/src/renderer/onboarding/steps/{Step2Model,Step3Character}.vue`（P2 仅占位，P3/P4 填充）
- 测试：`apps/desktop/test/onboarding/{wizard,chips}.test.ts`(新)

---

## Task 1: wizard 状态机（pure）

**Files:** Create `apps/desktop/src/renderer/onboarding/wizard.ts`；Test `apps/desktop/test/onboarding/wizard.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// apps/desktop/test/onboarding/wizard.test.ts
import { describe, it, expect } from 'vitest';
import {
  STEPS,
  initialWizard,
  next,
  back,
  currentStep,
  stepNumber,
  wizardFromStep,
} from '../../src/renderer/onboarding/wizard';

describe('onboarding wizard 状态机', () => {
  it('STEPS = 欢迎/模型/角色/首句（4 步指示器）', () => {
    expect(STEPS).toEqual(['welcome', 'model', 'character', 'firstchat']);
  });
  it('next 逐步前进：welcome→model→character→firstchat→finished(完成页)', () => {
    let s = initialWizard;
    expect(currentStep(s)).toBe('welcome');
    s = next(s);
    expect(currentStep(s)).toBe('model');
    s = next(s);
    expect(currentStep(s)).toBe('character');
    s = next(s);
    expect(currentStep(s)).toBe('firstchat');
    s = next(s);
    expect(s.finished).toBe(true);
    expect(next(s)).toEqual(s); // finished 后 next 幂等
  });
  it('back 逆行；从完成页 back 回 firstchat', () => {
    const finished = { stepIndex: 3, finished: true };
    expect(back(finished)).toEqual({ stepIndex: 3, finished: false });
    expect(back({ stepIndex: 1, finished: false })).toEqual({ stepIndex: 0, finished: false });
    expect(back(initialWizard)).toEqual(initialWizard); // 首步 back 幂等
  });
  it('stepNumber 为 1-based（指示器用）', () => {
    expect(stepNumber(initialWizard)).toBe(1);
    expect(stepNumber({ stepIndex: 3, finished: false })).toBe(4);
  });
  it('wizardFromStep 支持 ?step= harness（含 done）', () => {
    expect(wizardFromStep('character')).toEqual({ stepIndex: 2, finished: false });
    expect(wizardFromStep('done')).toEqual({ stepIndex: 3, finished: true });
    expect(wizardFromStep(null)).toEqual(initialWizard);
    expect(wizardFromStep('bogus')).toEqual(initialWizard);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @desksoul/desktop exec vitest run test/onboarding/wizard.test.ts`
Expected: FAIL — cannot find module wizard。

- [ ] **Step 3: 实现**

```ts
// apps/desktop/src/renderer/onboarding/wizard.ts
/**
 * 首启引导步骤状态机（纯函数，便于单测）。
 * 4 步指示器：welcome/model/character/firstchat；firstchat 之后是完成页（finished=true，
 * 不计入指示器）。next/back 为不可变 reducer，App.vue 持 ref<WizardState> 调用。
 */
export const STEPS = ['welcome', 'model', 'character', 'firstchat'] as const;
export type Step = (typeof STEPS)[number];

export interface WizardState {
  stepIndex: number;
  finished: boolean;
}

export const initialWizard: WizardState = { stepIndex: 0, finished: false };

export function next(s: WizardState): WizardState {
  if (s.finished) return s;
  if (s.stepIndex >= STEPS.length - 1) return { ...s, finished: true };
  return { ...s, stepIndex: s.stepIndex + 1 };
}

export function back(s: WizardState): WizardState {
  if (s.finished) return { ...s, finished: false };
  return { ...s, stepIndex: Math.max(0, s.stepIndex - 1) };
}

export function currentStep(s: WizardState): Step {
  return STEPS[s.stepIndex]!;
}

/** 1-based 步序，给指示器显示「第 N 步 / 共 4 步」。 */
export function stepNumber(s: WizardState): number {
  return s.stepIndex + 1;
}

/** dev harness：`?step=welcome|model|character|firstchat|done` → 初始态。 */
export function wizardFromStep(name: string | null): WizardState {
  if (name === 'done') return { stepIndex: STEPS.length - 1, finished: true };
  const i = STEPS.indexOf(name as Step);
  return i >= 0 ? { stepIndex: i, finished: false } : initialWizard;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @desksoul/desktop exec vitest run test/onboarding/wizard.test.ts`
Expected: PASS (5)

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/renderer/onboarding/wizard.ts apps/desktop/test/onboarding/wizard.test.ts
git commit -m "feat(onboarding): wizard step-machine (pure reducer + ?step harness)"
```

---

## Task 2: C4 启动话术 `chips.ts`

**Files:** Create `apps/desktop/src/renderer/onboarding/chips.ts`；Test `apps/desktop/test/onboarding/chips.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// apps/desktop/test/onboarding/chips.test.ts
import { describe, it, expect } from 'vitest';
import { STARTER_CHIPS } from '../../src/renderer/onboarding/chips';

describe('C4 启动话术 chips', () => {
  it('固定 3–5 条、非空、不重复（§7.4）', () => {
    expect(STARTER_CHIPS.length).toBeGreaterThanOrEqual(3);
    expect(STARTER_CHIPS.length).toBeLessThanOrEqual(5);
    expect(STARTER_CHIPS.every((c) => c.trim().length > 0)).toBe(true);
    expect(new Set(STARTER_CHIPS).size).toBe(STARTER_CHIPS.length);
  });
  it('含设计稿示例话术', () => {
    expect(STARTER_CHIPS).toContain('早安！');
    expect(STARTER_CHIPS).toContain('给我讲个笑话');
    expect(STARTER_CHIPS).toContain('你叫什么名字');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @desksoul/desktop exec vitest run test/onboarding/chips.test.ts`
Expected: FAIL — cannot find module chips。

- [ ] **Step 3: 实现**

```ts
// apps/desktop/src/renderer/onboarding/chips.ts
/** C4 首次互动通用启动话术（固定，不与角色绑定；ui-design §7.4）。 */
export const STARTER_CHIPS: readonly string[] = ['早安！', '给我讲个笑话', '你叫什么名字'];
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @desksoul/desktop exec vitest run test/onboarding/chips.test.ts`
Expected: PASS (2)

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/renderer/onboarding/chips.ts apps/desktop/test/onboarding/chips.test.ts
git commit -m "feat(onboarding): C4 starter chips"
```

---

## Task 3: 步骤占位组件（Step2Model / Step3Character，P3/P4 填充）

**Files:** Create `apps/desktop/src/renderer/onboarding/steps/Step2Model.vue`、`apps/desktop/src/renderer/onboarding/steps/Step3Character.vue`

> 先建占位，让 App.vue 的步骤路由能编译通过；P3 填 C2、P4 填 C3。

- [ ] **Step 1: 建 Step2Model 占位**

```vue
<!-- apps/desktop/src/renderer/onboarding/steps/Step2Model.vue — C2 占位（P3 填充） -->
<script setup lang="ts">
const emit = defineEmits<{ next: []; skip: [] }>();
</script>
<template>
  <div class="text-text-sub">
    C2 LLM 配置（P3 填充）
    <div class="mt-4 flex gap-2">
      <button class="rounded-btn px-4 py-2 text-base text-text-sub" @click="emit('skip')">
        暂时跳过 · 先和角色玩一下
      </button>
      <button
        class="rounded-btn px-4 py-2 text-base text-white"
        style="background: linear-gradient(90deg, var(--ds-brand-from), var(--ds-brand-to))"
        @click="emit('next')"
      >
        下一步 →
      </button>
    </div>
  </div>
</template>
```

- [ ] **Step 2: 建 Step3Character 占位**

```vue
<!-- apps/desktop/src/renderer/onboarding/steps/Step3Character.vue — C3 占位（P4 填充） -->
<script setup lang="ts">
const emit = defineEmits<{ next: [] }>();
</script>
<template>
  <div class="text-text-sub">
    C3 角色选择（P4 填充）
    <div class="mt-4">
      <button
        class="rounded-btn px-4 py-2 text-base text-white"
        style="background: linear-gradient(90deg, var(--ds-brand-from), var(--ds-brand-to))"
        @click="emit('next')"
      >
        就用 TA →
      </button>
    </div>
  </div>
</template>
```

- [ ] **Step 3: 提交**

```bash
git add apps/desktop/src/renderer/onboarding/steps/Step2Model.vue apps/desktop/src/renderer/onboarding/steps/Step3Character.vue
git commit -m "chore(onboarding): C2/C3 step placeholders (filled in P3/P4)"
```

---

## Task 4: C1 欢迎页 Step1Welcome

**Files:** Create `apps/desktop/src/renderer/onboarding/steps/Step1Welcome.vue`

- [ ] **Step 1: 实现（无单测；纯展示 + 一次 prefs.set 语言）**

```vue
<!-- apps/desktop/src/renderer/onboarding/steps/Step1Welcome.vue — C1 欢迎（ui-design §7.1；视觉 d63b4f97 C1 区） -->
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { Prefs } from '@desksoul/protocol';
import { DEFAULT_PREFS } from '@desksoul/protocol';
import Select from '../../components/Select.vue';

const emit = defineEmits<{ next: [] }>();
const language = ref<Prefs['general.language']>(DEFAULT_PREFS['general.language']);
const LANGS = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'en-US', label: 'English' },
];

onMounted(async () => {
  const prefs = (await window.desksoul.rpc('app.prefs.getAll', {})) as Prefs;
  language.value = prefs['general.language'];
});

async function setLanguage(v: string): Promise<void> {
  language.value = v;
  await window.desksoul.rpc('app.prefs.set', { key: 'general.language', value: v });
}
</script>
<template>
  <div class="flex h-full flex-col">
    <div class="flex-1">
      <div class="text-lg text-text-main">欢迎来到 DeskSoul</div>
      <p class="mt-2 text-base text-text-sub">接下来 90 秒，我们一起：</p>
      <ol class="mt-3 space-y-2 text-base text-text-main">
        <li>① 配置模型</li>
        <li>② 选角色</li>
        <li>③ 说第一句话</li>
      </ol>
    </div>
    <div class="mt-6 flex items-center justify-between">
      <div class="w-[160px]">
        <Select :model-value="language" :options="LANGS" @update:model-value="setLanguage" />
      </div>
      <button
        class="rounded-btn px-5 py-2 text-base text-white"
        style="background: linear-gradient(90deg, var(--ds-brand-from), var(--ds-brand-to))"
        @click="emit('next')"
      >
        开始 →
      </button>
    </div>
  </div>
</template>
```

- [ ] **Step 2: 提交**

```bash
git add apps/desktop/src/renderer/onboarding/steps/Step1Welcome.vue
git commit -m "feat(onboarding): C1 welcome step (90s intro + language)"
```

---

## Task 5: C4 首句互动 Step4FirstChat + 完成页 StepDone

**Files:** Create `apps/desktop/src/renderer/onboarding/steps/Step4FirstChat.vue`、`apps/desktop/src/renderer/onboarding/steps/StepDone.vue`

> C4 复用现有 overlay 会话（§2.4）：chip 点击 → `chat.send(sessionId:'default')`；回复流入 overlay（首启时 overlay 隐藏，完成页 `finishOnboarding` 后显示，届时含本轮对话）。配 Key 者走真 provider，跳过者无 active provider → 空链 → demo（P4 台词池）。

- [ ] **Step 1: 实现 Step4FirstChat**

```vue
<!-- apps/desktop/src/renderer/onboarding/steps/Step4FirstChat.vue — C4 首句（ui-design §7.4；视觉 98171885 C4 区） -->
<script setup lang="ts">
import { ref } from 'vue';
import { STARTER_CHIPS } from '../chips';

const emit = defineEmits<{ next: [] }>();
const sending = ref(false);

async function pick(chip: string): Promise<void> {
  if (sending.value) return;
  sending.value = true;
  try {
    // 复用现有 overlay 会话；回复在完成页 finishOnboarding 显示 overlay 后可见。
    await window.desksoul.rpc('chat.send', { sessionId: 'default', text: chip });
    emit('next');
  } catch {
    sending.value = false; // 发送失败（如忙）→ 允许重试
  }
}
</script>
<template>
  <div class="flex h-full flex-col">
    <div class="flex-1">
      <div class="text-md text-text-main">和 TA 说第一句话</div>
      <p class="mt-2 text-base text-text-sub">点一句开始（也可之后在聊天框自由输入）：</p>
      <div class="mt-4 flex flex-wrap gap-2">
        <button
          v-for="c in STARTER_CHIPS"
          :key="c"
          class="rounded-btn border border-glass-border px-4 py-2 text-base text-text-main disabled:opacity-50"
          :disabled="sending"
          @click="pick(c)"
        >
          {{ c }}
        </button>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 2: 实现 StepDone**

```vue
<!-- apps/desktop/src/renderer/onboarding/steps/StepDone.vue — 完成页（ui-design §7.4 终页） -->
<script setup lang="ts">
const emit = defineEmits<{ finish: [] }>();
// 快捷键提示文案对齐设计稿；Ctrl+Shift+D 呼叫 / 录制器为 M8（J2），本期仅文案。
const TIPS = ['Ctrl+Shift+D 随时呼叫我', '拖动我换个位置', '右键我可切换穿透 / 打开设置'];
</script>
<template>
  <div class="flex h-full flex-col">
    <div class="flex-1">
      <div class="text-lg text-text-main">✨ 准备好了！</div>
      <ul class="mt-4 space-y-2 text-base text-text-sub">
        <li v-for="t in TIPS" :key="t">· {{ t }}</li>
      </ul>
    </div>
    <div class="mt-6 flex justify-end">
      <button
        class="rounded-btn px-5 py-2 text-base text-white"
        style="background: linear-gradient(90deg, var(--ds-brand-from), var(--ds-brand-to))"
        @click="emit('finish')"
      >
        开始我们的故事 →
      </button>
    </div>
  </div>
</template>
```

- [ ] **Step 3: 提交**

```bash
git add apps/desktop/src/renderer/onboarding/steps/Step4FirstChat.vue apps/desktop/src/renderer/onboarding/steps/StepDone.vue
git commit -m "feat(onboarding): C4 first-chat (chip→chat.send) + done epilogue"
```

---

## Task 6: 引导壳 App.vue（指示器 + 跳过确认 + 步骤路由）

**Files:** Modify `apps/desktop/src/renderer/onboarding/App.vue`

- [ ] **Step 1: 实现引导壳**

```vue
<!-- apps/desktop/src/renderer/onboarding/App.vue — 引导壳（ui-design §7 贯穿壳：4 步指示器 + 跳过） -->
<script setup lang="ts">
import { ref } from 'vue';
import {
  STEPS,
  initialWizard,
  next as wizNext,
  currentStep,
  stepNumber,
  wizardFromStep,
  type WizardState,
} from './wizard';
import Step1Welcome from './steps/Step1Welcome.vue';
import Step2Model from './steps/Step2Model.vue';
import Step3Character from './steps/Step3Character.vue';
import Step4FirstChat from './steps/Step4FirstChat.vue';
import StepDone from './steps/StepDone.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';

const STEP_LABELS = ['欢迎', '模型', '角色', '互动'];

// dev harness：?step=welcome|model|character|firstchat|done
const wiz = ref<WizardState>(wizardFromStep(new URLSearchParams(window.location.search).get('step')));
const askSkip = ref(false);

function advance(): void {
  wiz.value = wizNext(wiz.value);
}
async function finish(): Promise<void> {
  await window.desksoul.rpc('app.window.finishOnboarding', {});
}
function confirmSkip(): void {
  askSkip.value = false;
  void finish();
}
</script>
<template>
  <div class="flex h-screen flex-col p-6 text-base" style="background: var(--ds-glass-bg)">
    <!-- 顶部：步骤指示器 + 跳过（完成页不显） -->
    <header v-if="!wiz.finished" class="mb-5 flex items-center justify-between">
      <div class="flex items-center gap-2">
        <template v-for="(label, i) in STEP_LABELS" :key="label">
          <span
            class="text-sm"
            :class="i + 1 === stepNumber(wiz) ? 'text-text-main' : 'text-text-sub'"
          >
            {{ i + 1 }} {{ label }}
          </span>
          <span v-if="i < STEP_LABELS.length - 1" class="text-text-sub">·</span>
        </template>
      </div>
      <button class="text-sm text-text-sub hover:text-text-main" @click="askSkip = true">
        跳过
      </button>
    </header>

    <!-- 步骤内容 -->
    <main class="min-h-0 flex-1">
      <Step1Welcome v-if="currentStep(wiz) === 'welcome' && !wiz.finished" @next="advance" />
      <Step2Model
        v-else-if="currentStep(wiz) === 'model' && !wiz.finished"
        @next="advance"
        @skip="advance"
      />
      <Step3Character
        v-else-if="currentStep(wiz) === 'character' && !wiz.finished"
        @next="advance"
      />
      <Step4FirstChat
        v-else-if="currentStep(wiz) === 'firstchat' && !wiz.finished"
        @next="advance"
      />
      <StepDone v-else @finish="finish" />
    </main>

    <ConfirmDialog
      :open="askSkip"
      title="跳过引导？"
      detail="跳过后默认角色仍可用，但你需要手动配置模型。"
      confirm-label="跳过引导"
      @confirm="confirmSkip"
      @cancel="askSkip = false"
    />
  </div>
</template>
```

> 说明：`STEPS` import 仅为类型/未来扩展保留；若 lint 报未用，去掉该项 import（保留其余）。Step2 的 `@skip` 与 `@next` 当前都走 `advance`——跳过演示=照常进 C3，demo 由"无 active provider→空链"自动触发（P4），无需特殊跳转。

- [ ] **Step 2: typecheck + 全量回归 + 格式**

Run:
```bash
pnpm --filter @desksoul/desktop typecheck
pnpm --filter @desksoul/desktop test
pnpm exec prettier --write apps/desktop/src/renderer/onboarding/
```
Expected: typecheck 干净；desktop 全量绿（新增 wizard/chips 用例）；prettier 无遗留。

- [ ] **Step 3: dev 视觉自检（对照 d63b4f97 C1 区）**

Run: `pnpm --filter @desksoul/desktop dev`，浏览器开 `…/onboarding/index.html?step=welcome`、`?step=firstchat`、`?step=done`，确认指示器/欢迎/chip/完成页渲染且玻璃 token 生效（精修留 P4 保真 pass）。

- [ ] **Step 4: 提交**

```bash
git add apps/desktop/src/renderer/onboarding/App.vue
git commit -m "feat(onboarding): shell (4-step indicator + skip confirm + step routing C1/C4)"
```

---

## Self-Review（plan vs spec P2）
- **spec §2.7 wizard 状态机 / chips**：T1（next/back/currentStep/stepNumber/harness）+ T2（启动话术）覆盖，pure 单测 ✓。
- **spec §7 引导壳（4 步指示器 + 跳过确认）**：T6 App.vue 指示器 + ConfirmDialog 跳过（文案对齐"跳过后默认角色仍可用…"）✓。
- **spec §7.1 C1**：T4 标题/90s 三步/开始→/语言下拉（一次 prefs.set）✓。
- **spec §2.4 + §7.4 C4 复用 overlay**：T5 chip→`chat.send(sessionId:'default')`；回复经 overlay（finishOnboarding 显示）；完成页→`finishOnboarding` ✓。
- **C2/C3 占位**：T3 给出可编译占位（P3/P4 替换），App 路由已接 ✓。
- **占位符**：步骤组件均含完整 SFC；占位（Step2/3）是有意的最小可编译版，P3/P4 明确填充——非计划占位符 ✓。
- **类型一致**：`WizardState`/`currentStep`/`stepNumber`/`wizardFromStep`(T1) ↔ App.vue 用法(T6) 一致；`STARTER_CHIPS`(T2) ↔ Step4(T5) 一致；emits（Step1 `next`、Step2 `next|skip`、Step3 `next`、Step4 `next`、StepDone `finish`）↔ App 监听(T6) 一一对应；`app.window.finishOnboarding`(P1 已注册) ↔ App/StepDone 调用一致 ✓。
- **依赖顺序**：T1/T2 先（App 与 Step4 引用）；T3 占位先于 T6（App import）；T4/T5 步骤组件先于或与 T6 同批（App import 全部 5 个步骤组件）——执行顺序 T1→T2→T3→T4→T5→T6。
- **回归点**：仅新增文件 + 改 onboarding/App.vue（P1 空壳）；不碰 settings/overlay/Main。@vue/test-utils 仍未引入。
