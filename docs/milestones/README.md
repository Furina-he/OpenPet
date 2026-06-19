# DeskSoul 里程碑索引

> 各里程碑的 spec / plans / RESULTS 入口。组织规范见 [`../design/doc-conventions.md`](../design/doc-conventions.md)；实时状态见 [`../status/CURRENT.md`](../status/CURRENT.md)。

| 里程碑 | 内容 | 状态 | 文档 |
| --- | --- | --- | --- |
| M1 | 架构骨架 + spike 迁移 | ✅ main | RESULTS `apps/desktop/RESULTS-M1.md` · plan `../plans/2026-06-11-m1-skeleton-plan.md` |
| M2 | IPC 四命名空间 + 取消/背压/快照恢复 | ✅ main | `apps/desktop/RESULTS-M2.md` · `../plans/2026-06-11-m2-ipc-plan.md` |
| M3 | 行为协议生产化 | ✅ main | `apps/desktop/RESULTS-M3.md` · `../plans/2026-06-12-m3-behavior-plan.md` |
| M4 | 渲染层 CharacterRuntime | ✅ main | `apps/desktop/RESULTS-M4.md` · `../plans/2026-06-12-m4-character-runtime-plan.md` |
| M5 | Provider 插件运行时 | ✅ main | `apps/desktop/RESULTS-M5.md` |
| M6 | 状态层 + 数据层 | ✅ main | `apps/desktop/RESULTS-M6.md` |
| M7a | 前端地基（prefs/Tailwind/Hub 壳） | ✅ main | `apps/desktop/RESULTS-M7a.md` · `../plans/2026-06-17-m7a-foundation-{spec,plan}.md` |
| **M7b-1** | D 系列设置面板 + chat 集成 | 🚧 `mvp/M7b1-code-done`；真窗/真 Key 待人工 | [`M7b-1/`](M7b-1/) — spec + plans + RESULTS + README |
| **M7b-2** | C 系列首启引导（C1–C4，务实降级） | 🚧 代码完成；真窗/真 Key 待人工 | [`M7b-2/`](M7b-2/) — spec + plans + RESULTS + README |
| **M8a** | 聊天体验（B1 浮层 + B2 双轨气泡 + J3 错误分级） | 📋 spec + P1–P4 计划就绪 | [`M8a/`](M8a/) — spec + plans + README |
| **M8b** | 桌面层（A1 交互 + A2 气泡 + A3 穿透 + A4 徽标/全屏） | 📋 spec + P1–P4 计划就绪 | [`M8b/`](M8b/) — spec + plans + README |
| **M8c** | 系统集成（J1 托盘 + J2 热键录制器 + J5 崩溃上报） | 📋 spec + P1–P4 计划就绪 | [`M8c/`](M8c/) — spec + plans + README |
| M9 | 打包 + 体验打磨 + 文档 | ⏳ | 待建 |

> **M8 三拆（已认可）**：M8a 聊天 → M8b 桌面层 → M8c 系统集成。顺序理由：M8b 双击/右键、M8c 托盘/热键都把"打开 B1"当目标，B1 须先有。

> **历史（M1–M7a）按 B 增量未强迁**：RESULTS 仍在 `apps/desktop/RESULTS-M*.md`、plan 仍在 `docs/plans/`。**M7b-1 起**按 [`doc-conventions`](../design/doc-conventions.md) 新结构（每里程碑一目录）。
