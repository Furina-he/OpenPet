# RESULTS · M7b-1 D 系列设置面板（分阶段累积）

> 多阶段里程碑，逐阶段追加；M7b-1 全部完成后定稿 + 打 tag（[[milestone-results-convention]]）。
>
> ⚠ **勘误（2026-06-19）**：下方 P2/P3/P4 段里"D2/D3/D4 无专属图、参 `1d7669e3`"等表述**已作废**——经设计作者逐张核准，**43 屏全有专属高保真图**（D1/D2=`774644b7`、D3/D4=`36b542fb`、D5/D7=`1d7669e3`、D6/D8=`7075fa1f`…见 ui-design v0.2 §4）。当时实现以设计语言 + §2 token 做出，与高保真图**吻合，无需返工**；GUI 终审（P5）改按各屏专属图核。

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

## P3 · D2 通用 + D6 隐私（+ ConfirmDialog 二次确认 + 共享 polish）

**状态：✅ 完成**（分支 `feat/m7b1-d-series`）。验证：protocol build + sidecar build 后 desktop **262 绿**（260 基线 + privacy-risk 新测 2，**0 回归**，`nav-tree.test` 仍 3 绿）/ typecheck（vue-tsc + tsc）exit 0 / 工作树干净。每 task 一提交。

| Task | commit | 内容 |
| --- | --- | --- |
| 1 | `c35d62a` | 左导航 Lucide 图标（每组挂 `icon`，App.vue `<component :is>` 渲染 16px/1.5 描边）+ `system` 组首位加 `system.general` 叶子（§3.3/§2.5） |
| 2 | `10d4bd5` | `Slider.vue` 加 `minLabel/maxLabel` 翼标（flex 包裹原 input，不改 emit/填充行为）+ `SettingCard.vue` 加 `indent` 子项缩进（`pl-8 pr-4`） |
| 3 | `8b2cbb6` | D2 `GeneralPage.vue`（§7.2 启动/语言地区/更新/通知/Agent思考/开发者 6 组，全键绑 prefs）+ App.vue 接 `system.general` |
| 4 | `b98dd4a` | `privacy-risk.ts`（`isHighRisk`/`needsConfirm`，TDD 先红后绿 2 测）+ `ConfirmDialog.vue`（§2.8 ②级整张红描边 + danger 确认按钮） |
| 5 | `d348667` | D6 `PrivacyPage.vue`（§7.6 API Key加密/内容上送/系统访问/遥测崩溃 4 组）+ 截屏/摄像头 off→on 走 ConfirmDialog + App.vue 接 `system.privacy` |
| 6 | （本提交） | 视觉闭环比对 + 全量回归 + RESULTS P3 + prettier（本阶段文件） |

**测试增量**：desktop 260→**262**（`privacy-risk.test.ts`：`isHighRisk` 截屏/摄像头判定、`needsConfirm` 仅高风险 off→on）。protocol 不变（本阶段未改 protocol src）。

**D6 二次确认做实（§2.8 ②级，Playwright MCP 实证）**：
- **判定逻辑（TDD）**：`needsConfirm(key, from, to) = isHighRisk(key) && !from && to`——仅截屏/摄像头、且从关到开才需确认；关闭、非高风险（麦克风等）直接落盘。
- **确认路径**：点 屏幕内容（截屏）开关 off→on → 弹整张红描边对话框「允许读取屏幕内容（截屏）？」，**此时开关仍 OFF（持有未落盘）** → 点「确认开启」→ 开关转 ON（`aria-checked=true`）、`app.prefs.set` 落盘、对话框关闭。✅
- **取消路径**：点 摄像头 off→on → 弹「允许访问摄像头？」→ 点「取消」→ **开关保持 OFF**（`aria-checked=false`）、未落盘、对话框关闭。✅
- 即 §2.8 ②级语义完整：高风险开启前红描边二次确认，确认才生效、取消即回退。

**共享 polish（顺带闭合「视觉保真 Harness」首轮 3 项残留）**：
- nav 左导航 Lucide 图标 ⇒ 闭合残留「Hub 左导航无图标」。
- Slider `低 ━●━ 高` 翼标 ⇒ 闭合残留「Slider 行无 min/max 翼标」（D2 主动发言频率实证：翼标 + 暖色填充 + 白圆 thumb）。
- SettingCard `indent` 子项缩进 ⇒ 闭合残留「子项层级缩进」（D2「主动发言频率」作「角色主动发言」缩进子项实证）。

