# AGENTS.md

This file provides guidance to Codex (and other coding agents) when working with code in this repository.

> 本文件是**项目地图**：目标 / 整体概况 / 项目结构 / 架构 / 关键约束，便于快速理解项目。**不含实时进度**——在做哪个阶段、测试数、下一步、对接入口一律见 `docs/status/CURRENT.md`（任何新对话先读它）。与 `CLAUDE.md` 内容一致（双 agent 共用同一张地图）。

## 项目概览

DeskSoul 是桌面常驻的 AI 角色伙伴（桌宠 + AI 内核 + 角色/插件生态），目标是 "一个会被你看见的 AI 灵魂体"——常驻桌面、流式表情/动作驱动、可配多 LLM Provider、隐私本地优先。

**当前阶段**：Phase 2（MVP 切片）。里程碑粗粒度概况：

- **M1–M6 · 内核（已在 main）**：架构骨架 / IPC（JSON-RPC，取消·背压·快照恢复）/ 行为协议（流式标签解析）/ 渲染层 CharacterRuntime / Provider 运行时（多 provider·降级链·Main 侧密钥注入）/ 状态数据层（SQLite WAL + ContextAssembler + persona 演进 + 角色隔离 + .dsbak 导出）。
- **M7 · 前端**：M7a 地基（PrefsStore + `app.prefs.*` 即时生效契约 + Tailwind/设计 token + Hub 壳 + 主题换肤，已在 main）；M7b 面板与引导（M7b-1 = D 系列设置面板 + chat 集成；M7b-2 = C 系列首启引导）。
- **M8 / M9 · 后续**：聊天 UI + 气泡 + 系统集成（托盘/热键正式入口）/ 打包打磨。

完整产品需求见 `PRD.md`；架构真源 `docs/design/tech-design.md`（v0.2 Electron Pivot）；总任务清单 `docs/design/impl-plan.md`；前端真源 `docs/design/ui-design.md`（v0.2 起以高保真图为视觉真源）；文档组织规范 `docs/design/doc-conventions.md`。

> 实现计划用 `executing-plans` 按任务逐条推进；提交遵循 Conventional Commits（`feat:` `fix:` `chore:` `test:` `docs:` `refactor:`）。

## 项目结构

monorepo（pnpm workspace + Turborepo）：

```
apps/
  desktop/            Electron 桌面壳（electron-vite 三路：main/preload/renderer）
    electron/main/    Main「业务大脑」——ipc-router · chat-service · provider-service ·
                      context-assembler · prefs-service · conversation-core · keychain ·
                      provider-host（worker 监督）· db/ · prefs/ …（业务同进程直调）
    src/renderer/     两 Renderer：settings（Hub 设置面板）/ overlay（聊天浮层）/
                      character（three-vrm「哑播放器」）/ components / theme / dev（视觉 harness）
    test/             Vitest 单测；RESULTS-M*.md = 各里程碑交付结果（历史）
  sidecar/            JSON-RPC handleRequest + worker_threads 入口（provider worker 等）
  spikes/             Tech Spike 实验
packages/
  protocol/           全进程共享协议（Zod 单一真源）：methods · schemas · prefs ·
                      behavior-parser · jsonrpc · state · provider-config …
  plugin-sdk/         插件作者 SDK（@desksoul/plugin-sdk，stub）
  tsconfig/           共享 tsconfig（base/node/vue）
docs/
  design/             长期真源：tech-design · ui-design · impl-plan · doc-conventions
  status/CURRENT.md   实时状态 + 新对话对接入口（★先读它）
  milestones/<M>/     各里程碑：spec + plans/ + RESULTS + README（见 doc-conventions）
  plans/              M7a 及更早历史 plan/spec（未规整，由 milestones/README 登记）
UI/                   高保真设计图 PNG（19 张覆盖 43 屏，前端视觉真源；映射见 ui-design §4）
PRD.md · README.md    产品需求 · 仓库说明
```

## 常用命令

根目录脚本经 `turbo` 扇出到各 package：

```bash
pnpm install              # 安装（CI 用 --frozen-lockfile）
pnpm build                # turbo run build（各 package tsc / electron-vite build）
pnpm test                 # turbo run test（Vitest）
pnpm typecheck            # turbo run typecheck
pnpm lint                 # turbo run lint
pnpm dev                  # turbo run dev --parallel
```

单 package 操作用 `--filter`，或进入目录直接跑 `vitest`：

```bash
pnpm --filter @desksoul/desktop build        # 仅构建 Electron 桌面壳
pnpm --filter @desksoul/protocol test        # 仅测 protocol 包
pnpm --filter @desksoul/desktop dev          # electron-vite dev（启动 Electron）

# 跑单个测试文件 / 单个用例（在对应 package 目录下）
pnpm exec vitest run test/behavior-parser.test.ts
pnpm exec vitest run -t "用例名片段"
```

CI（`.github/workflows/ci.yml`）跑在 **windows-latest**，顺序为 `pnpm -r typecheck → lint → test`，最后 `pnpm --filter @desksoul/desktop build`。Win 10/11 是首发平台。

## 架构

