# M7b-2 P4 C3 角色选择 + demo 台词池 + 视觉保真 + 收尾 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans（或 subagent-driven-development）逐 task 实现。步骤用 `- [ ]`。

**Goal:** 填完 C3 角色选择（默认角色 + 浏览禁用）、把 demo 后端扩成趣味台词池（跳过配 Key 也能听到回复 + 表情）、对照设计图做视觉保真 pass、写 RESULTS 收尾。

**Architecture:** demo 复用既有"无 provider → 空链 → mock-provider"路径（ChatService 已实现）；只把单条脚本扩成台词池 + worker-entry 按轮次轮换（模块计数器）。C3 单角色降级。视觉对照 `d63b4f97`(C1/C2)+`98171885`(C3/C4)。

**Tech Stack:** Vue 3、TS strict、worker_threads（sidecar provider worker）、behavior-parser 标签、Vitest。

**关联 spec:** [`../spec.md`](../spec.md)（§7 **P4**；§2.5 demo、§1 OUT 的 C3 降级）。**前置：P1–P3 已落**（引导壳 + C1/C2/C4 + ProviderConfigPanel）。

**测试运行：** sidecar `pnpm --filter @desksoul/sidecar exec vitest run test/<f>.test.ts`；desktop `pnpm --filter @desksoul/desktop exec vitest run test/<f>.test.ts`；改 sidecar 后 `pnpm --filter @desksoul/sidecar build`；全量见各 filter。每 task 末提交。

---

## 文件结构
- 改 `apps/desktop/src/renderer/onboarding/steps/Step3Character.vue`（占位 → C3 实页）
- 改 `apps/sidecar/src/workers/mock-provider.ts`（+`DEMO_SCRIPTS` + `pickDemoScript`）
- 改 `apps/sidecar/src/workers/provider-worker-entry.ts`（空链 mock 走台词池轮换）
- 测试：`apps/sidecar/test/mock-provider.test.ts`(追加)
- 收尾：新 `docs/milestones/M7b-2/RESULTS.md`；改 `docs/status/CURRENT.md`、`docs/milestones/M7b-2/README.md`

---

## Task 1: C3 角色选择实页 Step3Character

**Files:** Modify `apps/desktop/src/renderer/onboarding/steps/Step3Character.vue`（替换 P2 占位）

> 降级（spec §1 OUT）：单角色 `default`；「看看其他角色」禁用 + tooltip（E1 角色库留 V1）。立绘取 `character.current` 的 name，缺资源用占位插画块（不阻塞）。

- [ ] **Step 1: 实现 C3**

```vue
<!-- apps/desktop/src/renderer/onboarding/steps/Step3Character.vue — C3 角色选择（ui-design §7.3；视觉 98171885 C3 区）
     默认伙伴「小灵」+ 就用 TA→；「看看其他角色」禁用（E1 角色库 V1，spec §1 OUT）。 -->
<script setup lang="ts">
import { onMounted, ref } from 'vue';

const emit = defineEmits<{ next: [] }>();
const name = ref('小灵');
const META = '元气治愈系 · VRM 1.0 · 少女音 A';

onMounted(async () => {
  try {
    const c = (await window.desksoul.rpc('character.current', {})) as { manifest?: { name?: string } };
    if (c.manifest?.name) name.value = c.manifest.name;
  } catch {
    /* 读不到 manifest → 保留默认名（不阻塞引导） */
  }
});
</script>
<template>
  <div class="flex h-full flex-col">
    <div class="min-h-0 flex-1">
      <div class="text-md text-text-main">选一个伙伴</div>
      <!-- 立绘占位块（VRM 立绘渲染留后续；占位不阻塞流程） -->
      <div
        class="mx-auto mt-4 flex h-[220px] w-[160px] items-center justify-center rounded-card text-5xl"
        style="background: linear-gradient(160deg, var(--ds-brand-from), var(--ds-brand-to)); opacity: 0.85"
        aria-hidden="true"
      >
        🧚
      </div>
      <div class="mt-3 text-center text-md text-text-main">{{ name }}</div>
      <div class="mt-1 text-center text-sm text-text-sub">{{ META }}</div>
    </div>

    <div class="mt-6 flex items-center justify-center gap-3">
      <button
        class="rounded-btn border border-glass-border px-4 py-2 text-base text-text-sub opacity-50"
        disabled
        title="角色库即将开放"
      >
        看看其他角色 →
      </button>
      <button
        class="rounded-btn px-5 py-2 text-base text-white"
        style="background: linear-gradient(90deg, var(--ds-brand-from), var(--ds-brand-to))"
        @click="emit('next')"
      >
        就用 TA →
      </button>
    </div>
  </div>
</template>
```

