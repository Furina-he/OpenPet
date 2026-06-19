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
| **M7b-1** | D 系列设置面板 + chat 集成 | 🚧 P5 收尾 | [`M7b-1/`](M7b-1/) — spec + plans + RESULTS + README |
| M7b-2 | C 系列首启引导 | ⏳ 未开 | 待建 |
| M8 / M9 | 聊天 UI/气泡/系统集成 · 打包打磨 | ⏳ | 待建 |

> **历史（M1–M7a）按 B 增量未强迁**：RESULTS 仍在 `apps/desktop/RESULTS-M*.md`、plan 仍在 `docs/plans/`。**M7b-1 起**按 [`doc-conventions`](../design/doc-conventions.md) 新结构（每里程碑一目录）。
