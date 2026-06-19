# M8b · 桌面层（A1 交互补全 + A2 桌面气泡 + A3 穿透反馈 + A4 徽标/全屏）设计草案（Spec Draft）

| 版本 | 日期 | 状态 | 关联文档 |
| --- | --- | --- | --- |
| v0.1-draft | 2026-06-20 | **草案（待 M8a 落地后细化为可执行计划）** | [ui-design §5](../../design/ui-design.md) · [impl-plan §M8](../../design/impl-plan.md) |

> **M8 三拆之二**（M8a→**M8b**→M8c）。聚焦角色窗一侧的桌面体验。**前置：M8a 的 B1 浮层已落**（A1 双击/右键「聊天」以"显示+聚焦 overlay"为目标）。本文为草案：范围与架构方向已定，task 级计划在 M8a 收尾后用 writing-plans 细化。

---

## 1. 目标与范围

**目标**：让桌面上的角色"活"起来——可点可拖可右键、说话有气泡、穿透切换有反馈、会按 DND/全屏状态收敛存在感。

**范围（IN）**
- **A1 角色交互补全**（`character/interaction.ts` 现仅 alpha 命中 + 拖拽）：补 head/body tap（头部→撒娇动作+情绪+1、身体→普通互动）、双击→打开 B1（显示+聚焦 overlay）、右键→桌面右键菜单（聊天/切角色/穿透/隐藏/设置）、hover>800ms→悬浮提示。
- **A2 桌面气泡**：角色头部旁玻璃气泡（`border-left:3px` 暖色 + 指向三角），订阅 `chat.stream` 逐字 + 表情同步；自动消失（pref 3/5/8/常驻）；方向自适应（上方不足翻下方）；单击复制；DND 降级为头顶脉冲光点。
- **A3 穿透/可交互视觉指示**：切换瞬间反馈（500ms 涟漪 + Toast「🔇 鼠标穿透已开启 / ✋ 已恢复互动」）；可选常态脚下色条（D4 开关）。
- **A4 DND/专注/隐藏徽标 + 全屏检测**：DND 肩部月牙徽标 / 专注半透明 30% / 隐藏（仅托盘）；全屏游戏检测自动隐藏（`display.fullscreenHide` 已持久）。

**范围（OUT → 后续）**
- 切角色（E1 角色库）= V1；右键菜单"切换角色"项先禁用或仅占位。
- 多显示器位置记忆策略细化 = 后续（A1 已有单屏拖拽）。
- 托盘正式入口 = M8c（A1 右键菜单"设置/隐藏"可先调 openHub / 窗口显隐）。

---

## 2. 架构方向（待 M8a 后定稿）

- **A2 气泡承载**：两个候选——① character 窗口内 DOM 层（character renderer 加一个气泡 overlay div，复用其 behavior/chat 订阅）；② 独立透明小窗（类似 onboarding 窗的轻量版）。倾向 ①（与角色同窗、定位简单、无新窗管理），但需确认 character 窗当前 DOM 是否只挂 canvas。M8a 收尾后核 `character/main.ts` 决定。
- **A1 交互**：扩 `interaction.ts`——tap 命中区按 alpha + y 分头/身；双击/右键经新 RPC 或复用窗口操作；右键菜单可用 Electron Menu.popup（Main）或 renderer 自绘玻璃菜单（与 §2 风格一致，倾向自绘）。
- **A3 反馈**：clickThrough 切换处（A3 + 既有 `app.window.setClickThrough`）挂 Toast/涟漪；character renderer 渲染脚下色条（pref 控）。
- **A4 全屏检测**：Main 侧轮询前台窗口全屏态（Win API / Electron）→ 广播状态 → character 渲染徽标/半透明/隐藏。徽标绑骨骼节点（runtime 支持）。

## 3. 纯逻辑下沉（TDD 锚点，预估）
- tap 命中分区（head/body 判定，纯函数）；A2 气泡自动消失计时 + 方向自适应（纯）；A3 切换文案；A4 状态机（normal/dnd/focus/hidden + 触发源）。

## 4. 分阶段（预估，writing-plans 细化）
- P1 A1 交互补全（tap/双击→B1/右键菜单/hover）
- P2 A2 桌面气泡（承载方式定稿 + 流式 + 自动消失 + 方向）
- P3 A3 穿透反馈 + A4 徽标/全屏检测
- P4 视觉保真（对照 `4ba6005f` A1/A2/A3 + `8cb478c0` A4）+ RESULTS

## 5. 视觉真源
A1/A2/A3 = `UI/4ba6005f-….png`；A4 = `UI/8cb478c0-….png`（与 J4 同图）。