- [ ] **Step 2: typecheck + 视觉自检**

Run:
```bash
pnpm --filter @desksoul/desktop typecheck
pnpm exec prettier --write apps/desktop/src/renderer/onboarding/steps/Step3Character.vue
```
Expected: typecheck 干净。`pnpm --filter @desksoul/desktop dev` 开 `…/onboarding/index.html?step=character`，对照 `UI/98171885`（C3 区）确认默认角色卡 + 两按钮（浏览禁用带 tooltip）。

- [ ] **Step 3: 提交**

```bash
git add apps/desktop/src/renderer/onboarding/steps/Step3Character.vue
git commit -m "feat(onboarding): C3 character select (default companion + browse disabled)"
```

---

## Task 2: demo 台词池 `DEMO_SCRIPTS` + `pickDemoScript`

**Files:** Modify `apps/sidecar/src/workers/mock-provider.ts`；Test `apps/sidecar/test/mock-provider.test.ts`

> 保持 `MOCK_SCRIPT` 与 `mockProviderChat` 行为不变（既有 3 用例继续绿）；新增池 + 轮换纯函数。`DEMO_SCRIPTS[0] === MOCK_SCRIPT`，保证轮换首条与原默认一致。

- [ ] **Step 1: 追加失败测试**

```ts
// apps/sidecar/test/mock-provider.test.ts — 追加（保留既有 describe）
import { DEMO_SCRIPTS, pickDemoScript } from '../src/workers/mock-provider';

describe('demo 台词池（M7b-2 跳过演示）', () => {
  it('DEMO_SCRIPTS[0] 即 MOCK_SCRIPT（默认不回归）', () => {
    expect(DEMO_SCRIPTS[0]).toBe(MOCK_SCRIPT);
  });
  it('pickDemoScript 按 index 轮换 + 回绕', () => {
    expect(pickDemoScript(0)).toBe(DEMO_SCRIPTS[0]);
    expect(pickDemoScript(1)).toBe(DEMO_SCRIPTS[1]);
    expect(pickDemoScript(DEMO_SCRIPTS.length)).toBe(DEMO_SCRIPTS[0]);
  });
  it('每条台词含 intent + 至少一个行为标签（驱动表情/动作）', () => {
    for (const s of DEMO_SCRIPTS) {
      const joined = s.join('');
      expect(joined).toMatch(/\[intent /);
      expect(joined).toMatch(/<(emo|act):/);
    }
  });
});
```

> 注：`MOCK_SCRIPT` 已在文件顶部 import。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @desksoul/sidecar exec vitest run test/mock-provider.test.ts`
Expected: FAIL — `DEMO_SCRIPTS` / `pickDemoScript` 未导出。

- [ ] **Step 3: 实现（在 mock-provider.ts 的 `MOCK_SCRIPT` 定义之后追加）**

```ts
/**
 * 演示模式台词池（M7b-2）：跳过配 Key → 无 active provider → ChatService 空链 →
 * 本 mock 流式推送。每条含 intent + emo/act 标签，驱动表情/动作。第 0 条 = MOCK_SCRIPT
 * （保证默认/既有行为不变）。worker-entry 按轮次 pickDemoScript 轮换，避免每轮同一句。
 */
export const DEMO_SCRIPTS: readonly (readonly string[])[] = [
  MOCK_SCRIPT,
  [
    '[intent mood=happy energy=high]\n',
    '嘿嘿<emo:happy/>',
    '今天也要',
    '<act:wave dur=1200/>',
    '元气满满哦！',
  ],
  [
    '[intent mood=curious energy=mid]\n',
    '唔…<emo:shy/>',
    '你想和我聊点什么呢？',
    '<act:fidget dur=1000/>',
    '我在认真听~',
  ],
];

