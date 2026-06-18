# RESULTS · M7b-1 D 系列设置面板（分阶段累积）

> 多阶段里程碑，逐阶段追加；M7b-1 全部完成后定稿 + 打 tag（[[milestone-results-convention]]）。

## P1 · 地基（schema 扩容 + effects 接依赖 + app.openExternal）

**状态：✅ 完成**（分支 `feat/m7b1-d-series`）。PM 独立复核：desktop 254 绿 / protocol 177 绿 / typecheck exit 0 / 工作树干净。

| Task | commit | 内容 |
| --- | --- | --- |
| 1 | `44761b6` | `PrefsSchema` 扩容：general/display/privacy/model/budget/offline 全量键（§14.1 默认值） |
| 2 | `83ed921` | `app.openExternal` method + `app-service.ts` 工厂（仅放行 http/https，否则 -32602） |
| 3 | `859c820` | pref effects 接真实依赖：launchAtLogin→setLoginItem、alwaysOnTop/clickThrough→character 窗 |
| 4 | `f6fb638` | ipc-router 用 broadcast+characterWindow+setLoginItem 构造 effects、spread appService；index 注入 setLoginItem + shell.openExternal |

**测试增量**：protocol 175→177（Task1 新用例）；desktop 249→254（app-service +2、effects 2→5）。全程 TDD RED→GREEN，每 task 一提交。

**两点记录：**

1. **启动 hydrate 行为变化（计划已预期，符合设计）**：P1 后 `applyAllEffects` 启动会把 `display.alwaysOnTop`(默认 true) 施加到角色窗——即 ui-design §14.1「始终置顶默认开」语义（桌宠核心体验）。effects 测 + wiring 测已覆盖。windows.ts 原未显式设 alwaysOnTop，故这是**新的、正确的**启动态。

2. **prettier 范围克制（已知存量欠账，非回归）**：本仓 CRLF + prettier(LF) 下 `--write` 会连带重排 pre-existing 未格式化旧行（`methods.ts` 的 `chat.send`、`index.ts` 的 `providerEntryPath`，均 M2/M5 期 >100 行）。执行者按 [[build-test-workflow-gotchas]]「只格式化自己新写的代码」回退了这些无关重排，P1 提交收敛在范围内。**代价**：`methods.ts`/`index.ts` 仍带存量 prettier 欠账。**注**：prettier 非 CI 门禁（CI 实际门禁 = typecheck/test/build），故不阻塞；留待专门清理 task（可放 M9 打磨期）。

**衔接到 P2**：`display.characterScale` 的 effect 当时显式延后到 P2（与 D4 面板 + 收编旧 `character.setScale` RPC + ipc-router `characterSize` 真源一起做）。

## P2 · D4 显示与窗口（SettingSection + characterScale 收编 + 完整面板）

**状态：✅ 完成**（分支 `feat/m7b1-d-series`）。验证：sidecar build 后 desktop **255 绿** / protocol 177 绿（未触及）/ typecheck exit 0 / 工作树干净。全程 TDD（有逻辑处先红后绿），每 task 一提交。

| Task | commit | 内容 |
| --- | --- | --- |
| 1 | `6460000` | `SettingSection.vue` 分组卡组件（§7.1 圆角 12 + 内分隔线；§7.4 `tone="warn"` 警告描边） |
| 2 | `fa6a559` | `display.characterScale` effect：`scaledBounds` 设窗口 bounds + `setCharacterSize` 回写 ipc-router `characterSize` 真源；`characterSize` 声明上移到 effects 构造前 |
| 3 | `cd6f34e` | 完整 D4 `DisplayPage.vue`（角色/多显示器/不打扰/实验性 4 组，全键绑定 prefs）；`Slider.vue` 补 `change` emit |
| 4 | （本提交） | 全量回归 + RESULTS P2 |

**测试增量**：desktop 254→**255**（effects.test 新增 characterScale 用例）。protocol 不变（本阶段未改 protocol src）。

