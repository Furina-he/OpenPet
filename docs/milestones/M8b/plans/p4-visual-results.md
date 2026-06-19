# M8b P4 视觉保真 + 收尾 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans。步骤用 `- [ ]`。

**Goal:** 对照 `UI/4ba6005f`(A1/A2/A3) + `UI/8cb478c0`(A4) 做视觉/行为保真 pass，写 RESULTS。

**关联 spec:** [`../spec.md`](../spec.md)（§5 + P4）。**前置：M8b P1–P3 已落**。

---

## Task 1: 真窗行为/视觉 pass

- [ ] **Step 1: dev 起 Electron（真窗）逐项核**

Run: `pnpm --filter @desksoul/desktop dev`（注意 better-sqlite3 ABI，见 [[p5-electron-gui-smoke-blocker]]）。核：
- A1：头/身点击有动作差异；双击开聊天浮层；右键弹原生菜单（聊天/穿透/显隐/设置）；hover>800ms 提示。
- A2：发消息→角色旁气泡逐字 + 表情；按 D4 时长消失；上/下方向自适应。
- A3：切穿透→涟漪 + toast；恢复→暖脉冲 + toast。
- A4：手动 DND→月牙徽标 + 气泡降级；专注→半透明；（全屏检测 best-effort，记实测结果）。
对照 `UI/4ba6005f`(A1/A2/A3 区) + `UI/8cb478c0`(A4 区) + §2 token。

- [ ] **Step 2: 偏差 polish（如需）** — 间距/徽标位置/气泡圆角/涟漪色等微调；commit。

---

## Task 2: 收尾 RESULTS + CURRENT + README

- [ ] **Step 1: 全量回归 + 构建** — protocol/sidecar/desktop test + typecheck + build，记测试数。

- [ ] **Step 2: 写 `docs/milestones/M8b/RESULTS.md`**（摘要/测试数/阶段/残留/人工硬门槛）。残留至少含：全屏检测 best-effort（真机校准）、切角色（E1/V1）禁用、A2 单击复制按需。

- [ ] **Step 3: 更新 CURRENT.md 路线图 M8b 行 + M8b README 阶段链 ✅。**

- [ ] **Step 4: 提交**

```bash
git add docs/milestones/M8b/RESULTS.md docs/milestones/M8b/README.md docs/status/CURRENT.md
git commit -m "docs(m8b): RESULTS + status (code complete; real-window pending human)"
```

> **PM 交接**：PM 复核（读码 + 真窗视觉）→ `mvp/M8b-code-done`；真窗冒烟通过 → `mvp/M8b-done`。

---

## Self-Review
- 覆盖 §5 A1–A4 真窗行为 + 视觉对照 4ba6005f/8cb478c0 ✓；全屏 best-effort 残留显式记录 ✓。
