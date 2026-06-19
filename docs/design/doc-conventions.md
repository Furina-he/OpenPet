# DeskSoul 文档管理规范

> 状态：规范真源（2026-06-19 立）。本文件**既是**这次文档治理的设计 spec，**又是**往后所有里程碑的文档组织规范。

## 1. 目的

解决两个痛点：
- **A 关系散** — 同一里程碑的 spec / plan / results 分散在不同目录，谁对应谁靠脑补。
- **B 真源与临时混** — `docs/plans/` 把"长期权威文档"和"用完即定稿的阶段计划"堆在一起。

解法：**真源与过程文档分家 + 过程文档按里程碑聚合 + 两级 README 索引**。

## 2. 目录结构

```
docs/
  design/                  长期真源（稳定、权威；改它 = 改设计决策）
    tech-design.md           架构（v0.2 Electron Pivot）
    ui-design.md             前端（v0.2 以高保真图为视觉真源）
    impl-plan.md             总任务清单
    doc-conventions.md       本文件
  status/
    CURRENT.md               实时状态 + 新对话对接入口（★任何新对话先读）
  milestones/
    README.md                总索引：所有里程碑一行状态 + 链接；历史 RESULTS 位置登记
    <里程碑>/                 例 M7b-1/
      README.md                本里程碑索引：spec→plans→RESULTS 关系链 + 各阶段状态
      spec.md                  WHAT（本里程碑要做什么 + 决策）
      RESULTS.md               交付结果（分阶段累积，定稿打 tag）
      plans/
        pN-<topic>.md          HOW（各阶段实现计划，pN 排序，支持 p2.5 这类插入）
  plans/                     暂留：M7a 及更早未规整的 spec/plan（README 登记，不强迁）
  superpowers/               skill 产物（brainstorming specs / writing-plans 等）
PRD.md                       产品需求（根，与代码同级）
```

## 3. 文档分类与职责

| 类别 | 位置 | 职责 | 改动频率 |
| --- | --- | --- | --- |
| 长期真源 | `docs/design/` | 架构/前端/任务清单/本规范——权威设计 | 低（设计变才动） |
| 实时状态 | `docs/status/CURRENT.md` | 当前在做什么、绿数、下一步、对接入口 | 每阶段 |
| 里程碑过程 | `docs/milestones/<M>/` | 某里程碑的 spec / plans / RESULTS / README | 里程碑期内，定稿后冻结 |
| 产品需求 | 根 `PRD.md` | 产品级需求 | 低 |
| 暂留历史 | `docs/plans/` | M7a 及更早未规整文档 | 不动（仅登记） |

> 注：`CLAUDE.md` / `AGENTS.md` 是**项目地图**（目标/概况/约束），不属上述任何一类，不放实时状态（见 [[claude-md-is-project-map]] 约定）。

## 4. 命名规范

- **真源**：裸语义名，无日期前缀（`tech-design.md`，不是 `2026-05-01-desksoul-tech-design.md`）——它们是活文档，日期前缀会误导成"旧稿"。
- **里程碑目录**：与代码/CURRENT 里的里程碑标识一致（`M7b-1/`）。
- **里程碑内文件**：`spec.md` / `RESULTS.md` / `README.md`；plan 用 `plans/pN-<topic>.md`（`N` 可含小数如 `p2.5` 表示插入阶段）。**去日期前缀**（目录已表里程碑、pN 已表顺序）。

## 5. 两级索引（直接解痛点 A）

- **`docs/milestones/README.md`**（总索引）：一张表列所有里程碑 + 状态 + 链接；M1–M6 / M7a 登记其历史 `RESULTS-M*.md` 仍在 `apps/desktop/`（不迁）。
- **`docs/milestones/<M>/README.md`**（里程碑索引）：一张表把 `spec → p1…pN → RESULTS` 的关系链 + 各阶段状态/commit 列清楚，进来一眼看懂这个里程碑的全貌。

## 6. 新里程碑流程

1. 建 `docs/milestones/<M>/{README.md, spec.md, plans/}`。
2. 写 `spec.md`（WHAT）→ 拆 `plans/pN-*.md`（HOW）→ 逐阶段执行 → 累积写 `RESULTS.md`。
3. 全程维护 `<M>/README.md` 的关系链 + 状态。
4. `CURRENT.md` 指向当前里程碑；里程碑收尾在 `milestones/README.md` 登记并打 tag。

## 7. 本次落地迁移（B 增量，2026-06-19）

仅规整真源 + 当前活跃的 M7b-1；M1–M7a 历史不迁，仅登记。全部用 `git mv` 保留历史。

**迁移清单**：
- `docs/plans/2026-05-01-desksoul-tech-design.md` → `docs/design/tech-design.md`
- `docs/plans/2026-05-01-desksoul-ui-design.md` → `docs/design/ui-design.md`
- `docs/plans/2026-05-01-desksoul-impl-plan.md` → `docs/design/impl-plan.md`
- `docs/plans/2026-06-17-m7b1-d-series-spec.md` → `docs/milestones/M7b-1/spec.md`
- `docs/plans/2026-06-18-m7b1-p1-foundation-plan.md` → `docs/milestones/M7b-1/plans/p1-foundation.md`
- `…-p2-d4-plan.md` → `…/plans/p2-d4.md`
- `…-p2_5-hub-reachability-plan.md` → `…/plans/p2.5-hub-reachability.md`
- `…-p3-d2-d6-plan.md` → `…/plans/p3-d2-d6.md`
- `…-p4-d3-chat-plan.md` → `…/plans/p4-d3-chat.md`
- `…-p5-d8-acceptance-plan.md` → `…/plans/p5-d8-acceptance.md`
- `…-visual-fidelity-harness-plan.md` → `…/plans/visual-fidelity-harness.md`
- `apps/desktop/RESULTS-M7b1.md` → `docs/milestones/M7b-1/RESULTS.md`

**新建**：`docs/milestones/README.md`、`docs/milestones/M7b-1/README.md`。

**引用更新点**（迁移后必改，否则断链）：
- `CLAUDE.md` 文档索引/UI 设计段里的 `docs/plans/…` 路径
- `AGENTS.md` 同上（Codex 镜像）
- `docs/status/CURRENT.md` §4 文档索引、§2 下一步 plan 路径
- 各 plan / RESULTS / spec 内部交叉引用（如 P5 plan 引 spec、CURRENT 引 RESULTS）
- 历史 `RESULTS-M*.md` 留原地，不改

**不迁**：M7a 的 `…-m7a-foundation-{spec,plan}.md`、`spike-summary.md` 等留 `docs/plans/`，由 `milestones/README.md` 登记。