**characterScale 收编（spec/状态 §7.3）**：
- **slider 双路径**：拖动 `@update:model-value`→`character.setScale`（实时预览、不落盘）；松手 `@change`→`app.prefs.set('display.characterScale')`（持久 + effect + `✓ 已保存`）。
- **effect 设 bounds + 同步真源**：`createPrefEffects` 内新 effect 用 `scaledBounds`（底边中点锚定、幂等）设窗口尺寸，并经注入的 `setCharacterSize` 回写 ipc-router 的 `characterSize`（`moveBy` 锁尺寸的真源），二者不再各算各的。
- **旧 `character.setScale` RPC 保留**：仅作拖动实时预览入口（它本就改 `characterSize` + setBounds）；持久化统一走 prefs。

**存而不接清单（§7 全量持久策略，本阶段渲染 + 持久但不接 live 行为）**：`lookAtStrength / physics / clickThroughBar / wallpaperMode / followDisplay / crossScreenDrag / fullscreenHide / gameDetect / meetingDowngrade`；以及 `lookAt / footGlow` 的 **character 渲染端 live 响应**（其 Main 广播已发，渲染端消费留 M8 角色交互回顾；本阶段二者先持久化）。穿透热键为静态占位（J2 录制器在 M8）。

**两点记录：**

1. **Slider `change` emit（计划应急分支，非临时发挥）**：M7a 的 `Slider.vue` 只在 `@input` emit `update:modelValue`，无松手事件。P2 计划 Self-Review 已预判并指示「核 Slider.vue，必要时补 change 转发」。故给 Slider 增 `change: [number]` emit（透传原生 `<input type=range>` 的 commit 事件），使缩放在松手时持久（而非每拖动 tick 落盘）。`Slider` 此前无其它消费者（grep 确认），零回归。

2. **启动 hydrate 现还原窗口尺寸**：`applyAllEffects` 启动会按 `display.characterScale` 跑 effect → 以 `scaledBounds(currentBounds, scale)` 设窗口（scale=1 默认时对 base 320×480 幂等）。这是缩放「重启保持」的预期语义，与 P1 的 alwaysOnTop hydrate 同理。配套修补：`effects.test` 的 `fakeWin()` 补 `getBounds/setBounds`（P1 fixture 未预见新 effect 进入 sweep）。

**prettier**：仅 `--write` 本阶段新写文件（SettingSection/DisplayPage/Slider 等），DisplayPage 一处长行换行已 amend 进 Task 3；未动 ipc-router 等存量文件（[[build-test-workflow-gotchas]]）。

**手动冒烟**：未在本执行对话内跑（需 `pnpm --filter @desksoul/desktop dev` 启 Electron 交互验证缩放实时/持久、置顶/穿透即时、换肤不回归）——留交付验收时执行。

**衔接到 P3**：D2 通用 + D6 隐私（含 ConfirmDialog 高风险二次确认 + nav 加 `system.general`）。

## P2.5 · Hub 可达性（openHub RPC + 全局热键 + overlay ⚙ + hide-on-close）

**状态：✅ 代码完成，测试/typecheck 绿；GUI 冒烟待人工**（分支 `feat/m7b1-d-series`）。验证：protocol build + sidecar build 后 desktop **255 绿** / protocol **178 绿** / typecheck exit 0 / 工作树干净。每 task 一提交。

**背景**：PM 复核 P2 时发现 settings 窗 `show:false` 且全 app 无任何打开入口（无 `.show()`/`globalShortcut`/overlay ⚙/RPC），关闭即销毁 → M7a/P2 已做的 Hub 壳+主题+D4 面板运行时不可达。P2.5 做**最小可达 + 持久**（完整入口集托盘/热键录制器留 M8）。

| Task | commit | 内容 |
| --- | --- | --- |
| 1 | `0ebc33b` | `app.window.openHub` method（params `{}` / result `{ok:true}`）+ ipc-router `settingsWindow` dep + handler（show+focus）；TDD 先红后绿 |
| 2 | `e4acfb3` | index 接线：`globalShortcut` import + 注入 `settingsWindow` + 注册 `Ctrl/Cmd+Shift+,` 热键 + settings `close`→hide(`!isQuitting`) + `before-quit` 置 `isQuitting`+`unregisterAll` |
| 3 | （本提交） | overlay `App.vue` ⚙ 按钮（`.head` flex 行 + `.gear`）→ `openHub` RPC；全量回归 + RESULTS P2.5 |

