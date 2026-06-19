# DeskSoul · 项目当前状态 / 新对话对接入口

> **任何新对话的第一份要读的文件**。读完即可零上下文接续。架构/PM 每阶段末更新。
> 最后更新：2026-06-20（分支 `feat/m7b2-onboarding`，**M7b-2 C1–C4 代码完成**：protocol 180 / sidecar 37 / desktop 287、typecheck 干净、build exit 0；真窗 GUI 冒烟 + 真 Key + live 视觉逐屏对照待人工，PM 复核后打 tag。M7b-1 仍 `mvp/M7b1-code-done`，真窗/真 Key 待人工）。

---

## 1. 一句话现状

M1–M6 + B/C 重构 + **M7a 地基** 在 `main`；M7b 拆 M7b-1（D 面板）/M7b-2（引导）。M7b-1 **P1/P2/P2.5/P3/P4 完成**；**视觉保真 harness + Hub/D4 首轮保真审计 完成、PM 已复核**（desktop 260 绿；Playwright MCP 截图↔PNG 闭环已跑通）。**P3（D2/D6）+ P4（D3 双栏 + chat 集成）+ P5（D8 + D3 polish + ABI 收口）代码完成、PM 已复核**（desktop 273 / protocol 178 / build exit 0）。**当前待办 = P5 人工硬门槛**：真 Electron GUI 冒烟（D8 按 `7075fa1f`）+ 真 Key 端到端 + 裁定 tag。✅ **ui-design 已 v0.2 重写**（2026-06-19）：视觉真源=`UI/` 高保真图，**43 屏全有专属图**，文件→屏映射经作者逐张核准（D1/D2=`774644b7`、D3/D4=`36b542fb`、D5/D7=`1d7669e3`、D6/D8=`7075fa1f`、E1/F1=`60ea4a18`…完整见 ui-design §4）；已删全部 ASCII 线稿，§2 token + §15.1 默认表 + 各屏契约保留。

✅ **M7b-2（C1–C4 首启引导）代码完成**（2026-06-20，分支 `feat/m7b2-onboarding`，自 `feat/m7b1-d-series` HEAD 切出含全部 M7b-1 代码）：第 4 个 `onboarding` 窗（480×600 角色左侧）+ `onboarding.completed` prefs + `decideStartup` 首启判定 + `app.window.finishOnboarding` 编排 RPC + wizard 状态机/chips + C1 欢迎/C2 LLM 配置/C3 角色选择/C4 首句+完成页 + 抽 `ProviderConfigPanel`（D3 `ModelApiPage` 改用不回归）+ demo 台词池轮换（跳过 Key 也能听到回复+表情）。desktop 287 / protocol 180 / sidecar 37、typecheck 干净、build exit 0。**待人工硬门槛**：真窗首启逐屏对照 `d63b4f97`(C1/C2)+`98171885`(C3/C4) + 真 Key→C4 流式回复 90s 端到端 + live 视觉闭环；PM 复核后打 `mvp/M7b2-code-done` / 收官 `mvp/M7b2-done`。详见 [`milestones/M7b-2/RESULTS.md`](../milestones/M7b-2/RESULTS.md)。

## 2. 立即要做的事

> P1/P2/P2.5 + 视觉保真 harness + Hub/D4 保真审计 + **P3（D2/D6）** 均已完成并经 PM 复核（**262 绿**）。视觉闭环（`renderer/dev/mock-bridge.ts` + `?page=` route + Playwright MCP 截图↔PNG）已就绪，后续每屏复用。

**P5 代码已完成 + PM 复核**（Codex 跑，desktop 273 / protocol 178 / build exit 0）：D3 两 polish + D8 关于 + Task 0 ABI 收口均签收。**当前待办 = P5 人工硬门槛（§6）**：① 按 RESULTS『Task 0 收口』把 better-sqlite3 换 electron-ABI(123) → `pnpm --filter @desksoul/desktop dev`；② **真 Electron GUI 冒烟**逐屏对照设计图（**D8 按 `7075fa1f` 右半**核，非 1d7669e3）；③ **真 Key→听到回复 90s 端到端**；④ 通过后裁定打 tag `mvp/M7b1-done`。详见 [`milestones/M7b-1/plans/p5-d8-acceptance.md`](../milestones/M7b-1/plans/p5-d8-acceptance.md) + RESULTS。

