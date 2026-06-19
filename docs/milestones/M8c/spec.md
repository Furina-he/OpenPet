# M8c · 系统集成（J1 托盘 + J2 热键录制器 + J5 崩溃上报）设计草案（Spec Draft）

| 版本 | 日期 | 状态 | 关联文档 |
| --- | --- | --- | --- |
| v0.1-draft | 2026-06-20 | **草案（待 M8a/M8b 落地后细化为可执行计划）** | [ui-design §14](../../design/ui-design.md) · [impl-plan §M8](../../design/impl-plan.md) |

> **M8 三拆之三**（M8a→M8b→**M8c**）。OS 级集成，把"显示/聊天/穿透/设置"收口为正式入口（托盘 + 热键），替换 index.ts 现硬编码的单一 `Ctrl+Shift+,`。**前置：M8a B1 + M8b A1 已落**（托盘/热键的目标动作=显隐角色/打开 B1/切穿透/打开 Hub 都已存在）。

---

## 1. 目标与范围

**目标**：DeskSoul 像个正经桌面应用——托盘常驻可控、热键可自定义、崩溃能体面上报。

**范围（IN）**
- **J1 系统托盘**：`Tray` + 原生 `Menu`；三态图标（默认/思考呼吸/异常红点）；菜单项（跟小灵聊聊/显隐角色/穿透/不打扰/当前角色/打开 Hub/设置/反馈/退出，§14.1）；左键单击=显隐（最高频）/双击=聊天/右键=菜单/中键=切穿透；hover tooltip。
- **J2 全局热键录制器 + 注册系统**：替换硬编码 globalShortcut——prefs 存可绑定功能→热键映射；启动按 prefs 注册；录制器 UI（KeyCap 按下捕获）；冲突检测（占用警告 + 仍用/换一个）；限制（禁单键/纯修饰/ESC）；D2→热键页总览表（功能+当前键+录制+一键恢复）。
- **J5 崩溃上报对话框**（表单 420px）：友好文案 + 脱敏上送内容预览（堆栈/系统信息/配置摘要不含 Key·对话/最近 200 行日志）+ 选项（附描述/自动上报默认不勾）+ [不上报][仅这次][上报]；上送 toast + 失败本地排队重试。

**范围（OUT → 后续）**
- 真实崩溃后端上报端点 = 后续（M8c 先做对话框 + 本地排队 + 脱敏，不接真实服务器；或仅生成 .dsdiag 本地文件，复用 D8 既有「生成诊断」存而不接的口子）。
- 反馈入口可先导向 mailto/外链（复用 `app.openExternal`）。
- "当前角色"子菜单切换 = E1/V1 依赖，先列默认角色只读。

---

## 2. 架构方向（待 M8a/M8b 后定稿）

- **J1 托盘**：Main 侧 `new Tray(icon)` + `Menu.buildFromTemplate`；图标三态随连接/思考态切换（chat 状态广播已有）；菜单动作复用既有 RPC/窗口操作（openHub / setClickThrough / 显隐 character+overlay / finishOnboarding 无关）。需补"显隐角色""聊天（显示+聚焦 overlay）"的 Main 动作。
- **J2 热键**：新 `prefs.hotkeys.*`（功能→accelerator 字符串）+ Main 启动遍历注册 globalShortcut（替换硬编码）+ 冲突检测纯逻辑（解析 accelerator、查保留集）；录制器在 Hub D2→热键页（renderer 捕获 keydown→accelerator 串）。KeyCap 组件（ui-design §2.6）。
- **J5 崩溃**：Main `process`/`app` 崩溃钩子 + render-process-gone（windows.ts 已有 reload，可加上报）；脱敏 payload 组装（纯函数，可测）；对话框为表单窗（类 onboarding 轻量窗或 Hub 内弹层）。

## 3. 纯逻辑下沉（TDD 锚点，预估）
- accelerator 解析 + 冲突/合法性校验（禁单键/纯修饰/ESC、保留集匹配）；J5 脱敏 payload 组装（剔除 Key/对话、截 200 行）；托盘图标态机（连接/思考/异常→icon）。

## 4. 分阶段（预估，writing-plans 细化）
- P1 J2 热键注册系统（prefs + Main 注册 + accelerator 校验纯逻辑，替换硬编码）
- P2 J1 托盘（Tray+Menu+三态图标+动作接线）
- P3 J2 录制器 UI（D2 热键页 + KeyCap + 冲突检测）
- P4 J5 崩溃对话框（脱敏 payload + 本地排队）+ 视觉保真（对照 `6a38a202` J1/J2/J5）+ RESULTS

## 5. 视觉真源
J1/J2/J5 = `UI/6a38a202-….png`。J2 热键总览在 D2→热键页（Hub）。
