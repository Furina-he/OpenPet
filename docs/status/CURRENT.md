# DeskSoul · 项目当前状态 / 新对话对接入口

> **任何新对话的第一份要读的文件**。读完即可零上下文接续。架构/PM 每阶段末更新。
> 最后更新：2026-06-18（分支 `feat/m7b1-d-series`，M7b-1 **P1–P4 已落 + PM 复核**；下一步 P5 收尾）。

---

## 1. 一句话现状

M1–M6 + B/C 重构 + **M7a 地基** 在 `main`；M7b 拆 M7b-1（D 面板）/M7b-2（引导）。M7b-1 **P1/P2/P2.5/P3/P4 完成**；**视觉保真 harness + Hub/D4 首轮保真审计 完成、PM 已复核**（desktop 260 绿；Playwright MCP 截图↔PNG 闭环已跑通）。**P3（D2/D6）+ P4（D3 模型 API 双栏 + chat 集成，worker 零改动）完成、PM 已复核**（desktop 273 绿）。**当前待办 = P5（D8 + 真窗验收 + tag）**。⚠ 设计图 PNG 映射表已证实损坏并修订（见 ui-design §4.1 顶部）：**D2/D3/D4/D8 无专属 PNG，设置面板统一以 `UI/1d7669e3`（设置设计语言）+ §7 + §2 token 为参照**。

## 2. 立即要做的事

> P1/P2/P2.5 + 视觉保真 harness + Hub/D4 保真审计 + **P3（D2/D6）** 均已完成并经 PM 复核（**262 绿**）。视觉闭环（`renderer/dev/mock-bridge.ts` + `?page=` route + Playwright MCP 截图↔PNG）已就绪，后续每屏复用。

**下一步执行 = P5（M7b-1 收尾）**：`git checkout feat/m7b1-d-series`，按 **`docs/plans/2026-06-18-m7b1-p5-d8-acceptance-plan.md`**（PM 即将产出）逐 task。含：① **先 `electron-rebuild` better-sqlite3**（ABI 127≠123，[[p5-electron-gui-smoke-blocker]]）；② D3 两视觉 polish（状态点 `ok`→`--ds-success` 绿；provider 标题 `name===formatLabel` 去冗余）；③ D8 关于面板（接 `app.openExternal` 外链，RPC 已在 P1 就绪）；④ **真 Electron GUI 冒烟**（对照设计图逐屏目视，§6 硬门槛）+ **真 Key→听到回复 90s 端到端**；⑤ 全量验收 + RESULTS 定稿 + tag `mvp/M7b1-done`。

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
| **M7b-1 P5** | D8 关于 + D3 两 polish + 真 Electron GUI 冒烟 + 真 Key 端到端 + 全量验收 + RESULTS 定稿 + tag | 📋 待规划（PM 出 plan）→ 执行 |
| M7b-2 | C1–C4 首启引导（复用 D3 provider-config 积木） | ⏳ 独立 spec/plan |
| M8 / M9 | 聊天UI+气泡+系统集成（托盘/热键录制器正式入口）/ 打包打磨 | ⏳ |

> 原 spec 把 D2/D4/D6 并一阶段；PM 据工作量细分 P2(D4)/P3(D2+D6)，并因可达性发现插入 P2.5。spec 是 WHAT 真源，phase 计划是 HOW/顺序。

## 4. 权威文档索引

- 产品 `PRD.md`；架构真源 `docs/plans/2026-05-01-desksoul-tech-design.md`；总清单 `...-impl-plan.md`
- 前端真源（做 renderer 前必读）`docs/plans/2026-05-01-desksoul-ui-design.md`（§2 设计系统/§3 IA/§7 D 面板/§14.1 默认表）
- M7a：`...-m7a-foundation-{spec,plan}.md`
- **M7b-1 设计（WHAT）**：`docs/plans/2026-06-17-m7b1-d-series-spec.md`
- 阶段计划（HOW）：`...-p1-foundation-plan.md`(✅) · `...-p2-d4-plan.md`(✅) · `...-p2_5-hub-reachability-plan.md`(待执行)
- 阶段结果：`apps/desktop/RESULTS-M7b1.md`（P1+P2 已记）

## 5. 关键约定（务必遵守）

- **UI 视觉对齐设计图（硬验收，[[ui-must-match-design-pngs]]）**：最终效果必须像设计图 + ui-design §2 token（毛玻璃/色阶/字号/圆角/间距精确值，不自创）。**"能渲染+能持久+单测绿" 是必要非充分**；每个 UI 阶段验收含"用视觉闭环逐屏比对设计图"。**⚠ §4.1/§7 的 PNG→屏映射已证实多处错误（已修订，见 ui-design §4.1 顶部）：D2/D3/D4/D8 无专属 PNG，设置面板统一以 `UI/1d7669e3`（设置设计语言）+ §7 文字图 + §2 token 为参照**；用任何 PNG 前先 `Read` 核实像素。视觉闭环（mock-bridge + `?page=` + Playwright MCP）已就绪。分层：overlay 聊天浮层最终玻璃形态是 B1=M8（P2.5 的 ⚙ 是临时入口）。
- **TDD**（有逻辑处先红后绿）；里程碑 inline 逐 task（subagent 派发 429 限流，**别派 subagent 跑实现**，[[project-subagent-inline]]）。
- **不引入 `@vue/test-utils`**：逻辑下沉纯 TS 测，SFC 薄渲染。
- **改 protocol src 后必 `pnpm --filter @desksoul/protocol build` 再跑 desktop**；跑全量 desktop 测试前 `pnpm --filter @desksoul/sidecar build`（[[build-test-workflow-gotchas]]）。
- **prettier 只格式化自己新写的文件/行**，别 `--write` 存量文件（methods.ts/index.ts 有欠账，留 M9）。
- 提交 Conventional Commits；收尾 RESULTS + 更新本文件 + CLAUDE 状态行；装原生依赖走 npmmirror（[[project_env_network]]）。

## 6. 待验证（PM 跟踪的债）

- **GUI 冒烟尚未跑过（= 对照设计图 PNG 比对，非"能显示就行"）**：P1/P2 全是单测 + typecheck 绿，但 Electron 运行时**从未目视验证**。根因 = Hub 不可达（P2.5 解决）。**P2.5 落地后跑一次 `pnpm --filter @desksoul/desktop dev` 做累积冒烟**（M7a+P2+P2.5），并对 Hub 壳/D4 做**保真度 pass：逐项对照 `UI/4ba6005f…`(D4) + §3.3(Hub) + §2 token**，偏差立 polish task，结果记 RESULTS。**M7b-1 收尾（P5）前必须完成一次对齐设计图的完整 GUI 冒烟**，否则不签收。（P2.5/Hub-D4 + P3 的 D2/D6 已做 dev-server 浏览器视觉抽验对照 PNG；真透明 Electron 窗目视终审统一留 P5。）
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
