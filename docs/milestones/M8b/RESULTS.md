# M8b 交付结果（RESULTS）

> spec [`spec.md`](spec.md) · plans [`plans/`](plans/)。桌面层：A1 交互补全 + A2 桌面气泡 + A3 穿透反馈 + A4 徽标/全屏。
> 状态：**代码完成 + 全量绿 + build exit 0**；真窗行为/视觉冒烟 = 人工硬门槛待跑。

## 摘要

- **A1 角色交互补全**：`interaction-zones.ts`（tapZone 头/身分区 + classifyPress 短按判定，纯）；`interaction.ts` 补 tap（→`character.tap` 上报，Main 广播 behavior 保持哑播放器）/双击（→`app.window.showChat`）/右键（→`app.window.popCharacterMenu` 原生菜单）/hover>800ms 提示（`#tooltip`）。新 RPC `showChat` + `popCharacterMenu` + `character.tap`；共享菜单模板 `character-menu.ts`（A1 右键 / 后续托盘复用）。
- **A2 桌面气泡**：character 窗内 `#bubble` DOM 层（不新建窗）；`bubble-timer.ts`（durationMs 3/5/8/always + bubbleSide 方向自适应，纯）；`bubble.ts` 控制器订阅 `chat.stream` 逐字 + 自动消失（pref `display.bubbleDuration`）+ 上/下方向；流结束 `endStream` 计时消失。
- **A3 穿透反馈**：`app.window.toggleClickThrough` RPC（翻转 `display.clickThrough` pref 真源 + 施加 + 广播，返回新态）；character 窗涟漪（穿透=青 `#6fa8ff`/恢复=暖 `#ff8fab`）+ toast（`🔇 鼠标穿透已开启` / `✋ 已恢复互动`）。穿透切换逻辑抽 `toggleClickThroughPref` 局部函数（仅依赖原语，M8c 抽 app-actions.ts 共用）。
- **A4 徽标/全屏**：`desktop-state.ts`（resolveMode 优先级 hidden>focus>dnd>normal，纯）；`fullscreen-watch.ts`（isLikelyFullscreen + createFullscreenWatch 变化沿回调，best-effort）；prefs `display.dndManual`/`display.focusMode`；character 按 mode 应用淡出（hidden=0/focus=0.3）+ DND 月牙徽标 `#badge`；Main 起全屏轮询广播 `app.desktopState`。

## 测试

- **protocol 182 / sidecar 37 / desktop 305**；typecheck 干净；`pnpm --filter @desksoul/desktop build` exit 0。
- 新增（desktop 297 → 305，+8）：
  - `test/character/interaction-zones.test.ts`（2）— tapZone / classifyPress。
  - `test/character-menu.test.ts`（1）— 菜单模板项 + 注入动作触发。
  - `test/character/bubble-timer.test.ts`（2）— durationMs / bubbleSide。
  - `test/character/desktop-state.test.ts`（1）— resolveMode 优先级。
  - `test/fullscreen-watch.test.ts`（2）— isLikelyFullscreen / 变化沿回调。
- protocol +2（prefs：bubbleDuration / dndManual+focusMode）。

## 阶段

- **P1 A1 交互**：interaction-zones + showChat/popCharacterMenu/character.tap RPC + character-menu 模板 + ipc-router 接线 + interaction.ts（tap/dblclick/右键/hover）。
- **P2 A2 气泡**：bubbleDuration pref + bubble-timer + bubble.ts + character index.html `#bubble` + main.ts chat.stream 订阅。
- **P3 A3+A4**：toggleClickThrough 真源 + 涟漪/toast；dnd/focus prefs + desktop-state + fullscreen-watch + 徽标/淡出 + Main 全屏轮询。
- **P4 保真 + 收尾**：本文 + CURRENT + README。

## 偏离计划处（诚实交代）

- **fullscreen-watch 修正**：计划实现把 `last` 初值设为 `null`，会在首 tick（probe=false）误报一次 `onChange(false)`，与计划自带测试期望 `[true, false]` 矛盾（TDD 先红抓到）。改为 `last = false`（基线假定非全屏，只报变化沿），测试通过。
- **A2 prefs 初值非阻塞**：character main.ts 改为非阻塞 `.then` 读 `app.prefs.getAll`（默认 '5' 已内置），避免 await 阻塞订阅、漏掉早到的 chat.stream。
- **A4 DND 气泡降级（头顶脉冲不展开）**：本期实现 DND 月牙徽标 + 淡出；DND 时"气泡降级为脉冲光点"未做（气泡在 DND 仍正常显示）→ 残留（见下）。
- 其余按计划逐 task、逐 commit。

## 残留（spec §1 OUT + 计划标注，留后续）

- **全屏检测 = best-effort**：`probe` 默认恒 `false`（退化为仅手动隐藏/托盘热键）；Win 前台窗矩形检测 + `isLikelyFullscreen` 阈值需**真机校准**后接入。
- **切换角色**（右键菜单"切换角色"项）= E1/V1 角色库依赖，当前 `enabled: false` 占位。
- **A2 单击复制气泡** = 按需（P4 视觉打磨期补）；**A4 DND 气泡脉冲降级** = 未做（气泡 DND 仍正常显示）。
- **A3 常态脚下色条**（`display.clickThroughBar`，D4 默认关）= 未接（pref 已存）。
- `toggleClickThroughPref` 现为 ipc-router 局部函数；M8c P1 起抽 `app-actions.ts` 与 hotkey/tray 共用。

## 人工硬门槛（留人工冒烟终审，未跑）

- 真透明 Electron 窗：A1 头/身点击动作差异 + 双击开聊天浮层 + 右键原生菜单（聊天/穿透/显隐/设置）+ hover 提示；A2 发消息→角色旁气泡逐字 + 表情 + 按时长消失 + 上/下方向；A3 切穿透→涟漪 + toast；A4 手动 DND→月牙徽标、专注→半透明（全屏检测 best-effort，记实测）。
- 对照 `UI/4ba6005f`（A1/A2/A3 区）+ `UI/8cb478c0`（A4 区）+ §2 token。
- 通过后 PM 打 `mvp/M8b-code-done`；真窗冒烟通过后打收官 `mvp/M8b-done`。
