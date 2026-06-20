# M8c 交付结果（RESULTS）

> spec [`spec.md`](spec.md) · plans [`plans/`](plans/)。系统集成：J1 托盘 + J2 热键（注册系统 + 录制器）+ J5 崩溃诊断。
> 状态：**代码完成 + 全量绿 + build exit 0**；真窗冒烟（托盘/热键/诊断）= 人工硬门槛待跑。**M8c 收尾即 M8 整体代码收口**。

## 摘要

- **J2 热键注册系统**：prefs `hotkeys.*`（chat/toggleHide/clickThrough/dnd/openHub，accelerator 串）；`hotkey-rules`（validateAccelerator 禁单键/纯修饰/ESC + findConflict，纯）；`hotkey-service`（按 prefs 全量注册 globalShortcut，注入便于测）；index.ts **删除硬编码 `Ctrl+Shift+,`**，改 prefs 驱动注册 + `hotkeys.*` 变更即重注册。
- **J1 系统托盘**：`tray-icon`（三态 异常>思考>默认，纯）；`tray-service`（菜单模板 + Tray 接线，懒加载 electron 以保 buildTrayMenuTemplate 可纯测）；index.ts 创建托盘 + 三态图标随 chat 态（thinking=streaming / error=最近一轮 error）联动；左键显隐/双击聊天/中键穿透/右键菜单。
- **J2 录制器 UI**：`hotkey-rules` **提升到 `@desksoul/protocol`**（Main + renderer 共用校验/冲突，单一真源）；`keycap-accel`（KeyboardEvent→accelerator，纯）；`KeyCap.vue`（按下捕获）+ `HotkeysPage.vue`（功能表 + 录制 + 冲突警告 + 一键恢复）接 Hub「系统→热键」；改键即持久 + Main 重注册。
- **J5 崩溃诊断**：`crash-payload`（assembleDiag 脱敏：剔除含 key/secret/token/password 的键 + 永不含对话 + 日志截最近 200 行，纯）；`app.generateDiag` RPC 落本地 `.dsdiag`（userData/data）；D8「生成 .dsdiag」按钮启用（disabled→可点，显示落盘路径）；render-process-gone 钩子标注 M9 自动上报 TODO。
- **架构收口（按交接指令）**：A1 右键菜单 / J1 托盘 / J2 热键三处动作抽共享 `electron/main/app-actions.ts`（showChat / toggleClickThroughPref / toggleDndPref / toggleCharacter / openHub），ipc-router + index.ts(hotkey) + index.ts(tray) 共用，无三份重复；`showChat` RPC 一处定义多处复用；`hotkey-rules` 提升 protocol 前后端共用校验。

## 测试

- **protocol 185 / sidecar 37 / desktop 314**；typecheck 干净；`pnpm --filter @desksoul/desktop build` exit 0。
- 新增：
  - protocol：`hotkeys.*` 默认值（prefs.test +1）、`hotkeys.test.ts`（2，validateAccelerator/findConflict，自 desktop 迁入）。
  - desktop：`hotkey-service.test.ts`（2）、`app-actions.test.ts`（2，toggleClickThroughPref/toggleDndPref）、`tray-icon.test.ts`（1）、`tray-service.test.ts`（1，菜单模板）、`keycap-accel.test.ts`（2）、`crash-payload.test.ts`（1）。
  - desktop 净变化：M8b 末 305 → 314（+11 新 − 2 迁出的 hotkey-rules 用例 = +9）。

## 阶段

- **P1 热键系统**：hotkeys prefs + hotkey-rules + hotkey-service + index 替换硬编码 + app-actions。
- **P2 托盘**：tray-icon + tray-service + index 创建托盘 + chat 态图标 + 占位 PNG。
- **P3 录制器 UI**：hotkey-rules 提升 protocol + keycap-accel + KeyCap + HotkeysPage + 路由 + 重注册。
- **P4 J5 + 收尾**：crash-payload + generateDiag + D8 按钮 + 崩溃钩子 + 本文。

## 偏离计划处（诚实交代）

- **app-actions.ts 在 P1 即引入**（计划在 P2 Task 3 建议"顺带抽"）：第二消费者（热键）出现时即抽共享，ipc-router 同步改用，避免先内联再重构。新增 `app-actions.test.ts`（2）覆盖 pref 翻转。
- **tray-service 懒加载 electron**：计划顶层 `import { Tray, Menu, nativeImage } from 'electron'` 会让 vitest 加载 `tray-service` 时触发运行时 electron（本仓无 electron mock），故 `buildTrayMenuTemplate` 旁的 `createTray` 内用 `createRequire('electron')` 懒加载，保模块顶层无运行时 electron 依赖（纯模板可单测）。`middle-click` 经 typecheck 确认在 electron 类型内，未用计划的 `@ts-expect-error`。
- **keycap-accel 测试路径修正**：计划 `from '../../src/...'`（多一层）；test/ 根下应为 `../src/...`，已修。
- **J1 三态图标联动**经新增 `IpcRouterDeps.onBroadcast` 旁路观察 chat.stream/done 实现（仅状态变化沿刷新图标）；`hotkeys.*` 重注册复用同一 onBroadcast 钩子。
- 其余按计划逐 task、逐 commit。

## 残留（spec §1 OUT + 计划标注，留后续）

- **托盘图标 = 占位 PNG**（16×16 纯色：slate/blue/red 区分三态）；真图标（设计件）待视觉环节替换 + electron-builder 打包 `resources/`（M9）。
- **J5 完整对话框 UI**（友好文案 + 上送预览 + [不上报][仅这次][上报] + 自动上报选项）+ **真实上报端点** = M9（本期仅本地 `.dsdiag` + D8 入口，不假上报）；**崩溃自动生成 .dsdiag** = M9（本期 render-process-gone 仍 reload + console；D8 手动生成可用）。
- **热键重注册多平台**（Mac ⌘ 转换由 `CommandOrControl` 天然处理）= 真机验证待人工；托盘"切换角色"= E1/V1 依赖未开放。
- `app.generateDiag` 的 `logs` 暂空（M9 接真实日志缓冲）。

## 人工硬门槛（留人工冒烟终审，未跑）

- 真窗：托盘图标三态 + 菜单（聊天/显隐/穿透/不打扰/Hub/退出）+ 左键显隐/双击聊天/中键穿透；D2 热键页录制（按下捕获）+ 冲突警告 + 一键恢复 + 改键即生效；D8「生成 .dsdiag」落盘 + 脱敏核对（无 Key/对话）。
- 对照 `UI/6a38a202`（J1/J2/J5 区）+ §2 token。
- 通过后 PM 打 `mvp/M8c-code-done`；真窗冒烟通过后打收官 `mvp/M8c-done`，**M8 整体收口**。
