# M8b · 桌面层（A1 交互 + A2 气泡 + A3 穿透 + A4 徽标/全屏）

> WHAT → [`spec.md`](spec.md)；HOW → [`plans/`](plans/)；交付 → `RESULTS.md`（收尾建）；状态 → [`../../status/CURRENT.md`](../../status/CURRENT.md)。

角色窗一侧的桌面体验。**M8 三拆之二**（M8a→M8b→M8c）。**前置：M8a B1 已落**（双击/右键「聊天」= 显示+聚焦 overlay）。

| 阶段 | plan | 内容 | 状态 |
| --- | --- | --- | --- |
| P1 | [p1-a1-interaction](plans/p1-a1-interaction.md) | A1：tap 分区 + 双击→聊天 + 右键原生菜单 + hover 提示 | 📋 计划就绪 |
| P2 | [p2-a2-bubble](plans/p2-a2-bubble.md) | A2 桌面气泡（character 窗 DOM 层 + 流式 + 自动消失 + 方向） | 📋 计划就绪 |
| P3 | [p3-a3-a4](plans/p3-a3-a4.md) | A3 穿透切换反馈 + A4 DND/专注/隐藏徽标 + 全屏检测（best-effort） | 📋 计划就绪 |
| P4 | [p4-visual-results](plans/p4-visual-results.md) | 真窗行为/视觉保真（4ba6005f/8cb478c0）+ RESULTS | 📋 计划就绪 |

## 视觉真源
A1/A2/A3 = `UI/4ba6005f-….png`；A4 = `UI/8cb478c0-….png`。

## 已知残留方向（详见各 plan + spec §1 OUT）
全屏检测 best-effort（真机校准）；切角色（E1/V1）禁用；A2 单击复制按需。