**视觉闭环比对（Playwright MCP，renderer dev server `localhost:5173`，1080×720，浅/深双版，参照 `UI/1d7669e3` 设置设计语言 + §7.2/§7.6 + §2 token）**：

| 屏 | 浅色 | 深色 | 判定 |
| --- | --- | --- | --- |
| D2 通用 | 分组卡（启动/语言地区/更新/通知/Agent思考/开发者）+ 暖色开关 + 玻璃化 Select（chevron）+ nav 图标 | 暗玻璃卡对比正常、暖色开关仍醒目、文字可读 | 在 token/设计语言层「够像」 ✓ |
| D2 主动发言频率（子项） | 缩进子项 + 滑块 `低 ━●━ 高` 暖色填充 | — | 翼标 + 缩进符合 §7.2 ✓ |
| D6 隐私 | 4 组卡 + 系统访问段（默认全关：剪贴板/截屏/摄像头 off，麦克风/通知/画像 on）+ 上下文窗 Select | 暗玻璃卡对比正常、开关态正确（截屏 ON/摄像头 OFF 验证 gating 持久） | 够像 ✓ |
| D6 ConfirmDialog | 半透明遮罩 + 整张红描边 + danger「确认开启」按钮 + 标题/说明 | — | §2.8 ②级符合 ✓ |

> 两面板复用「视觉保真 Harness」已调优的 `.ds-glass`(blur+saturate+shadow)/`Slider`(暖色)/`Switch`(渐变)/`Select`(chevron)，故面板级无新增散装样式偏差；本轮闭环主要验「组合后整体够像」+「ConfirmDialog 红描边」+「polish 三项落地」。

**残留 / 回 PM（非本期纯样式可闭合）**：
- **`lucide-vue-next@1.0.0` 已 deprecated（上游改名 `@lucide/vue`）**：1.0.0 是可用终版（dist/types/图标齐全，typecheck+渲染均正常），本期按计划沿用以贴合 plan import；**建议后续（M9 打磨期）迁到 `@lucide/vue`**。属技术债，不阻塞。
- 顶层 leaf 组（总览/模型 API/插件/知识库）仍渲染为带图标的不可点组标题（children 空）——与可展开组视觉难区分，且点无页（留各页落地阶段）。沿用「视觉保真 Harness」残留判定。
- Select 弹出列表仍 native（闭合态已玻璃化）；顶栏/状态条仍占位（M8 / live 数据）；存而不接开关（剪贴板/截屏/摄像头/麦克风等系统访问的真实 OS 权限接入）留后续——本期仅「渲染 + 持久 + 高风险二次确认」。
- **真 Electron 目视终审仍待**（同前述 P5 硬门槛）：本轮为 renderer dev server 浏览器截图，非透明 Electron 真窗。

**prettier**：仅 `--write` 本阶段新写/改文件（GeneralPage/PrivacyPage/ConfirmDialog/privacy-risk/nav-tree/App.vue/Slider/SettingCard/privacy-risk.test）；未动 methods.ts/index.ts 等存量欠账文件（[[build-test-workflow-gotchas]]）。

**PM 复核（2026-06-18，独立验证，不凭报告）**：✅ **签收**。
- git 提交链 6 commit 顺序核实、工作树干净；自跑 sidecar build → desktop **262 绿**（含 `privacy-risk` 2 / `nav-tree` 3）+ protocol **178 绿** + 全仓 typecheck **12/12**。
- `privacy-risk.test.ts` 读源确认真测门控（`isHighRisk` 截屏/摄像头、`needsConfirm` 仅高风险 off→on）；`PrivacyPage.vue` 接线核实——仅 `screenshot/camera` 走 `toggleSwitch`，确认前 `return` 不落盘，`onConfirm` 才 `set`，`onCancel` 仅关框。
- 视觉闭环 PM 自跑（dev server + Playwright MCP，1080×720）：D2 浅 / D6 浅+深 / ConfirmDialog 对照 `UI/1d7669e3` **够像**；端到端实证截屏 off→on 弹整张红描边框、`aria-checked` before/after 均 `false`（开关持 OFF 未落盘）、取消回退。console 仅 favicon 404（无害）。
- 残留（lucide-vue-next 已 deprecated / 顶层 leaf 组空 / Select native / 存而不接系统访问 / 真 Electron 目视终审）认可，归 P5 硬门槛把关。

**衔接到 P4**：D3 模型 API（双栏）+ chat 集成（active provider/model→chat.send）。