**测试增量**：protocol 177→**178**（`app.window.openHub` 注册用例）。desktop 不变（255；Task 2/3 是 Electron 窗口/系统集成胶水 + SFC 薄渲染，无独立单测，靠 GUI 冒烟验证）。

**可达性方案（三入口冗余 + 持久）**：
- **openHub RPC**：ipc-router 用注入的 `settingsWindow()` 定位器 `show()`+`focus()`；overlay ⚙ 经此 RPC，未来托盘/菜单亦可复用。
- **全局热键 `Ctrl/Cmd+Shift+,`**：index 在 `whenReady` 直接 show+focus（不绕 RPC，主进程内最短路径）。
- **overlay ⚙ 按钮**：聊天浮层标题行齿轮，`title="设置 (Ctrl+Shift+,)"` 提示热键。
- **hide-on-close + isQuitting**：settings `close` 事件在非退出时 `preventDefault()`+`hide()`（窗口持久不销毁，保留渲染态）；真正退出时 `before-quit` 先置 `isQuitting=true` 并 `unregisterAll()`，故退出流程中 settings 的 close 放行，不卡退出。与既有 `maybeQuit`（character+overlay 都销毁→`app.quit()`）协同：quit 触发 before-quit→isQuitting=true→settings close 放行→干净退出。

**注**：overlay 聊天浮层最终玻璃形态是 B1=M8，本阶段 ⚙ 仅为临时入口验「能打开」，不要求其外观对齐设计图（见 CURRENT.md §5）。

**GUI 冒烟（待人工 —— M7b-1 P5 签收硬门槛，见 CURRENT.md §6）**：本执行对话为 CLI agent 环境，无法启 Electron GUI 并对照设计图 PNG 目视比对。需有桌面环境者 `pnpm --filter @desksoul/desktop dev` 后按下表执行回填，并对 Hub 壳/D4 做**保真度 pass**（Hub 壳比对 ui-design §3.3；D4 比对 `UI/4ba6005f-0abc-45f4-9690-2c5e7af15242.png` + §2 token），偏差立 polish task：

1. **打开**：按 `Ctrl+Shift+,` → Hub 出现并聚焦；overlay 点 ⚙ → 同样打开。 ☐
2. **持久**：关闭 Hub → 收起（app 不退）；再按热键 → 重新出现（未销毁，渲染态保留）。 ☐
3. **Hub 渲染**（M7a 累积）：左导航（§3.3 各组）+ 顶栏 + 状态条；切「显示与窗口」。 ☐
4. **主题**：切深色 → Hub + overlay 同时换肤 + 顶栏 `✓ 已保存`；重启 app → 保持。 ☐
5. **D4 缩放**：拖 slider → 角色实时缩放；松手 → `✓ 已保存`；重启 → 保持。 ☐
6. **置顶/穿透**：切换 → 角色窗即时响应。 ☐
7. **退出**：关角色+overlay → 进程正常退出（热键已注销、settings 不阻塞）。 ☐

> 风险：`globalShortcut.register` 若热键被系统/他 app 占用会静默返回 false（本阶段不做冲突检测，J2 录制器在 M8）；⚙ 与热键互为冗余，单一失败不致完全不可达。冒烟时若热键无效，用 ⚙ 验证其余项。

**衔接到 P3**：Hub 现可达，解锁后续 GUI 冒烟与 D3「配 Key」验收。P3 = D2 通用 + D6 隐私。

## 视觉保真 Harness + Hub/D4 首轮保真审计（plan `2026-06-18-visual-fidelity-harness-plan.md`）

**状态：✅ harness 落地（infra）+ Hub/D4 首轮保真修正完成**（分支 `feat/m7b1-d-series`）。验证：sidecar build 后 desktop **260 绿**（255 基线 + 新增 harness 单测 5：mock-bridge 3 / route 2，**0 回归**）/ typecheck（vue-tsc + tsc）exit 0。每 task 一提交。

