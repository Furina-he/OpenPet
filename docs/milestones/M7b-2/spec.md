# M7b-2 首次启动引导（C1–C4）设计（Spec）

| 版本 | 日期 | 状态 | 关联文档 |
| --- | --- | --- | --- |
| v0.1 | 2026-06-19 | Approved（brainstorming 收敛） | [M7b-1 spec](../M7b-1/spec.md) · [ui-design §7](../../design/ui-design.md) · [impl-plan §M7](../../design/impl-plan.md) |

> M7b 拆两片（已定）：M7b-1 = D 系列设置面板（已 `mvp/M7b1-code-done`）；**M7b-2 = C 系列首启引导（C1–C4），本文**。直接复用 M7b-1 的 provider-config 积木（ProviderList/KeyInput/`provider.*`）+ M7a 地基（PrefsStore + 组件库 + dev 视觉 harness）。

---

## 1. 目标与范围

**目标**：首次启动 **90 秒**内走通「看到角色 → 配 Key（或跳过演示）→ 听到 TA 说话 + 看表情驱动」，对齐 ui-design §7「90s 旅程」验收。

**范围（IN）**
- 第 4 个 renderer 窗口 `onboarding`（480×600 玻璃面板）+ 引导壳（4 步指示器 + 跳过确认）。
- C1 欢迎 / C2 LLM 配置（复用 D3 积木）/ C3 角色选择（默认角色路径）/ C4 首次互动（chip → 现有 overlay 发消息 → 流式回复 + 表情驱动）。
- 首启检测：新 prefs `onboarding.completed`；Main 启动按其值决定先 show 引导窗还是常规流程。
- 编排 RPC `app.window.finishOnboarding`（置 flag + 关引导窗 + 唤起 character/overlay）。
- 最小 demo 后端：扩 `mock-provider.ts` 为趣味台词池（含行为标签），复用现有"空链→mock"路径，跳过配 Key 也能听到回复 + 看表情。
- 各屏接 dev 视觉 harness（`?page=` + mock-bridge），对照 `UI/d63b4f97`（C1/C2）+ `UI/98171885`（C3/C4）+ §2 token。

**范围（OUT → 后续，务实降级）**
- **A2 桌面气泡**（C1 角色挥手旁的气泡）→ A 系列/M8；本期欢迎语只在引导窗内呈现。
- **E1 角色库浏览闭环**（C3「看看其他角色」→ Hub E1 → 设为当前 → 回引导）→ V1 角色管理；`character-service` 现为单角色 `default`。本期 C3「看看其他角色」按钮**禁用 + tooltip「角色库即将开放」**（保真保留、诚实标注）。
- **B1 玻璃聊天浮层** → M8；C4 复用现有 overlay 窗（M2 朴素聊天）承载首句对话。
- demo 模式的 **J4 离线兜底正式联动 / 计费**（M7b-1 已持久化 `offline.fallbackMode='demo'`，行为留后续）。
- `@vue/test-utils`（延续 M7a/M7b-1：逻辑下沉纯 TS，SFC 薄渲染）。

---

## 2. 架构决策

### 2.1 引导窗 = 第 4 个 renderer `onboarding`
- electron-vite renderer 已是多入口（character/overlay/settings）；新增 `onboarding` input + 新建 `src/renderer/onboarding/{index.html,main.ts,App.vue}`。
- 窗口：`480×600`，`sandbox:true`（非透明窗，可全沙箱，区别于 character 的 `sandbox:false`），`contextIsolation:true` / `nodeIntegration:false`，挂 `render-process-gone` 自愈（同 windows.ts 既有模式）。
- **定位（决策，偏离 §7 字面）**：ui-design §7 写"吸附角色右侧 24px"，但 character 窗默认在屏幕**右下角**，放其右侧会出屏。按 overlay 现有定位逻辑放角色**左侧** 24px（`x = workArea 右缘 − CHARACTER − margin − 480 − 24`，越界则贴右缘内侧），保证不出屏。
- 备选（否决）：复用 settings 窗换路由——settings 是 720×520 Hub chrome，与表单型引导壳形态不符。

### 2.2 首启检测 + 窗口编排
- 新 prefs `onboarding.completed`(boolean=false)。
- `index.ts` 启动：读 `getAll().['onboarding.completed']` → `false` 则 `onboarding.show()` 且**暂不自动 show overlay**；`true` 走常规流程（不创建/不显示引导窗）。character 窗照常显示（首启也要"看到角色"）。
- 引导完成 / 跳过完成 → renderer 调一次 `app.window.finishOnboarding` → Main 编排：`prefs.set('onboarding.completed', true)` + **hide 引导窗**（与 settings 窗 hide-on-close 一致；引导完成后不再触发，无需 destroy）+ 确保 character/overlay 就绪可见。renderer 不自己拼多步。