## P4 · D3 模型 API（双栏）+ chat 集成（active provider/model → chat.send）

**状态：✅ 完成**（分支 `feat/m7b1-d-series`）。验证：sidecar build 后 desktop **273 绿**（262 基线 + 新测 11，**0 回归**，`chat-service` 22 / `nav-tree` 3 仍绿）/ 全仓 typecheck（vue-tsc + tsc）**12/12 exit 0** / 工作树干净。**protocol src 零改动**（`ChatRequest.model`、`chat.send{providerId?}`、`provider.*` 6 RPC、`model/budget/offline` prefs 键 M5/M7a 已就绪）。每 task 一提交。

| Task | commit | 内容 |
| --- | --- | --- |
| 1 | `3ec7fa1` | `provider-status.ts`：`providerDot({hasKey,lastTestOk?})→ok/pending/fail`（测失败优先）+ `DOT_COLOR`（TDD 3 测先红后绿） |
| 2 | `7e4e063` | `key-reveal.ts`：`maskKey`（>8 留首尾4）+ `KeyReveal`（显示后 5s 自动遮回，timer 可注入）（TDD 4 测） |
| 3 | `66a88ba` | `context-assembler`：`AssembleInput.model?` 透传进 `ChatRequest.model`（条件展开满足 `exactOptionalPropertyTypes`）（+1 测，原 6 仍绿） |
| 4 | `d7076a9` | `chat-resolve.ts`：`resolveSendTarget(explicit, staticChain, resolved)→{chain, model?}` 纯函数（TDD 3 测） |
| 5 | `1066882` | `ChatService` 加 `resolveModel?` 注入 + `send()` 用 `resolveSendTarget`；`ipc-router` 从 prefs 注入 `resolveModel`（读 `model.activeProvider/activeModel`） |
| 6 | `6efdd61` | `KeyInput.vue`（password 遮罩 + 眼睛 `KeyReveal` + 保存/清除 emit）+ `ProviderList.vue`（左栏列表 + `providerDot` 状态点） |
| 7 | `3329bf5` | `ModelApiPage.vue` 双栏（左 Providers / 右 Key+Endpoint+默认模型+测试连接）+ 页底预算告警卡 + 离线兜底卡（§7.3） |
| 8 | `15750d5` | `App.vue` 接 `active==='model'`→ModelApiPage + nav 空 children 组改可点 button（闭合 P3「带图标不可点组」残留） |
| — | `d4f1ece` | （dev harness）`mock-bridge.ts` 加 `provider.*` 内存实现（仅浏览器预览渲染 D3；Electron 下 no-op） |
| 9 | （本提交） | 视觉闭环（Playwright MCP 浅/深）+ 全量回归 + RESULTS P4 + prettier（仅本期新文件） |

**测试增量**：desktop 262→**273**（+11）：`provider-status` 3 / `key-reveal` 4 / `chat-resolve` 3 / `context-assembler` +1（6→7）。`mock-bridge.test` 仍 3 绿（仅加 case，未加测）。protocol 不变。

**chat 集成做实（纯函数 TDD + 接线，断言明确）**：
- `resolveSendTarget`（`chat-resolve.test.ts` 3 测断言）：① 显式 `providerId` 优先 → `{chain:[explicit]}`，忽略 resolved；② 无显式 → 以 `resolved.providerId` 作 chain 首项 + 透传 `resolved.model`；③ resolved 无 providerId → 回退静态 chain，无 model 则**不带 `model` 键**（空静态链 → `{chain:[]}`）。
- `assembleContext` model 透传（`context-assembler.test.ts` +1）：给 `model`→`ChatRequest.model===该值`；不给→`'model' in req===false`（条件展开，满足 `exactOptionalPropertyTypes`）。
- `ChatService.send()`：`resolved = providerId ? undefined : this.resolveModel?.()` → `resolveSendTarget(providerId, this.providerChain, resolved)` 取 `{chain, model}` → `assembleContext({..., ...(model?{model}:{})})`。`resolveModel` 缺省 `undefined` ⇒ 行为与改前完全一致 ⇒ **`chat-service.test.ts` 22 测 0 回归**（实证）。`ipc-router` 注入：`resolveModel:()=>{const p=prefsStore.getAll(); return {...(p['model.activeProvider']?{providerId}:{}), ...(p['model.activeModel']?{model}:{})}}`。
- **worker 零改动 + 缺省模型已兜底**（读源核实）：四 adapter 均 `req.model ?? dialect.defaultModels[0]`（`anthropic.ts:13`/`openai-compat.ts:49`/`ollama.ts:14`/`gemini.ts:16`）⇒ 即使 `activeModel` 为空，选定 provider 仍发其默认模型。「配 Key→听到回复」链路：D3 选 provider（写 `activeProvider`）→ `chat.send` 无显式 providerId → resolveModel 读 prefs → chain=[该 provider]、model=activeModel（空则 worker 补默认）→ Main 侧 Keychain 注入密钥 → 流式回灌。
- **端到端「配真实 Key→overlay 听到该 provider 流式回复」本会话未实跑** → **留 P5**（真 Electron 目视终审一起）。原因：① 视觉闭环是浏览器 + `mock-bridge`（无真 fetch/worker）；② 本机 Electron 主进程 `better-sqlite3` 原生模块 ABI 不匹配（NODE_MODULE_VERSION 127≠123，dev 降级内存库）——非本期代码问题，需先 `electron-rebuild`。建议 P5 用 `claude`/`openai` + 默认模型实跑 90s 旅程。