/** 按轮次取一条台词（回绕；负数也安全）。 */
export function pickDemoScript(index: number): readonly string[] {
  const n = DEMO_SCRIPTS.length;
  return DEMO_SCRIPTS[((index % n) + n) % n]!;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @desksoul/sidecar exec vitest run test/mock-provider.test.ts`
Expected: PASS（既有 3 + 新增 3）。

- [ ] **Step 5: 提交**

```bash
git add apps/sidecar/src/workers/mock-provider.ts apps/sidecar/test/mock-provider.test.ts
git commit -m "feat(sidecar): demo script pool + pickDemoScript rotation (mock unchanged at index 0)"
```

---

## Task 3: worker-entry 空链 mock 走台词池轮换

**Files:** Modify `apps/sidecar/src/workers/provider-worker-entry.ts`

> 既有 `provider-worker-entry.test.ts` 只断言 `done` 的 finishReason（不校验 delta 内容），且首轮 `pickDemoScript(0)===MOCK_SCRIPT` → 不回归。

- [ ] **Step 1: 改 import + 加轮换计数器**

import 区把 mock-provider import 改为带 pickDemoScript：
```ts
import { mockProviderChat, pickDemoScript } from './mock-provider.js';
```
在 `attachProviderServer` 之上（模块作用域）加：
```ts
// 演示模式（空链 mock）按轮次轮换台词，避免每轮同一句。
let demoTurn = 0;
```

- [ ] **Step 2: 改 runStream 的 mock 分支用台词池**

把 `runStream` 内的三元 else 分支：
```ts
        : mockProviderChat(
            ac.signal,
            start.intervalMs !== undefined ? { intervalMs: start.intervalMs } : {},
          );
```
替换为：
```ts
        : mockProviderChat(ac.signal, {
            script: pickDemoScript(demoTurn++),
            ...(start.intervalMs !== undefined ? { intervalMs: start.intervalMs } : {}),
          });
```

- [ ] **Step 3: 跑测试（worker-entry 不回归）+ sidecar 全量 + 重建 dist**

Run:
```bash
pnpm --filter @desksoul/sidecar exec vitest run test/provider-worker-entry.test.ts
pnpm --filter @desksoul/sidecar test
pnpm --filter @desksoul/sidecar build
pnpm exec prettier --write apps/sidecar/src/workers/provider-worker-entry.ts
```
Expected: worker-entry PASS（done/cancel 断言不受台词内容影响）；sidecar 全量绿；build exit 0（desktop 运行时用 sidecar dist 的 worker entry）。

- [ ] **Step 4: 提交**

```bash
git add apps/sidecar/src/workers/provider-worker-entry.ts
git commit -m "feat(sidecar): rotate demo scripts on empty-chain mock path"
```

---

## Task 4: 视觉保真 pass（对照设计图，记残留）

**Files:** （无代码改动；偏差修复按需建微 task，结果记 RESULTS）

- [ ] **Step 1: 起 dev + 逐屏对照**

Run: `pnpm --filter @desksoul/desktop dev`。逐一打开并对照：
- `…/onboarding/index.html?step=welcome` ↔ `UI/d63b4f97-….png`（C1 区）
- `…/onboarding/index.html?step=model` ↔ `UI/d63b4f97-….png`（C2 区）
- `…/onboarding/index.html?step=character` ↔ `UI/98171885-….png`（C3 区）
- `…/onboarding/index.html?step=firstchat` ↔ `UI/98171885-….png`（C4 区）
- `…/onboarding/index.html?step=done`（完成页，§7.4 终页）

逐项核 §2 token：玻璃 `backdrop-filter` / 色阶（brand 渐变、text-main/sub）/ 字号阶梯 / 圆角（card/btn）/ 间距栅格 / 过渡缓动。

- [ ] **Step 2: 偏差修复（如需）**

对明显偏差（间距/字号/圆角/对齐）建最小 polish commit；与设计图差异较大但属未建依赖（A2 气泡/B1 浮层/真实立绘）的，**不修**——记为 RESULTS 残留（已属 spec §1 OUT）。

- [ ] **Step 3: 提交（若有 polish）**

```bash
git add apps/desktop/src/renderer/onboarding/
git commit -m "style(onboarding): visual fidelity polish vs d63b4f97/98171885"
```

---

## Task 5: 收尾 RESULTS + CURRENT + README

**Files:** Create `docs/milestones/M7b-2/RESULTS.md`；Modify `docs/status/CURRENT.md`、`docs/milestones/M7b-2/README.md`

- [ ] **Step 1: 全量回归 + 构建（取最终测试数）**

Run:
```bash
pnpm --filter @desksoul/protocol test
pnpm --filter @desksoul/sidecar test
pnpm --filter @desksoul/desktop typecheck
pnpm --filter @desksoul/desktop test
pnpm --filter @desksoul/desktop build
```
Expected: 全绿 + build exit 0。记下各 package 最终测试数填入 RESULTS。

- [ ] **Step 2: 写 RESULTS.md**

```markdown
# M7b-2 交付结果（RESULTS）

> spec [`spec.md`](spec.md) · plans [`plans/`](plans/)。C 系列首启引导（C1–C4 务实降级 + 最小 demo 后端）。

## 摘要
- 第 4 个 `onboarding` renderer 窗（480×600，角色左侧，sandbox:true）+ 首启检测（`onboarding.completed`）+ `app.window.finishOnboarding` 编排 RPC。
- C1 欢迎 / C2 LLM 配置（复用 `ProviderConfigPanel`，D3 改用不回归）/ C3 角色选择（默认角色 + 浏览禁用）/ C4 首句（chip→overlay `chat.send`）+ 完成页。
- demo：`mock-provider` 台词池 + worker-entry 轮换；跳过配 Key → 空链 → 听到回复 + 表情驱动。

## 测试
- protocol <N> / sidecar <N> / desktop <N>；typecheck 干净；build exit 0。
- 新增纯逻辑：`startup`/`onboarding-service`/`wizard`/`chips`/`provider-config-view`/`pickDemoScript`。

## 阶段
- P1 地基：prefs + finishOnboarding + decideStartup + 引导窗 + 脚手架。
- P2 壳+C1+C4：wizard/chips + 指示器/跳过 + 欢迎/首句/完成页。
- P3 C2：抽 ProviderConfigPanel（D3 复用）+ C2 两路径 + 隐私条 + 跳过演示。
- P4 C3+demo+保真：默认角色 + 浏览禁用 + 台词池轮换 + 视觉 pass。

## 残留（已属 spec §1 OUT，留后续）
- A2 桌面气泡（C1 欢迎气泡）→ M8；C4 真·B1 玻璃聊天浮层 → M8（现复用 overlay）。
- E1 角色库浏览闭环 → V1（C3「看看其他角色」禁用）。
- C3 真实 VRM 立绘 → 后续（现占位插画块）。
- demo 模式与 `offline.fallbackMode` 的 J4 正式联动 → 后续。
- 完成页「Ctrl+Shift+D 呼叫」文案对齐设计，热键录制器/呼叫热键正式入口在 M8（J2）。

## 人工硬门槛（PM/实现无法代劳，留人工冒烟终审）
- 真 Electron 首启：`onboarding.completed=false` → character 显示 + 引导窗出现在角色左侧；走 C1→C4；完成后 overlay 显示且 `onboarding.completed=true` 持久（重启不再弹）。
- 真 Key → C4 发 chip → 听到流式回复 + 表情；跳过演示 → demo 台词池回复 + 表情。
- 逐屏对照 `d63b4f97`(C1/C2) + `98171885`(C3/C4)。
- 通过后由 PM 打 code-done / 收官 tag（同 M7b-1 流程）。
```

> 填 `<N>` 为 Step 1 实测数。

- [ ] **Step 3: 更新 CURRENT.md（路线图 M7b-2 行 + 一句话现状）**

把 §3 路线图 M7b-2 行状态改为 `🚧 代码完成 + PM 待复核（真窗/真 Key 人工）`；§1 一句话现状补一句 M7b-2 代码完成。（具体措辞由 PM 收口；实现者填实测数即可。）

- [ ] **Step 4: 更新 M7b-2 README 阶段链状态为 ✅（带测试数）**

- [ ] **Step 5: 提交**

```bash
git add docs/milestones/M7b-2/RESULTS.md docs/milestones/M7b-2/README.md docs/status/CURRENT.md
git commit -m "docs(m7b-2): RESULTS + status (code complete; real-window/key pending human)"
```

> **PM 交接**：代码完成后通知 PM 复核（读码审计 + 视觉对照），由 PM 打 `mvp/M7b2-code-done`；真窗冒烟 + 真 Key 端到端由人工跑（同 M7b-1），通过后 PM 打收官 tag `mvp/M7b2-done`。

---

## Self-Review（plan vs spec P4）
- **spec §1 OUT / C3 降级**：T1 默认角色 + 「看看其他角色」禁用 + tooltip + 立绘占位 ✓。
- **spec §2.5 demo 最小后端**：T2 台词池 + pickDemoScript（[0]=MOCK_SCRIPT 不回归）+ T3 worker-entry 空链轮换（既有测试只验 done，不回归）✓。
- **spec §6 视觉对照**：T4 逐屏对照 d63b4f97/98171885 + §2 token，残留记 RESULTS ✓。
- **spec §6 收尾**：T5 RESULTS + CURRENT + README + 人工硬门槛声明 + PM tag 交接 ✓。
- **占位符**：T1 SFC 完整；RESULTS 模板的 `<N>` 是明确"填实测数"指示（非计划占位符）✓。
- **类型一致**：`DEMO_SCRIPTS`/`pickDemoScript`(T2) ↔ worker-entry import(T3) 一致；`character.current` 结果读 `manifest.name`(T1) ↔ 既有 `LoadedCharacter` 形状一致；行为标签格式 `[intent ...]`/`<emo:NAME/>`/`<act:NAME dur=N/>`(T2) ↔ behavior-parser 解析契约一致（沿用 MOCK_SCRIPT 词法）✓。
- **回归点**：sidecar 改后必 `build`（desktop 运行时用其 dist worker entry）；mock-provider 默认行为 + worker-entry done/cancel 断言不变。
- **依赖顺序**：T1（C3）独立；T2→T3（demo 池→轮换接线）；T4/T5 最后（保真 + 收尾）。