### 进程拓扑（tech-design v0.2 核心，务必理解）
v0.2 从 Tauri (Rust) 转向 **Electron**，并把**业务大脑合并进 Electron Main 进程**，不再 spawn 独立 Node 子进程：

- **Electron Main（Node）**：窗口宿主 + IPC 路由 + SQLite 单连接 + 凭证（safeStorage）+ Worker 监督。业务模块（ConversationCore / Persona / BehaviorParser / ProviderRouter / PluginHost）**同进程直接调用**。
  - 约束：Main 崩溃 = 整个 app 重启，所以 Main 内代码必须只做"协议路由 / Worker 调度 / DB 单连接"，业务复杂度尽量下沉到 Worker。
- **两个 Renderer**：Character 窗口（透明、alpha 命中、Three.js + @pixiv/three-vrm，是"愚蠢的播放器"无业务逻辑）与 UI Overlay（Vue 3 + Tailwind，聊天/设置/记忆/插件管理）。
  - 全部强制 `sandbox: true` + `contextIsolation: true` + `nodeIntegration: false`；唯一 Node 能力经 preload 的 `contextBridge` 暴露为 `window.desksoul.rpc(...)` / `window.desksoul.on(...)`。
- **Worker（worker_threads）**：所有插件（Provider / Skill / Tool）+ MemoryWorker 跑在 worker 线程，崩溃由 PluginHost 监督重启（指数退避，3 次不健康则禁用）。密钥永不进 Worker。

### 三套协议（互不混淆，各自独立可测）
1. **本地 IPC = JSON-RPC 2.0**：Renderer→Main 走 `ipcRenderer.invoke`，Main→Worker 走 `MessagePort` 的 `postMessage`。schema 在 `packages/protocol/src/jsonrpc.ts`，方法签名（含 params/result 的 Zod schema）在 `methods.ts`。新增 RPC 方法时：先在 `methods.ts` 注册 schema，再在 `apps/sidecar/src/server.ts` 的 `handleRequest` 加分支。
2. **行为驱动协议**：LLM 流式输出里的 `intent header + 行内标签`，由 `packages/protocol/src/behavior-parser.ts` 的 `BehaviorParser` 状态机解析。它是**流式增量**解析器（`feed(chunk)` 逐块吐 `BehaviorEvent`，`flush()` 收尾），支持 `<emo:.../>` `<act:.../>` `<wait ms=.../>` `[intent mood=... energy=...]`。流式即体验是硬要求——token 流出过程中实时驱动表情/动作，不等整段输出。
3. **插件接口 = `@desksoul/plugin-sdk`**。

### 协议 schema 用 Zod 为单一真源
Main / Renderer / Worker 共享 import `@desksoul/protocol`。`zod-to-json-schema` 用于导出。改协议先改 Zod schema。

### UI 设计（前端唯一真源 = `docs/design/ui-design.md`）
做任何 renderer / 前端界面前先读这份文档，它定义了 A–J 十组共 43 屏的视觉、状态、交互与组件复用约定（v0.2 起以高保真图为视觉真源）：

- **设计系统**（§2）：视觉风格是「毛玻璃 + 拟人混合（C 方案）」，**浅色默认 / 深色备选**（D4 可切换或跟随系统）。色彩、玻璃效果（`backdrop-filter` 数值）、字体阶梯、圆角/间距栅格、过渡缓动都有精确值——不要自创。通用组件库（`GlassPanel` / `Bubble` / `EmotionDot` / `KeyCap` 等）见 §2.6。
- **三层信息架构**（§3）对应进程拓扑：Layer 1 桌面层（Character 窗口里的角色本体 + 桌面气泡）/ Layer 2 浮层（聊天浮层、引导、确认弹窗，半模态）/ Layer 3 Hub Window（统一管理窗，左导航 + 内容区，承载设置/角色/插件/知识库）。**Layer 3 不抢 Layer 1 的视觉戏份。**
- **视觉真源 = `UI/` 高保真图**（19 张覆盖全部 43 屏）。文件→屏映射见 **§4**（v0.2 经设计作者逐张核准）；做某屏前先打开其专属图。**文字与图冲突时以图为准。**
- 几条贯穿性硬规范：角色 HUD 5 槽位写入规则（§2.7，避免多模块互相覆盖）；破坏性操作三级确认（§2.8，①undo toast / ②二次确认 / ③输入 `DELETE`）；行为标签 `<emo:.../>` 等与 `behavior-parser.ts` 的解析一一对应，是「双轨流式」（文本流 + 表情流并行）的契约。

## 关键约定
- **TS 严格模式拉满**：`packages/tsconfig/base.json` 开了 `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` + `verbatimModuleSyntax` + `isolatedModules`。注意 `verbatimModuleSyntax` 要求类型导入用 `import type`；ESM 相对导入要带 `.js` 后缀（见 sidecar 源码）。
- 全仓 ESM（`"type": "module"`），`moduleResolution: Bundler`。
- Prettier：`singleQuote` + `semi` + `trailingComma: all` + `printWidth: 100`。
- 测试框架统一 **Vitest**；端到端用 **Playwright with Electron**（跑 packaged app）。
- 数据库 **better-sqlite3 + sqlite-vec**（向量 V1.0 启用），在 electron-vite 中作为 external 处理。