**视觉闭环比对（Playwright MCP，dev server `localhost:5173/settings/index.html?page=model`，1080×720，浅/深双版；D3 无专属 PNG → 参照 `UI/1d7669e3` 设置设计语言 + §7.3 文字图 + §2 token）**：

| 项 | 浅色 | 深色 | 判定 |
| --- | --- | --- | --- |
| 双栏布局 | 左 `.ds-glass` Providers（240px）/ 右详情，圆角卡 | 暗玻璃双栏正常 | §7.3 ✓ |
| 状态点 | Claude/Ollama 暖色点（已配/免Key）、其余灰点（待填 Key） | 暗底仍醒目 | 见残留①（暖色 vs §7.3「绿点」） |
| Key 遮罩 | `sk-...` placeholder + 眼睛 + 渐变「保存」（空时 disabled） | 暗玻璃输入正常 | §7.3「点眼睛显示 5s」✓ |
| Endpoint | `https://api.openai.com/v1` 灰字只读 | 同 | 只读端点 ✓（覆盖留后续） |
| 默认模型 | `gpt-4o-mini ▾` 玻璃 Select | 同 | §7.3 ✓ |
| 测试连接 | 渐变按钮 + 结果文案位 | 同 | §7.3 ✓ |
| 预算告警卡 | 启用开关 / ¥月上限 / 已使用 `¥0.00 / —` 占位 / 阈值滑块（80% 暖填充+0%~100%翼标）/ 达上限 Select | 暗卡正常 | §7.3 ✓（计量存而不接） |
| 离线兜底卡 | 三选一 Select（Ollama/演示/报错）+ 缩进 Ollama 备用模型 Select | 暗卡正常 | §7.3 ✓（行为存而不接） |
| Hub nav | 空组（总览/模型API/插件/知识库）改可点带图标项；「模型 API」高亮 | 同 | 闭合 P3「空组不可点」✓ |

> 复用 Harness 已调优 `.ds-glass`/`Slider`(暖色)/`Switch`/`Select`(chevron)，无新增散装样式；console 仅 favicon 404（无害）；深色经 `app.prefs.set display.theme=dark` 实证 `data-theme=dark` 即时换肤。

**范围落实（PM 范围段对照）**：
- **做实**：provider 列表（`listProviders`）+ 状态点 / 选 provider→`set model.activeProvider` / Key 配置（`saveKey`+`deleteKey`，KeyInput「清除」触发）/ 默认模型（`listModels` 填 Select→`set model.activeModel`）/ 测试连接（`testConnection`→点色+文案）/ Ollama 检测（`ollamaDetect`）/ **chat.send 动态解析**（resolveModel→resolveSendTarget）。
- **渲染+持久、存而不接**：预算告警卡（`budget.*`；「已使用」占位 `¥0.00 / —`，无 cost 聚合源）；离线兜底卡（`offline.*`；真实「全 provider 不可用→切 demo/error」未接，现仅 providerChain 顺位降级）；Endpoint（dialect `baseUrl` 只读，覆盖未持久化）。
- **留后续（未做）**：添加自定义/兼容 provider、多套同 provider+右键复制、per-provider enabled 开关、baseUrl/默认模型覆盖持久化、高级（超时/重试/代理/Stream 协议）、`app.openExternal` 文档外链（随 P5 D8）。对应 §7.3 图中「+添加 Provider / 自定义 / 可用模型勾选启用 / 高级 / 删除该 Provider」，按范围段刻意不实现。