### 2.3 C2 复用 D3 provider-config（抽共享组件）
- 把 `ModelApiPage.vue` 的 provider-config 核心（左栏 ProviderList + 右栏 Key/Endpoint/默认模型/测试连接 + Ollama 检测）抽成共享 `components/ProviderConfigPanel.vue`（纯展示 + emit，prefs 读写由宿主页注入或内置）。
- D3 `ModelApiPage` 与 C2 `Step2Model` 同时引用，**D3 行为不回归**（抽取是重构，既有 provider-status / key-reveal 纯逻辑测继续覆盖）。
- C2 额外元素：两路径入口呈现（API Key / Ollama）、底部隐私条、`暂时跳过·先和角色玩一下`幽灵按钮。

### 2.4 C4 首句互动复用现有 overlay
- C4 chip（固定 3–5 条通用启动话术，不与角色绑定，逻辑下沉 `chips.ts`）→ 选中即向**现有 overlay 会话**发 `chat.send`（`sessionId='default'`）。
- 真 Key 已配 → `resolveModel()` 走真 provider 流式；跳过者无 active provider → ChatService 空链 → mock/demo 路径。
- 发送后引导窗呈现完成页（✨准备好了 + 快捷键提示 `Ctrl+Shift+D` / 拖动 / 右键穿透 + `开始我们的故事→`）→ 调 `finishOnboarding`。

### 2.5 最小 demo 后端
- **触发口径（决策）**：复用既有"无 provider 配置 → 空链 → mock-provider"路径（ChatService 已实现），**不引入显式 demo flag**。
- 扩 `apps/sidecar/src/workers/mock-provider.ts`：单条 `MOCK_SCRIPT` → **趣味台词池**（3–5 条，每条含 `[intent]` + `<emo>/<act>` 标签，对齐 behavior-parser），按轮次计数器轮换选一条（worker 内可用模块级计数器，避免每次同一句）。
- 保证"跳过配 Key → C4 发话 → 听到回复 + 看表情驱动"成立。

### 2.6 新增 RPC
- `app.window.finishOnboarding {}` → Main 编排（见 2.2），result `{ ok:true }`。在 `methods.ts` 注册 schema，ipc-router 加 handler。

### 2.7 新组件 / 模块
- `onboarding/App.vue`（引导壳：步骤指示器 + 跳过 + 当前步路由 C1–C4）。
- 步骤组件 `onboarding/steps/{Step1Welcome,Step2Model,Step3Character,Step4FirstChat,StepDone}.vue`（薄）。
- 共享 `components/ProviderConfigPanel.vue`（D3 + C2 复用，§2.3）。
- 纯逻辑下沉：`onboarding/wizard.ts`（步骤状态机：next/skip/back/canProceed）、`onboarding/chips.ts`（C4 启动话术集）。
- 复用 M7a/M7b-1：GlassPanel/Button/Switch/Select/Input/KeyInput/ProviderList/ConfirmDialog/ToastHost。

---

## 3. 数据流（90s 旅程）

```
启动（onboarding.completed=false）:
  index.ts → character.show() + onboarding.show()（overlay 暂不自动显示）
C1 欢迎: 开始→ → wizard.next()
C2 LLM 配置:
  路径①配 Key: ProviderConfigPanel → provider.saveKey + app.prefs.set model.activeProvider/activeModel + [测试连接]
  路径②Ollama: provider.ollamaDetect → 选本地模型
  跳过演示: wizard.skipToChat()（不配 provider → 后续走 demo 空链）
C3 角色选择: 「就用 TA→」 → wizard.next()（看看其他角色＝禁用）
C4 首次互动:
  chip 选中 → overlay chat.send(sessionId='default', text=chip)
   → 有 active provider: resolveModel()→真 provider 流式回复 + 表情
   → 无 provider（跳过者）: 空链 → mock-provider 趣味台词池 + 表情
  → StepDone（快捷键提示）→ app.window.finishOnboarding
finishOnboarding: prefs.set onboarding.completed=true + 关引导窗 + 确保 overlay/character 可见
```

---