## 3. 路线图（PM 维护）

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| M1–M6 / B/C / M7a | 地基齐备 | ✅ main |
| M7b-1 P1 | prefs schema 扩容 + effects 接依赖 + app.openExternal | ✅ 254 绿 |
| M7b-1 P2 | D4 显示与窗口（SettingSection + characterScale 收编 + 完整面板） | ✅ 255 绿 |
| M7b-1 P2.5 | Hub 可达性（openHub RPC + 热键 + overlay ⚙ + hide-on-close） | ✅ 完成 + PM 复核（178/255 绿；GUI 冒烟待 harness） |
| **视觉保真 harness** | dev mock-bridge + Playwright MCP 截图比对设计图闭环（infra） | ✅ 完成 + PM 复核（260 绿） |
| Hub/D4 保真审计 | 用 harness 对照 PNG，修 Slider/Switch/Select/.ds-glass 等可复用件 | ✅ 完成（残留见 RESULTS / §7 决策） |
| **M7b-1 P3** | D2 通用 + D6 隐私（ConfirmDialog 高风险二次确认 + nav `system.general` + nav图标/Slider翼标 polish） | ✅ 完成 + PM 复核（desktop 262 / protocol 178；视觉对照 1d7669e3 通过） |
| **M7b-1 P4** | D3 模型 API（双栏）+ chat 集成（active provider/model→chat.send） | ✅ 完成 + PM 复核（desktop 273 / protocol 178；2 视觉 polish 转 P5） |
| **M7b-1 P5** | D8 关于 + D3 两 polish + 真 Electron GUI 冒烟 + 真 Key 端到端 + tag | ✅ 代码完成 + PM 复核（273/178/build exit 0）；tag `mvp/M7b1-code-done` 已打；**真窗冒烟 + 真 Key + 收官 tag `mvp/M7b1-done` 待人工**（§6） |
| M7b-2 | C1–C4 首启引导（复用 D3 provider-config 积木） | 🚧 代码完成 + PM 待复核（真窗/真 Key/live 视觉人工）；desktop 287 / protocol 180 / sidecar 37（[`milestones/M7b-2/RESULTS.md`](../milestones/M7b-2/RESULTS.md)） |
| M8a | 聊天体验（B1 浮层 + B2 双轨气泡 + J3 错误分级） | 📋 spec + P1–P4 计划就绪（[`milestones/M8a/`](../milestones/M8a/)）；可开实现 |
| M8b / M8c | 桌面层（A1–A4）/ 系统集成（J1/J2/J5） | 📋 spec + P1–P4 计划就绪（[`milestones/M8b/`](../milestones/M8b/) · [`M8c/`](../milestones/M8c/)）；M8a 后顺序执行 |
| M9 | 打包 + 体验打磨 + 文档 | ⏳ |

> 原 spec 把 D2/D4/D6 并一阶段；PM 据工作量细分 P2(D4)/P3(D2+D6)，并因可达性发现插入 P2.5。spec 是 WHAT 真源，phase 计划是 HOW/顺序。

## 4. 权威文档索引

- **长期真源 `docs/design/`**：架构 `tech-design.md` · 前端 `ui-design.md`（v0.2 以图为主：§2 设计系统 / §3 IA / §4 图索引（文件→屏映射）/ §8 D 面板 / §15.1 默认表）· 总清单 `impl-plan.md` · 文档规范 `doc-conventions.md`；产品需求根 `PRD.md`。
- **里程碑索引 `docs/milestones/README.md`**：各里程碑入口总览。
- **M7b-1（当前）`docs/milestones/M7b-1/`**：`README.md`（spec→plans→RESULTS 关系链）· `spec.md`（WHAT）· `plans/p1…p5 + visual-fidelity-harness`（HOW）· `RESULTS.md`（交付）。
- 历史 M1–M7a：RESULTS 在 `apps/desktop/RESULTS-M*.md`、plan 在 `docs/plans/`（见 `milestones/README.md`，B 增量未强迁）。

## 5. 关键约定（务必遵守）