**偏离 plan 的实现（「以现有为准」必要适配，记录待 PM 认可）**：
1. **`ipc-router` 把 `prefsStore` 声明上移**到 `new ChatService(...)` 之前——使 `resolveModel` 闭包合法引用；逻辑等价。
2. **`resolveModel` 用条件展开**而非 plan 字面 `providerId: p[...] || undefined`——后者在 `exactOptionalPropertyTypes` 下不可赋给 `{providerId?:string}`（显式 undefined 违例），改 `...(p[..]?{providerId}:{})`，语义同（空串=省略）。
3. **`KeyInput.vue` 只 import `KeyReveal`（不 import `maskKey`）**——原生 `type=password` 即遮罩；`maskKey` 仍导出 + 单测（Task 2），留「遮罩态明文预览」未来用。并**加「清除」按钮**（gated on hasKey）使 `clear` emit→`deleteKey` 落地（deleteKey 在做实清单）。
4. **`mock-bridge.ts` 加 `provider.*` 内存实现**（commit `d4f1ece`）——D3 onMounted 调 `listProviders/ollamaDetect`，dev 浏览器无真后端则渲染空；仅 dev 预览设施（Electron 下 `'desksoul' in window` 守卫 no-op），非生产路径。
5. **provider/model 一致性**：依「worker 缺省模型兜底」结论，`onSelect` 仅写 `activeProvider`（遵 plan）；右栏默认模型 Select 显示值取 `activeModel∈当前provider模型 ? activeModel : 该provider首模型`（= worker 实际所用），用户改即持久。