## 4. 新增/改动文件
- **protocol**：`prefs.ts`（+`onboarding.completed`）、`methods.ts`（+`app.window.finishOnboarding`）
- **Main**：`index.ts`（首启判定 + 窗口编排）、`windows.ts`（+`onboarding` 窗 + 定位）、`ipc-router.ts`（`finishOnboarding` handler）
- **sidecar**：`workers/mock-provider.ts`（台词池 + 轮换）
- **Renderer**：新建 `src/renderer/onboarding/{index.html,main.ts,App.vue}` + `steps/{Step1Welcome,Step2Model,Step3Character,Step4FirstChat,StepDone}.vue` + `{wizard,chips}.ts`；抽 `components/ProviderConfigPanel.vue`（`ModelApiPage` 改用）；`electron.vite.config.ts`（+`onboarding` entry）
- **收尾**：`docs/milestones/M7b-2/{README,spec,plans/,RESULTS}`、`docs/status/CURRENT.md`、`CLAUDE.md`/`AGENTS.md` 状态行

---

## 5. 测试策略（TDD）
- **wizard 状态机**（核心）：next/back/skip/skipToChat/canProceed 流转 + 步骤边界。
- **chips**：固定集内容/数量约束。
- **demo 台词池轮换**（mock-provider）：注入计数器，断言连续多轮返回不同台词且各自含合法行为标签；`signal` 中断仍 `done(cancel)`（不回归既有 S4 行为）。
- **`app.window.finishOnboarding`**：注入假 `prefs.set` / 假窗口，断言三动作（置 flag + 关引导 + 显主界面）均触发。
- **首启判定**：注入 `onboarding.completed` true/false，断言 `index.ts` 启动分支（显引导 vs 常规）——逻辑下沉为可测纯函数（如 `decideStartup(prefs)`）。
- **ProviderConfigPanel 抽取不回归 D3**：既有 `provider-status` / `key-reveal` 纯逻辑测继续绿；desktop/protocol 既有测试数不回归。
- 页面薄，靠 typecheck + 视觉 harness 手动冒烟；不引入 `@vue/test-utils`。

---

## 6. 验收
- 首启（`onboarding.completed=false`）：character 显示 + 引导窗 480×600 出现在角色左侧；4 步指示器 + 跳过确认工作。
- C1→C4 流转；C2 复用 D3 provider-config（配 Key/选 model/测试连接）；跳过演示可达 C4。
- C3 默认「小灵」+「就用 TA」；「看看其他角色」禁用 + tooltip。立绘取 character manifest 现有资源，缺则占位插画（不阻塞）。
- C4：配 Key 者发 chip → 真 provider 流式回复 + 表情；跳过者 → demo 台词池回复 + 表情。
- 完成/跳过完成 → `finishOnboarding` → `onboarding.completed=true` 持久（**重启不再弹引导**）+ overlay 可用。
- 视觉对照 `d63b4f97`(C1/C2)+`98171885`(C3/C4) + §2 token（毛玻璃/色阶/字号/圆角/间距），偏差立 polish task 记 RESULTS。
- desktop/protocol 既有测试不回归；typecheck + prettier（仅新写文件/行）干净。
- RESULTS-M7b2 + CURRENT.md + CLAUDE/AGENTS 状态行（[[里程碑收尾清单]]）。

> **人工硬门槛**（同 M7b-1，PM/实现均无法代劳）：真 Electron GUI 跑首启引导逐屏对照设计图 + 真 Key→C4 听到流式回复 90s 端到端。代码完成后留人工冒烟终审，再打收官 tag。

---

## 7. 分阶段执行（建议，writing-plans 细化）
- **P1 地基**：`onboarding.completed` prefs + `app.window.finishOnboarding` RPC + 首启判定（`decideStartup`）+ `windows.ts` 加引导窗 + electron-vite entry + 空 `onboarding/App.vue` 壳（全 TDD/typecheck 绿，能 dev 启动看到空引导窗）。
- **P2 引导壳 + C1 + C4 骨架**：wizard 状态机 + 步骤指示器/跳过确认 + Step1Welcome + Step4FirstChat（chip→overlay chat.send）+ StepDone + chips。
- **P3 C2 复用 D3**：抽 `ProviderConfigPanel`（ModelApiPage 改用、D3 不回归）+ Step2Model（两路径 + 隐私条 + 跳过演示）。
- **P4 C3 + demo 后端 + 验收**：Step3Character（默认角色 + 禁用浏览）+ mock-provider 台词池 + 视觉保真 pass + RESULTS + 收尾。

---

## 8. 衔接
- A2 桌面气泡 / B1 玻璃聊天浮层在 **M8** 落地后，C1 欢迎气泡与 C4 聊天形态可回头升级。
- E1 角色库浏览闭环在 **V1 角色管理** 落地后，解禁 C3「看看其他角色」走完整闭环（§7 原始描述）。
- demo 模式在 **J4 离线兜底** 正式做时与 `offline.fallbackMode` 联动。
