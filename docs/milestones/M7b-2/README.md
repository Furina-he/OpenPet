# M7b-2 · C 系列首次启动引导（C1–C4）

> WHAT → [`spec.md`](spec.md)；HOW → [`plans/`](plans/)；交付 → `RESULTS.md`（收尾时建）；实时状态 → [`../../status/CURRENT.md`](../../status/CURRENT.md)。

目标：首启 90s 内走通「看到角色 → 配 Key（或跳过演示）→ 听到 TA 说话 + 看表情驱动」。复用 M7b-1 的 provider-config 积木 + M7a 地基；对未建依赖（A2 气泡/E1 角色库/B1 浮层/demo 后端）务实降级。

## 阶段链（spec → plans → RESULTS）

| 阶段 | plan | 内容 | 状态 |
| --- | --- | --- | --- |
| P1 | [p1-foundation](plans/p1-foundation.md) | `onboarding.completed` prefs + `finishOnboarding` RPC + 首启判定 + 引导窗 + electron-vite entry + 空壳 | 📋 计划就绪 |
| P2 | [p2-shell-c1-c4](plans/p2-shell-c1-c4.md) | wizard 状态机 + 步骤指示器/跳过确认 + C1 欢迎 + C4 首句（chip→overlay）+ 完成页 | 📋 计划就绪 |
| P3 | [p3-c2-model](plans/p3-c2-model.md) | 抽 `ProviderConfigPanel`（D3 复用不回归）+ C2 LLM 配置（两路径 + 隐私条 + 跳过演示） | 📋 计划就绪 |
| P4 | [p4-c3-demo-acceptance](plans/p4-c3-demo-acceptance.md) | C3 角色选择（默认角色 + 浏览禁用）+ demo 台词池 + 视觉保真 pass + RESULTS | 📋 计划就绪 |

> 务实降级（详见 spec §1 OUT）：A2 桌面气泡 → M8；E1 角色库浏览闭环 → V1（C3「看看其他角色」禁用 + tooltip）；B1 玻璃聊天浮层 → M8（C4 复用现有 overlay）；demo J4 联动 → 后续。

## 视觉真源
C1/C2 = `UI/d63b4f97-….png`；C3/C4 = `UI/98171885-….png`（见 [`../../design/ui-design.md`](../../design/ui-design.md) §4 + §7）。

## 人工硬门槛（同 M7b-1）
代码完成后，真 Electron GUI 跑首启引导逐屏对照设计图 + 真 Key→C4 听到流式回复 90s 端到端，由人工冒烟终审后打收官 tag。
