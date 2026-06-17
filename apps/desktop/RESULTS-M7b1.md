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
