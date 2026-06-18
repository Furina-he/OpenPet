# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

DeskSoul 是桌面常驻的 AI 角色伙伴（桌宠 + AI 内核 + 角色/插件生态）。当前处于 **Phase 2（MVP 切片）** 阶段：M1（架构骨架 + spike 迁移）、M2（IPC 四命名空间 + 取消 + 背压 + chat.snapshot 恢复）、M3（行为协议生产化：全标签集 + fail-safe + wait 节流 + 覆盖率门槛）、M4（渲染层 CharacterRuntime：全接口 + asset:// 资产安全加载 + LookAt/Idle 池/90s 主动行为/缩放/性能预算）、M5（Provider 插件运行时：单 worker 多 provider 注册表 + 流式 fetch 网关 Main 侧密钥注入 + openai-compat/Ollama/Claude/Gemini + 降级链 + tool_call 单轮回灌 + Embedding + token 统计与估算兜底 + provider.* RPC）、M6（状态层 + 数据层：better-sqlite3 单连接 WAL + `ConversationStore` 接口化（SqliteStore 生产／MemoryStore 单测降级）+ ContextAssembler（system prompt 人设/persona + Working 最近 20 轮）+ persona_state 每轮演进 + 角色隔离 character_id + 一键 .dsbak 导出 + app.storageUsage/exportData RPC；Episodic/Semantic/sqlite-vec 留表 stub）、M7a（前端地基：Main 单写者 `PrefsStore` 接口化（JsonPrefsStore 原子写+坏文件降级／MemoryPrefsStore 单测）+ `PrefsSchema` 单一真源 + `app.prefs.getAll/set/changed` RPC「即时生效」契约（深校验→落盘→广播→副作用 seam）+ Tailwind v3+PostCSS+设计 token（浅/深 CSS 变量）+ theme-resolver + 玻璃组件子集（GlassPanel/Button/SettingCard/表单控件/ToastHost）+ Hub 壳（左导航 §3.3，无 router）+ 界面主题 walking-skeleton（三 renderer 订阅 changed 即时换肤））已完成。M7b 已拆为 **M7b-1（D 系列设置面板 D2/D3/D4/D6/D8）** 与 M7b-2（C 系列首启引导）；M7b-1 已出 spec + 分阶段计划，**P1（prefs 后端地基）+ P2（D4 显示与窗口，含 characterScale 收编）已完成**（desktop 255 / protocol 177 绿）；PM 复核 P2 时发现 Hub 无任何打开入口（settings 窗 `show:false` 且无触发），**P2.5「Hub 可达性」已完成**（openHub RPC + 全局热键 `Ctrl+Shift+,` + overlay ⚙ + 窗口 hide-on-close；protocol 178 / desktop 255 绿，GUI 冒烟待 harness）；下一步 **视觉保真 harness**（dev mock-bridge + Playwright MCP 截图比对设计图闭环），其后 Hub/D4 保真审计 + P3（D2+D6 面板）/P4（D3 模型 API + chat 集成）/P5（D8 + 全量验收含 GUI 冒烟）。**当前状态与新对话对接入口见 `docs/status/CURRENT.md`。****任何新对话先读 `docs/status/CURRENT.md`（项目状态 + 对接入口）。** 完整产品需求见 `PRD.md`，架构权威来源是 `docs/plans/2026-05-01-desksoul-tech-design.md`（v0.2 Electron Pivot），任务清单见 `docs/plans/2026-05-01-desksoul-impl-plan.md`。

> 注意：实现计划要求用 `superpowers:executing-plans` 按任务逐条推进，提交遵循 Conventional Commits（`feat:` `fix:` `chore:` `test:` `docs:` `refactor:`）。

## 常用命令

monorepo 用 **pnpm workspace + Turborepo**，根目录脚本经 `turbo` 扇出到各 package：

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

### Monorepo 布局
- `packages/protocol` — 所有进程共享的协议定义（**单一真源**），无运行时依赖外部
- `packages/plugin-sdk` — 插件作者用的 SDK（`@desksoul/plugin-sdk`），目前是 stub
- `packages/tsconfig` — 共享 `tsconfig`（`base.json` / `node.json` / `vue.json`），各包 `extends`
- `apps/desktop` — Electron 桌面壳（Main + Preload + Renderer），用 electron-vite 三路构建
- `apps/sidecar` — JSON-RPC 请求处理器（`handleRequest`）+ worker_threads 入口
- `apps/spikes/*` — Tech Spike 实验（workspace 已声明）

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

### UI 设计（前端唯一真源 = `docs/plans/2026-05-01-desksoul-ui-design.md`）
做任何 renderer / 前端界面前先读这份文档，它定义了 A–J 十组共 43 屏的布局、状态、交互与组件复用约定：

- **设计系统**（§2）：视觉风格是「毛玻璃 + 拟人混合（C 方案）」，**浅色默认 / 深色备选**（D4 可切换或跟随系统）。色彩、玻璃效果（`backdrop-filter` 数值）、字体阶梯、圆角/间距栅格、过渡缓动都有精确值——不要自创。通用组件库（`GlassPanel` / `Bubble` / `EmotionDot` / `KeyCap` 等）见 §2.6。
- **三层信息架构**（§3）对应进程拓扑：Layer 1 桌面层（Character 窗口里的角色本体 + 桌面气泡）/ Layer 2 浮层（聊天浮层、引导、确认弹窗，半模态）/ Layer 3 Hub Window（统一管理窗，左导航 + 内容区，承载设置/角色/插件/知识库）。**Layer 3 不抢 Layer 1 的视觉戏份。**
- **设计稿 PNG 在 `UI/` 目录**（19 个文件，覆盖全部 43 屏）。文件名→界面的映射表在 §4.1，按 P0/P1/P2 优先级分组在 §4.2，对应 impl-plan 的 MVP 切片节奏。
- 几条贯穿性硬规范：角色 HUD 5 槽位写入规则（§2.7，避免多模块互相覆盖）；破坏性操作三级确认（§2.8，①undo toast / ②二次确认 / ③输入 `DELETE`）；行为标签 `<emo:.../>` 等与 `behavior-parser.ts` 的解析一一对应，是「双轨流式」（文本流 + 表情流并行）的契约。

## 关键约定
- **TS 严格模式拉满**：`packages/tsconfig/base.json` 开了 `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` + `verbatimModuleSyntax` + `isolatedModules`。注意 `verbatimModuleSyntax` 要求类型导入用 `import type`；ESM 相对导入要带 `.js` 后缀（见 sidecar 源码）。
- 全仓 ESM（`"type": "module"`），`moduleResolution: Bundler`。
- Prettier：`singleQuote` + `semi` + `trailingComma: all` + `printWidth: 100`。
- 测试框架统一 **Vitest**；端到端用 **Playwright with Electron**（跑 packaged app）。
- 数据库 **better-sqlite3 + sqlite-vec**（向量 V1.0 启用），在 electron-vite 中作为 external 处理。