### Harness（T1–T4）

| Task | commit | 内容 |
| --- | --- | --- |
| 1 | `c21dfad` | `renderer/dev/mock-bridge.ts` 内存版 `window.desksoul`（守卫 `'desksoul' in window` → 打包/Electron 下 no-op）；`getAll`/`set`→`changed` 广播；TDD 3 绿 |
| 2 | `5ac33bf` | `renderer/dev/route.ts`（`initialRoute` 读 `?page=`）+ settings/overlay `main.ts` mount 前 `installMockBridge()` + `App.vue` 初始路由读 query；TDD 2 绿 + typecheck |
| 4 | `44a4000` | `.gitignore` 加 `apps/desktop/artifacts/` + `.playwright-mcp/`（截图过程产物不入库） |

**闭环跑通（T3 Runbook 实证）**：`pnpm --filter @desksoul/desktop dev` 起 renderer dev server（`http://localhost:5173`）→ Playwright MCP `browser_navigate` 到 `/settings/index.html?page=system.display` + `browser_resize` 1080×720 → `browser_take_screenshot` → `Read` 截图比对 → 改 SFC → HMR 重截。`browser_evaluate` 调 `app.prefs.set` 切主题，浅/深双版当场生效（活 demo，证 `changed`→theme-resolver 链在浏览器内联通）。

### ⚠ 关键发现：设计图 PNG 文件名↔屏幕映射表损坏（回 PM）

`ui-design §4.1/§7` 与 `CURRENT.md §5` 把 D4 指为 `UI/4ba6005f-…`，但**逐张 `Read` 核实，该映射多处错位**：

| 文档标注 | 文件 | 实际像素内容 |
| --- | --- | --- |
| D4 显示与窗口 | `4ba6005f` | **A 系列「桌面宠物」设计规范**（A1 静默/A2 气泡/A3 穿戴 + 调色板）——非设置面板（§1767 也把此图标作「A3 穿透视觉指示」，自相矛盾） |
| D3 模型 API | `3c9a77c6` | **E2/E3 角色详情抽屉 + 角色包导入** |
| D2/D8 | `60ea4a18` | **B1/B2 聊天浮层 + 流式气泡** |
| D5/D6/D7 综合 | `1d7669e3` | ✅ 正确（自身标题即「D5 / D7 Light Mode」，**唯一可信的设置面板设计语言参考**） |

**结论**：无专属 D4 面板 PNG。本轮 D4 保真以 **`1d7669e3`（共享设置面板设计语言：卡片行/开关/滑块/分组/危险区）+ §7.4 文字版图 + §2 token** 为权威参照。**建议 PM 修订 §4.1/§7/CURRENT.md §5 的映射（按各 PNG 自身标题逐张重编），否则后续面板保真验收会持续踩错图。**

### Task 5：Hub + D4 保真审计 → 修正（commit 见末，仅动样式/结构，不改行为）

**优先修可复用件**（P3 的 D2/D6 直接复用）。逐项对 §2 token + §7.4 核出并修正：

| # | 偏差（修前） | 修正 | 文件 |
| --- | --- | --- | --- |
| 1 | **Slider 完全未样式化**（裸 `<input type=range>` → 浏览器/OS 默认蓝色滑块，且蓝=`--ds-cool` 语义错（冷色专用于连接/状态）） | 暖色品牌渐变填充（`--ds-pct` 变量驱动 `--ds-brand-from→to`）+ 白色圆 thumb（brand 描边）+ 固定宽 11rem；跨浏览器 `::-webkit/-moz` thumb | `Slider.vue` |
| 2 | **玻璃缺 `saturate(180%)`**（Tailwind `backdrop-blur-glass` 只给 blur）；**SettingSection 无阴影**（§2 要求所有玻璃面板带 `--ds-glass-shadow`，卡片显得扁平） | 收口 `.ds-glass` 单一真源（bg + 1px 描边 + `blur(28px) saturate(180%)` + shadow）于 `tokens.css @layer components`；`GlassPanel`/`SettingSection` 改用之 | `tokens.css` / `GlassPanel.vue` / `SettingSection.vue` |
| 3 | **Switch 开态 solid `--ds-brand-to`**（与 Button primary 的品牌渐变、与滑块暖色不一致） | 开态改品牌渐变 `linear-gradient(90deg, from, to)`，全局暖色一致 | `Switch.vue` |
| 4 | **Select 原生下拉箭头**（native chrome，出戏） | `appearance-none` + 自定义 `▾` chevron（wrapper relative 定位）；闭合态玻璃 bg/描边/圆角保留 | `Select.vue` |

