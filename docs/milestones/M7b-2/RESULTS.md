# M7b-2 交付结果（RESULTS）

> spec [`spec.md`](spec.md) · plans [`plans/`](plans/)。C 系列首启引导（C1–C4 务实降级 + 最小 demo 后端）。
> 分支 `feat/m7b2-onboarding`（自 `feat/m7b1-d-series` HEAD 切出，含全部 M7b-1 代码）。

## 摘要

- 第 4 个 `onboarding` renderer 窗（480×600，角色左侧，`sandbox:true` 非透明窗）+ 首启检测（`onboarding.completed` prefs + `decideStartup` 纯函数）+ `app.window.finishOnboarding` 编排 RPC（置 flag + 隐引导窗 + 显 overlay）。
- C1 欢迎（90s 三步 + 语言下拉）/ C2 LLM 配置（复用抽取的 `ProviderConfigPanel`，D3 `ModelApiPage` 改用不回归）/ C3 角色选择（默认伙伴「小灵」+ 浏览禁用）/ C4 首句（chip→overlay `chat.send`）+ 完成页（快捷键提示）。
- demo：`mock-provider` 台词池（`DEMO_SCRIPTS[0]===MOCK_SCRIPT` 不回归）+ worker-entry 按轮次 `pickDemoScript` 轮换；跳过配 Key → 空链 → 听到回复 + 表情驱动。

## 测试（最终全量）

- **protocol 180**（10 files）/ **sidecar 37**（12 files）/ **desktop 287**（50 files）；typecheck 干净；`pnpm --filter @desksoul/desktop build` **exit 0**（renderer 4 入口，产物含 `onboarding/index.html`）。
- 较 M7b-1 基线（protocol 178 / sidecar 34 / desktop 273）净增：protocol +2、sidecar +3、desktop +14。
- 新增纯逻辑单测：`startup`(2)/`onboarding-service`(2)/`wizard`(5)/`chips`(2)/`provider-config-view`(3)/`mock-provider` demo 池(3)。
- D3 不回归证据：`provider-status`(3)/`key-reveal`(4) 继续绿；`provider-worker-entry`(2) done/cancel 断言不受台词内容影响。

## 阶段

- **P1 地基**：`onboarding.completed` prefs + `app.window.finishOnboarding` RPC + `decideStartup` + 第 4 窗 + ipc/index 接线 + renderer 脚手架。
- **P2 壳 + C1 + C4**：`wizard` 状态机 + `chips` + 4 步指示器/跳过确认 + 欢迎/首句/完成页 + Step2/Step3 占位。
- **P3 C2**：抽 `provider-config-view` 纯助手 + 自包含 `ProviderConfigPanel`（D3 改用）+ C2 两路径 + 隐私条 + 跳过演示。
- **P4 C3 + demo + 保真**：默认角色 + 浏览禁用 + 台词池轮换 + 视觉静态核对 + 收尾。

## 视觉保真（P4-T4：静态核对，对照 `d63b4f97` C1/C2 + `98171885` C3/C4）

- **token 已逐项验证**：所有 onboarding SFC 仅用 §2 已定义 token（`tailwind.config.js` 的 colors/borderRadius/fontSize + tokens.css 的 `--ds-*` + `.ds-glass`），**无自创色阶/字号/圆角**；玻璃/品牌渐变/文本主次色均走真源。
- **结构差异（对照设计图）均属 spec §1 OUT 降级或计划设定的 MVP 简化，未做 polish**（见下「残留」）。
- **live 视觉闭环 + 真窗冒烟未由实现侧执行**：`dev` 脚本为 `electron-vite dev`（会在桌面拉起 Electron 窗），属人工硬门槛；实现侧仅做了静态对照 PNG + token 验证，**未跑 dev-server/Playwright 截图、未跑真透明窗**。逐屏 live 对照交 PM/人工（同 M7b-1 由 PM 跑 harness）。

## 残留（已属 spec §1 OUT 或计划设定，留后续）

- **A2 桌面气泡**（C1 欢迎气泡/角色立绘在引导窗内）→ M8；本期角色在独立 character 窗显示，引导窗内为文字欢迎。
- **C3 真实 VRM 立绘** → 后续；现为 emoji 占位块。设计图 C3 为「立绘左 + 档案面板右」双栏，本期为居中单栏。
- **E1 角色库浏览闭环** → V1；C3「看看其他角色」禁用 + tooltip「角色库即将开放」（设计图作「更换 TA」，本期诚实降级）。
- **B1 玻璃聊天浮层** → M8；C4 复用现有 overlay 承载首句对话。设计图 C4 为 chips + 完成卡同屏，本期按 wizard 流拆为 Step4（chips）→ StepDone（完成）两视图。
- **C2 两路径**：设计图为两张大选择卡 + 绿底隐私条；本期为文字提示 + 复用 D3 `ProviderConfigPanel`（左 provider 列表 + 右配置）+ 中性描边隐私条。
- **C4 启动话术**：设计图 4 条（含「随便聊聊」），本期 `STARTER_CHIPS` 为 3 条（spec §7.4「3–5 条」内）；完成页提示为文字列表，设计图为 KeyCap 样式。
- demo 模式与 `offline.fallbackMode='demo'` 的 J4 正式联动 / 计费 → 后续。
- 完成页「Ctrl+Shift+D 呼叫」为文案；呼叫热键/录制器正式入口在 M8（J2）。

## 偏离计划

- **分支**：新开 `feat/m7b2-onboarding`（计划授权执行者定），自当前 HEAD 切出。
- **prettier**：遵循项目约定「只格式化自己新写的文件、不 `--write` 存量文件」（CURRENT.md §5）——对存量 `windows.ts`/`ipc-router.ts`/`index.ts`/`electron.vite.config.ts`/`provider-worker-entry.ts` 未 `--write`（其 prettier --check 告警纯属工作树 CRLF，`git diff` 确认仅最小新增、无整文件 churn）；新建/重写文件（App.vue/ModelApiPage.vue/Step3Character.vue 等）已 `--write` 干净。计划 P1/P4 命令里曾列存量文件 `--write`，按约定优先未执行。
- **App.vue import**：去掉计划里未使用的 `STEPS`/`initialWizard` import（计划 Self-Review 已授权）。
- **mock-provider 测试 import**：`DEMO_SCRIPTS`/`pickDemoScript` 并入既有 import 行（避免 no-duplicate-imports），非计划的另起 import。

## 人工硬门槛（PM/实现无法代劳，留人工冒烟终审）

- 真 Electron 首启：`onboarding.completed=false` → character 显示 + 引导窗出现在角色左侧；走 C1→C4；完成后 overlay 显示且 `onboarding.completed=true` 持久（重启不再弹）。
- 真 Key → C4 发 chip → 听到流式回复 + 表情；跳过演示 → demo 台词池回复 + 表情。
- 逐屏对照 `d63b4f97`(C1/C2) + `98171885`(C3/C4) 的 live 视觉闭环（dev-server/Playwright 或真窗）。
- 通过后由 PM 打 `mvp/M7b2-code-done` / 收官 tag `mvp/M7b2-done`（同 M7b-1 流程）。