**残留 / 回 PM（需设计裁决，未自行扩范围）**：
- **① 状态点「ok」用品牌暖色 `--ds-brand-to`(#ff8fab)**（遵 plan「绿用品牌暖色」注释）**，§7.3 文字图写「绿点」**；§2 有 `--ds-success`(#7fe3a1) 绿 token 可用。**未自行改**（按交接「设计取舍先记 RESULTS 回 PM」），PM 定夺保暖色还是换 success-green。
- **② 右栏标题对 OpenAI 显示「OpenAI · OpenAI」**（name == format 标签）显冗余；其它 provider 正常（「Claude · Anthropic」「DeepSeek · OpenAI」）。可在 `name===formatLabel` 时省略后半，属 polish，待 PM 取舍。
- **真 Electron 目视终审 + 真 Key 端到端 90s 旅程仍待**（P5 硬门槛）：本轮为浏览器 mock 截图；真窗需先解 `better-sqlite3` ABI（`electron-rebuild`）。

**prettier**：仅本期**新增文件** `--write`（provider-status/key-reveal/chat-resolve + 各 test、KeyInput/ProviderList/ModelApiPage）；**改动的存量文件**（context-assembler/.test、chat-service、ipc-router、App.vue、mock-bridge、本 RESULTS）只手写保证自己新增行符合 prettier，**不 --write 整文件**（避免重排 P1–P3 旧表/旧测行，[[build-test-workflow-gotchas]]）。

**PM 复核（2026-06-18，独立审计；按 [[pm-review-trust-reports]] 口径不重跑已通过测试）**：✅ **签收（功能 + 集成 + 测试做实）**；2 视觉 polish 裁决转 P5。
- 提交链 10 commit 顺序核实、工作树干净；测试数信任报告（desktop 273 / protocol 178 / typecheck 12/12）。
- chat 集成读源审计：`chat-service` resolveModel 缺省 `undefined`→`resolveSendTarget` 回退静态链 + 省 model→行为同改前（22 测 0 回归有据）；`ipc-router` prefsStore 上移 + 条件展开注入（偏离 1/2，`exactOptionalPropertyTypes` 必要，等价）；`mock-bridge` `'desksoul' in window` 守卫 = Electron no-op（偏离 4，dev-only 不污染生产）。**偏离 1–5 全部认可**。
- **视觉裁决（PM）**：① 状态点 `ok` **改 `--ds-success` 绿**——§7.3 明写「绿点」，`--ds-brand-to`(#ff8fab) 是粉红暖色，违「冷色仅状态用」约定；此为 **P4 plan 的 `DOT_COLOR` 疏漏**（执行者忠实遵循 + 诚实回报，非执行问题）。② provider 标题 `name===formatLabel` 时**省后半**（去「OpenAI · OpenAI」冗余）。二者纯样式微调，纳入 **P5 polish**（真 Electron 窗终审时一并目视调）。
- 残留③（真窗目视终审 + 真 Key 端到端 90s）认可，P5 先 `electron-rebuild`（[[p5-electron-gui-smoke-blocker]]）。

**衔接到 P5**：D8 关于（接 `openExternal` 外链）+ 全量验收（含**真 Electron GUI 冒烟 + 真 Key 端到端**）+ RESULTS 定稿 + tag。

---

## P5 · D8 关于 + D3 视觉 polish + 真 Electron 验收 + 收尾

**状态：代码全完成 + 全量绿（自跑）；真窗/真 Key 人工验收待人执行（诚实记录，未假装跑过）。** 分支 `feat/m7b1-d-series`。

| Task | commit | 内容 |
| --- | --- | --- |
| 0 | （环境，非提交） | better-sqlite3 ABI 收口：证实 node(127)↔electron(123) 互斥，二者均可经 prebuild-install + npmmirror 产出并验证；详见下「Task 0 收口」 |
| 1 | `c59ae55` | D3 polish：状态点 `ok`→`--ds-success` 绿 + provider 标题 `name===formatLabel` 去冗余（PM 裁决落地） |
| 2 | `6f147e9` | D8 AboutPage（§7.8 五区：版本/致谢/帮助/诊断/法律）+ App.vue 接 `system.about`；外链经 `app.openExternal` |
| 3 | `3e93b21` | D8 视觉 pass：帮助/诊断改 SettingCard 行式、补「给作者写信」邮件行、致谢许可证独立行（对齐 §7.8 行布局） |

### Task 0 收口（[[p5-electron-gui-smoke-blocker]] 实质解决）

- **plan 假设 `electron-rebuild` 二进制存在 → 实际未装**（`@electron/rebuild` 不在依赖）。改用等价内核 `electron-builder install-app-deps`（已装），但 pnpm 严格 node_modules 下报 `cannot find prebuild-install` 且**静默把二进制换成 electron-ABI(123)**——导致 vitest（Node 22 = ABI 127）`ERR_DLOPEN_FAILED`。
- **根因确认**：错误信息明确 `NODE_MODULE_VERSION 123 vs 127`。即 **vitest 要 node-ABI(127)、Electron 30 要 electron-ABI(123)，同一 `better_sqlite3.node` 文件互斥**（这正是 blocker 本质，非可同时满足）。
- **解法（直接调 better-sqlite3 自带 prebuild-install，镜像走 npmmirror）**：
  ```bash
  # 还原 node-ABI(127)（跑 vitest 用，仓库默认态）：
  cd node_modules/.pnpm/better-sqlite3@11.10.0/node_modules/better-sqlite3
  npm_config_better_sqlite3_binary_host_mirror=https://registry.npmmirror.com/-/binary/better-sqlite3 \
    node <repo>/node_modules/.pnpm/prebuild-install@7.1.3/node_modules/prebuild-install/bin.js \
    --runtime node --target 22.20.0 --arch x64 --platform win32
  # 换 electron-ABI(123)（人工 `pnpm dev` GUI 冒烟前用）：把上面 --runtime/--target 改为 electron / 30.5.1
  ```
  > EBUSY 坑：换二进制前必须先杀残留 `electron.exe`（dev 退出后子进程仍持 `.node` 锁）。
- **electron 运行时实证**：换 electron-ABI 后 `ELECTRON_RUN_AS_NODE=1 electron -e "new (require('better-sqlite3'))(':memory:')…"` →`ELECTRON better-sqlite3 OK, modules=123, electron=30.5.1`（建表+插入成功）。**即人工 `pnpm dev` 时 Electron 会用原生 better-sqlite3，不降级 in-memory**（Task 0 Step 2 实质达成）。
- **交付态**：仓库二进制**已还原 node-ABI(127)**（`pnpm --filter @desksoul/desktop test` 默认绿）。**人工跑真窗前需先换 electron-ABI(123)，跑完若要再跑 vitest 须换回。**建议后续（M8/打包）引入 `@electron/rebuild` 或 `pnpm dev` 前置脚本固化此切换。

### Task 1 · D3 polish（视觉闭环实证）

- 浏览器 harness（`?page=model` 1080×720）截图 + `getComputedStyle` 取色：**绿点 = `rgb(127,227,161)` = `#7fe3a1` = `--ds-success` 精确命中**；待填灰点 = `--ds-text-sub`。Claude（有 Key）/Ollama（免 Key）显绿，其余灰。
- **标题去冗余**：activeProvider=OpenAI 时右栏标题只显「OpenAI」（不再「OpenAI · OpenAI」）；`name!==formatLabel` 的（Claude · Anthropic 等）照常显格式标签。
- `providerDot` 逻辑/3 测不变（仅常量改色，无需改测）。

### Task 2/3 · D8 AboutPage（§7.8）

- 五区齐：**版本**（名/版本/构建/slogan + [检查更新 disabled][打开官网][GitHub][社区]）、**致谢**（OSS 列表 + [完整开源许可证]）、**反馈与帮助**（用户手册[打开]/报告问题[GitHub Issues]/社区交流[Discord]/给作者写信 hello@desksoul.app）、**诊断**（[生成 .dsdiag] disabled + 说明）、**法律**（服务条款/隐私政策/开源许可证 (MIT)）。
- 外链全经 `window.desksoul.rpc('app.openExternal',{url})`（P1 RPC，仅放行 http/https）。**URL/邮箱为占位常量**，上线前替换（文件内已标注）。
- **存而不接**：[检查更新]（无 updater）、[生成 .dsdiag]（无诊断聚合后端）——均 disabled + title 提示。
- 视觉闭环：`?page=system.about` 浅/深 截图逐区对照 `UI/1d7669e3` + §7.8 + §2 token，浅/深双主题均忠实（玻璃卡/暖灰边按钮/行分隔线/字阶）。

**偏离 plan 的实现（待 PM 认可）**：plan 给的 AboutPage 代码把帮助/诊断画成按钮 chip 排且漏「给作者写信」行。Task 3 视觉 pass 据 **§7.8 文字图实读**（帮助/诊断是「标签左+动作右」行式、含第 4 行邮件）改为复用 `SettingCard` 行式 + 补邮件行（display-only，邮箱非 mailto——`openExternal` 仅 http/https）。**纯视觉对齐 §7.8 + 复用既有组件，未扩功能**；属 Task 3「偏差修正」职责内。

### Task 6 · 全量验收（自跑，[[pm-review-trust-reports]] 口径可信）

| 项 | 结果 |
| --- | --- |
| protocol build / sidecar build | tsc 干净 |
| `pnpm -r typecheck` | 10/10 包 Done（exit 0） |
| `pnpm --filter @desksoul/desktop test` | **273 passed (45 files)** |
| `pnpm --filter @desksoul/protocol test` | **178 passed (10 files)** |
| `pnpm --filter @desksoul/desktop build` | electron-vite build **exit 0**（三 renderer 全产出） |

> D8 未加单测：AboutPage 纯展示/外链无逻辑，遵「SFC 薄渲染、逻辑下沉纯 TS 测、不引入 @vue/test-utils」约定。测试数维持 273（= P4 基线，无回归）。

### Task 4/5 · 真 Electron GUI 冒烟 + 真 Key 端到端 —— ⚠ 人工待执行（执行体能力边界，未假装跑过）

**已做到的自动化代偿**：
- better-sqlite3 在 Electron 30.5.1 运行时可加载（上「Task 0 收口」实证）→ 真窗不降级 in-memory。
- D8/D3 renderer 视觉经浏览器 harness 逐屏对照设计图（本阶段）；D2/D4/D6/Hub 见 P2.5/P3/P4 harness 抽验。
- D8 外链 renderer 侧确认正确调用 `app.openExternal` RPC。

**仍需人工真窗终审（执行体无法代劳的部分）**：
- 透明 Electron 窗的合成/置顶/点击穿透、D4 缩放实时联动、真 app 重启后主题/缩放持久（OS 级，非浏览器可验）。
- D8 外链点击是否真在**系统浏览器**打开（`shell.openExternal` OS 行为）。
- D6 高风险二次确认在真窗的红描边 ConfirmDialog 目视。
- **真 Key 端到端**：填真实 API Key→[测试连接]绿→overlay 发消息→听到**该 provider+model 的流式回复**（表情/动作双轨）。**执行体无真实 Key、无法"听到"流式回复**，必须人工。

> 人工步骤：①按上「Task 0 收口」命令把二进制换 electron-ABI(123)；②`pnpm --filter @desksoul/desktop dev`；③按 plan Task 4/5 清单逐项目视/实测，偏差回填本节。**跑完若要再跑 vitest，须把二进制换回 node-ABI(127)。**

### 残留总账（P5）

- **真窗 GUI 冒烟 + 真 Key 端到端 = §6 硬门槛，仍待人工**（上节）。这是「不签收」的唯一卡点。
- better-sqlite3 双 ABI 切换尚未脚本化（手动命令；建议 M8/打包引入 `@electron/rebuild` 固化）。
- D8 外链 URL/邮箱为占位常量；[检查更新]/[生成 .dsdiag] 存而不接（无 updater/诊断后端）；七连击开发者模式彩蛋留后续。

### tag 决策 → 回 PM 裁定（未自行打）

**`mvp/M7b1-done` 暂未打。** 依 CURRENT.md §6「P5 前必须完成一次对齐设计图的完整 GUI 冒烟，否则不签收」，而真窗 GUI 冒烟 + 真 Key 是**人工硬门槛、执行体无法代劳**。按交接「诚实红线」不假装跑过、不自行扩范围 → **不擅自 tag**，请 PM 在人工 GUI 冒烟 + 真 Key 通过后裁定打 tag（或授权先 tag 代码完成态、GUI 冒烟另记）。

### PM 复核（2026-06-19，独立审计；[[pm-review-trust-reports]] 口径不重跑测试）

✅ **代码层签收**（D3 polish + D8 AboutPage + Task 0 ABI 收口）；真窗 GUI 冒烟 + 真 Key = §6 人工硬门槛仍未做 → **暂不打 `mvp/M7b1-done`**，待人工通过或用户授权先 tag 代码态。 **→ 用户裁定 (b)（2026-06-19）：已打 `mvp/M7b1-code-done` 标记代码完成态；收官 tag `mvp/M7b1-done` 待人工真窗 GUI 冒烟 + 真 Key 通过后由 PM 补打。**
- 提交链 4 commit（`c59ae55`/`6f147e9`/`3e93b21`/`76e298b`）核实；测试信任自跑（273/178/typecheck 10/10/build exit 0，未重跑）。
- 读码：`provider-status.DOT_COLOR.ok='var(--ds-success)'` + 标题 `name===formatLabel` 去冗余 ✓；`AboutPage.vue` 五区齐 + 外链经 `app.openExternal` + 检查更新/诊断包 `disabled`（存而不接）✓。偏离 plan（SettingCard 行式 + 补「给作者写信」邮件行）认可——对齐 §8.8 行布局。Task 0 双 ABI 互斥（node-127 ↔ electron-123）查清 + prebuild-install 切换命令 + electron 运行时实证可加载，专业，认可。
- ⚠ **D8 视觉基准更正**：Codex 按旧 plan 对照了 `1d7669e3`（含 `AboutPage.vue` 注释 line 1），D8 正确专属图 = **`7075fa1f` 右半**（ui-design v0.2 §4）。但 D8 五区源自 §8.8（= `7075fa1f` 的 D8），结构吻合 → 预计无需回炉；**像素终审归人工真窗冒烟，按 `7075fa1f` 核 D8**，若需微调连注释 `1d7669e3→7075fa1f` 一并改。

---

## M7b-1 整体收尾小结（P1–P5）

| 阶段 | 交付 | 测试 |
| --- | --- | --- |
| P1 | prefs schema 扩容 + effects 接依赖 + `app.openExternal` | desktop 254 / protocol 177 |
| P2 | D4 显示与窗口（SettingSection + characterScale 收编） | desktop 255 |
| P2.5 | Hub 可达性（openHub RPC + 热键 + overlay ⚙ + hide-on-close） | desktop 255 |
| 视觉 harness | dev mock-bridge + `?page=` route + Playwright MCP 截图↔PNG 闭环 | desktop 260 |
| P3 | D2 通用 + D6 隐私（ConfirmDialog 二次确认 + nav polish） | desktop 262 / protocol 178 |
| P4 | D3 模型 API 双栏 + chat 集成（resolveModel，worker 零改动） | desktop 273 / protocol 178 |
| **P5** | **D8 关于 + D3 两 polish + 全量验收 + Task 0 ABI 收口** | **desktop 273 / protocol 178 / build exit 0** |

**成果**：D 系列 5 面板齐（D2 通用 / D3 模型 API / D4 显示与窗口 / D6 隐私 / D8 关于）+ chat 动态 provider/model 集成 + Hub 可达 + 视觉保真 harness + prefs 即时生效契约全链。**desktop 273 / protocol 178 / typecheck 10/10 / electron-vite build exit 0**（全自跑实测）。
**唯一未竟 = §6 真窗 GUI 冒烟 + 真 Key 端到端（人工硬门槛）**；Task 0 已为其铺平（electron-ABI 二进制可产出且实证可加载）。tag 待 PM 在人工验收后裁定。