- **UI 视觉对齐设计图（硬验收，[[ui-must-match-design-pngs]]）**：最终效果必须像设计图 + ui-design §2 token（毛玻璃/色阶/字号/圆角/间距精确值，不自创）。**"能渲染+能持久+单测绿" 是必要非充分**；每个 UI 阶段验收含"用视觉闭环逐屏比对设计图"。**视觉真源 = `UI/` 高保真图**（ui-design **v0.2 已重写**，§4 文件→屏映射经作者逐张核准，43 屏全覆盖）：做某屏前打开其专属图（D3/D4=`36b542fb`、D6/D8=`7075fa1f`、D2=`774644b7` 等）+ §2 token。视觉闭环（mock-bridge + `?page=` + Playwright MCP）已就绪。分层：overlay 聊天浮层最终玻璃形态是 B1=M8（P2.5 的 ⚙ 是临时入口）。
- **TDD**（有逻辑处先红后绿）；里程碑 inline 逐 task（subagent 派发 429 限流，**别派 subagent 跑实现**，[[project-subagent-inline]]）。
- **不引入 `@vue/test-utils`**：逻辑下沉纯 TS 测，SFC 薄渲染。
- **改 protocol src 后必 `pnpm --filter @desksoul/protocol build` 再跑 desktop**；跑全量 desktop 测试前 `pnpm --filter @desksoul/sidecar build`（[[build-test-workflow-gotchas]]）。
- **prettier 只格式化自己新写的文件/行**，别 `--write` 存量文件（methods.ts/index.ts 有欠账，留 M9）。
- 提交 Conventional Commits；收尾 RESULTS + 更新本文件 + CLAUDE 状态行；装原生依赖走 npmmirror（[[project_env_network]]）。

## 6. 待验证（PM 跟踪的债）

- **GUI 冒烟尚未跑过（= 对照设计图 PNG 比对，非"能显示就行"）**：P1/P2 全是单测 + typecheck 绿，但 Electron 运行时**从未目视验证**。根因 = Hub 不可达（P2.5 解决）。**P2.5 落地后跑一次 `pnpm --filter @desksoul/desktop dev` 做累积冒烟**（M7a+P2+P2.5），并对 Hub 壳/D4 做**保真度 pass：逐项对照各屏专属图（D4=`UI/36b542fb…`、Hub/D1=`UI/774644b7…`+`UI/03950c77…`）+ §2 token**，偏差立 polish task，结果记 RESULTS。**M7b-1 收尾（P5）前必须完成一次对齐设计图的完整 GUI 冒烟**，否则不签收。（P2.5/Hub-D4 + P3 的 D2/D6 已做 dev-server 浏览器视觉抽验对照 PNG；真透明 Electron 窗目视终审统一留 P5。）
- 存而不接（持久但无 live 行为，留 M8 角色交互回顾）：`lookAt/footGlow` 渲染端响应、`lookAtStrength/physics/clickThroughBar/wallpaperMode/多显示器/不打扰/实验性` 各开关。

## 7. 架构决策记录（M7b-1）

1. **D3 worker 零改动**（P4）：`ChatRequest.model` 已存在、worker 已 honor；D3 集成纯 Main+renderer（chat.send 从 prefs 读 activeProvider→链、activeModel→request.model）。
2. **effects 表只装有 Main 动作的键**：theme/lookAt/footGlow 走 `app.prefs.changed` 广播由 renderer 自响应。P1 接了 launchAtLogin/alwaysOnTop/clickThrough，P2 接了 characterScale。
3. **characterScale 收编**（P2 已做）：slider 拖动→`character.setScale`(预览不落盘)、松手→`app.prefs.set`(持久)；effect 用 `scaledBounds` 设窗口 + `setCharacterSize` 同步 ipc-router `characterSize` 真源。
4. **Hub 可达性**（P2.5）：`app.window.openHub` RPC + 全局热键 + overlay ⚙ + settings 窗 hide-on-close（持久不销毁）。完整入口（托盘/热键录制器）在 M8。
5. **D2 通用无 nav 槽位**（P3）：在「系统」组首位加 `system.general`→D2。
6. **全量渲染+持久化**：§7 全开关进 PrefsSchema；只有"有后端"的接真实 effect，余存而不接。

## 8. 角色分工

- **架构/PM（与我对接的对话）**：路线图、spec/计划、维护本文件+CLAUDE、收尾归档、复核执行结果。
- **执行（新开对话）**：按就绪 plan 逐 task TDD 实现提交。