**修后比对（浅/深双主题，artifacts/visual/*-v2.png）**：滑块/开关全局暖色一致、玻璃带 saturate+微阴影（卡片浮起）、Select 自定义箭头、`⚠ 实验性` 段保留 `border-warning` 琥珀描边（SettingSection 重构后 `tone="warn"` 经 Tailwind utilities 覆盖 `.ds-glass` 描边色，验证仍生效）。结构对 §7.4：角色/多显示器/不打扰/实验性 四组 + 卡片行「左 Label+Desc / 右控件」均符合。**判定：在 token/设计语言层面「够像」**。

**token 未改**：`tailwind.config.js`（radius 8/10/12/16/18 · spacing 4/8/12/16/24/32/48 · fontSize 12/13/14/16/20/28/36 · blur 28 · ease ds）与 `tokens.css` 色阶均已对齐 §2，无需校准。

### 残留偏差清单（回 PM —— 需设计决策 / 后续里程碑功能 / PNG 缺，本任务不硬啃）

- **Hub 左导航无图标**：§3.3 每项带 Lucide 图标（⌂◉✎⚡⊞☷⚙）；需引入图标集（Lucide）→ 单独决策。
- **顶层 leaf 目的地（总览/模型 API/插件/知识库）渲染成暗灰组标题**，与可展开组（角色/对话/系统）视觉无法区分，且不可点（`nav-tree` 中 children 为空）。改为可点 + 区分 = **行为变更**且当前无对应页（点了只显「留待 M7b」）→ 留后续阶段（随各页落地）。
- **顶栏仅占位文字「DeskSoul · 设置」**：§3.3 要角色头像（hover 切换）/ 面包屑 / 最小化关闭 → 需 M8 功能。
- **状态条仅「● 就绪」**：§3.3 要 live 连接/内存/模型 → 需真实数据源（后续）。
- **Slider 行无 min/max 翼标**：§7.4 示意 `缩放 50% ━●━ 200%` / `强度 弱 ━●━ 强`；当前用「Label + 当前值（100%）描述 + 右侧滑块」。低优先级 nuance，可后续加翼标。
- **子项层级缩进**：§7.4 把「切换热键 / LookAt 强度 / 实验性警告语」作父开关的缩进子项；当前是平铺同级行（功能等价，层级感弱）。
- **§7.4 未实现的功能行**：「切换热键 [Ctrl+Shift+P]」（J2 录制器=M8）、「计划不打扰 23:00→08:00」时段选择器、缩放「80px 微缩剪影实时预览」（需 mini 角色渲染——plan 已预判为残留）。
- **Select 弹出选项列表仍 native**：闭合态已玻璃化，完整自定义下拉浮层 = 较大组件，留后续。
- **overlay ⚙ 入口外观**：B1 聊天浮层最终玻璃形态=M8，本阶段不要求对齐（沿用 P2.5 约定）。

> 残留多为「后续里程碑功能（M8 / live 数据 / 图标集）」或「设计决策（映射表修订 / 缩进层级 / 翼标）」，非本期纯样式可闭合项。

**人工终审（仍待）**：CLI agent 环境用 Playwright MCP 在 renderer dev server（非 Electron 真窗）做了截图比对；M7b-1 P5 签收前仍需 `pnpm --filter @desksoul/desktop dev` 在真 Electron 下目视复核（兜玻璃 backdrop-filter 在透明窗的真实表现等最后一公里）。
