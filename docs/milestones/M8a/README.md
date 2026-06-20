# M8a · 聊天体验（B1 浮层 + B2 双轨气泡 + J3 错误分级）

> WHAT → [`spec.md`](spec.md)；HOW → [`plans/`](plans/)；交付 → `RESULTS.md`（收尾建）；实时状态 → [`../../status/CURRENT.md`](../../status/CURRENT.md)。

目标：overlay 从 M2 朴素升级为 B1 玻璃聊天浮层 + B2 双轨流式气泡 + J3 错误分级文案。复用 M2 streaming pipeline + chat-view 模型 + M4 EmotionEngine。**M8 三拆之一**（M8a→M8b→M8c）。

## 阶段链（spec → plans → RESULTS）

| 阶段 | plan | 内容 | 状态 |
| --- | --- | --- | --- |
| P1 | [p1-logic-foundation](plans/p1-logic-foundation.md) | error-copy + bubble-view + chat-view errorKind（纯逻辑 TDD） | ✅ 完成 |
| P2 | [p2-b1-shell](plans/p2-b1-shell.md) | overlay 重构 B1 玻璃壳 + Bubble/EmotionChip 骨架 + ?fixture harness | ✅ 完成 |
| P3 | [p3-b2-states-j3](plans/p3-b2-states-j3.md) | B2 思考/折叠/错误态 + 情绪 chip 双轨 + 重试/换模型 + 角色歪头 | ✅ 完成 |
| P4 | [p4-visual-results](plans/p4-visual-results.md) | 视觉保真对照 60ea4a18 + RESULTS 收尾 | ✅ 代码完成（真窗视觉=人工） |

交付结果见 [`RESULTS.md`](RESULTS.md)：protocol 180 / sidecar 37 / desktop 297、typecheck 干净、build exit 0；真窗 GUI 冒烟 + 真 Key 端到端 = 人工硬门槛待跑。

## 视觉真源
B1/B2 = `UI/60ea4a18-….png`（见 [`../../design/ui-design.md`](../../design/ui-design.md) §6.1/§6.2）。J3 文案 = §14.3。

## 务实降级（详见 spec §1 OUT）
工具调用卡（tool_call 未广播）→ 后续；分离吸附/加载更早/📚⇄ → M9；A2 桌面气泡 → M8b；J4 离线条 → 后续；B3/B4/B5 → 独立。

## 人工硬门槛（同前里程碑）
代码完成后真窗跑聊天逐屏对照 60ea4a18 + 真 Key→流式回复+情绪 chip + 断网/错 Key→分级错误态+角色歪头，人工冒烟终审后打 tag。
