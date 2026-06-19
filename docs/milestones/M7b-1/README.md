# M7b-1 · D 系列设置面板 + chat 集成

> WHAT → [`spec.md`](spec.md)；HOW → [`plans/`](plans/)；交付 → [`RESULTS.md`](RESULTS.md)；实时状态 → [`../../status/CURRENT.md`](../../status/CURRENT.md)。

目标：把 5 个真实设置面板（D2/D3/D4/D6/D8）落进 Hub 壳，给 prefs 接"有后端"的副作用，并完成 D3→chat 集成（满足「配 Key → 听到回复」验收）。

## 阶段链（spec → plans → RESULTS）

| 阶段 | plan | 内容 | 状态 |
| --- | --- | --- | --- |
| P1 | [p1-foundation](plans/p1-foundation.md) | prefs schema 扩容 + effects 接依赖 + app.openExternal | ✅ desktop 254 |
| P2 | [p2-d4](plans/p2-d4.md) | D4 显示与窗口 + characterScale 收编 | ✅ 255 |
| P2.5 | [p2.5-hub-reachability](plans/p2.5-hub-reachability.md) | Hub 可达性（openHub RPC + 热键 + overlay ⚙ + hide-on-close） | ✅ 178/255 + PM 复核 |
| — | [visual-fidelity-harness](plans/visual-fidelity-harness.md) | 视觉保真 harness（dev mock-bridge + Playwright MCP）+ Hub/D4 审计 | ✅ 260 + PM 复核 |
| P3 | [p3-d2-d6](plans/p3-d2-d6.md) | D2 通用 + D6 隐私 + ConfirmDialog（§2.8 ②级二次确认） | ✅ 262 + PM 复核 |
| P4 | [p4-d3-chat](plans/p4-d3-chat.md) | D3 模型 API 双栏 + chat 集成（resolveModel，worker 零改动） | ✅ 273 + PM 复核（2 视觉 polish 转 P5） |
| P5 | [p5-d8-acceptance](plans/p5-d8-acceptance.md) | D8 关于 + D3 两 polish + 真窗 GUI 冒烟 + 真 Key 端到端 + tag | 🚧 代码完成全量绿；真窗/真 Key 人工待执行；`mvp/M7b1-done` tag 待裁 |

## 视觉真源
各屏对应高保真图见 [`../../design/ui-design.md`](../../design/ui-design.md) §4（D1/D2=`774644b7`、D3/D4=`36b542fb`、D5/D7=`1d7669e3`、D6/D8=`7075fa1f`）。
