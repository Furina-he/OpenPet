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
