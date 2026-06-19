# M8a P4 视觉保真 + 收尾 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans 逐 task。步骤用 `- [ ]`。

**Goal:** 对照 `UI/60ea4a18`(B1/B2 区) 做视觉保真 pass，写 RESULTS 收尾。

**关联 spec:** [`../spec.md`](../spec.md)（§6 + §7 **P4**）。**前置：P1–P3 已落**。

---

## Task 1: 视觉保真 pass（对照 60ea4a18）

**Files:**（按需微 polish；偏差记 RESULTS）

- [ ] **Step 1: dev + 逐态对照**

Run: `pnpm --filter @desksoul/desktop dev`，开 `…/overlay/index.html?fixture=chat`，对照 `UI/60ea4a18-….png`（B1 区 = 顶栏/头像气泡列表/输入行；B2 区 = 文本+情绪 chip/思考三点/错误红左条/长文折叠）。逐项核 §2 token：玻璃 `.ds-glass`（blur 28 / saturate 180）、brand 渐变、圆角（card/btn/input）、字号阶梯、间距、`--ds-danger` 错误色。

- [ ] **Step 2: 偏差 polish（如需）**

间距/字号/圆角/对齐偏差建最小 polish commit。结构性差异属 spec §1 OUT（工具卡 / 分离吸附 / 加载更早 / 📚⇄ 图标 / A2 桌面气泡）的**不修**，记 RESULTS 残留。

- [ ] **Step 3: 提交（若有 polish）**

```bash
git add apps/desktop/src/renderer/overlay/
git commit -m "style(overlay): B1/B2 visual fidelity polish vs 60ea4a18"
```

---

## Task 2: 收尾 RESULTS + CURRENT + README

**Files:** Create `docs/milestones/M8a/RESULTS.md`；Modify `docs/status/CURRENT.md`、`docs/milestones/M8a/README.md`

- [ ] **Step 1: 全量回归 + 构建（取最终测试数）**

Run:
```bash
pnpm --filter @desksoul/protocol test
pnpm --filter @desksoul/sidecar test
pnpm --filter @desksoul/desktop typecheck
pnpm --filter @desksoul/desktop test
pnpm --filter @desksoul/desktop build
```
Expected: 全绿 + build exit 0。记下 desktop 最终测试数（基线 287 + 新增 error-copy 4 / bubble-view 3 / chat-view-error 2 / chat-service confused 1 ≈ +10）。

- [ ] **Step 2: 写 RESULTS.md**

```markdown
# M8a 交付结果（RESULTS）

> spec [`spec.md`](spec.md) · plans [`plans/`](plans/)。聊天体验：B1 玻璃浮层 + B2 双轨气泡 + J3 错误分级。

## 摘要
- overlay 重构为 B1 玻璃聊天浮层（顶栏 角色名/模型/连接态/⚙ + 头像气泡列表 + 输入行）。
- B2 双轨：文本流 + 情绪 chip（订阅 behavior.applyEmotion/setIntent 并行）；思考三点 / 长文折叠。
- J3：错误红左条 + 分级台词（error-copy 映射 errorKind）+ 重试/换模型；Main error→广播 confused 驱动角色歪头。

## 测试
- protocol <N> / sidecar <N> / desktop <N>；typecheck 干净；build exit 0。
- 新增纯逻辑：error-copy / bubble-view / chat-view errorKind / chat-service confused 广播。

## 阶段
- P1 纯逻辑：error-copy + bubble-view + chat-view errorKind。
- P2 B1 壳：overlay 重构 + Bubble/EmotionChip + ?fixture harness。
- P3 B2+J3：思考/折叠/错误态 + 情绪双轨 + 重试/换模型 + 角色歪头。
- P4 保真 + 收尾。

## 残留（spec §1 OUT，留后续）
- B2 工具调用卡（tool_call 未广播到 overlay）→ 后续（需新增工具事件广播）。
- B1 分离吸附 / 加载更早分页 / ↓N 条新消息 / 📚⇄ 图标 → M9 或按需。
- A2 桌面气泡 = M8b；J4 离线条 = 后续；内容审查/流式中断错误细分（enum 无值）= 后续。
- B3 历史 / B4 语音 / B5 = 独立里程碑。

## 人工硬门槛（留人工冒烟终审）
- 真窗聊天逐屏对照 60ea4a18；真 Key→流式回复 + 情绪 chip 并行；断网/错 Key→分级错误态 + 重试可用 + 角色歪头。
- 通过后 PM 打 code-done / 收官 tag。
```

> 填 `<N>` 为实测数。

- [ ] **Step 3: 更新 CURRENT.md（路线图 + 一句话现状）+ M8a README 阶段链 ✅**

- [ ] **Step 4: 提交**

```bash
git add docs/milestones/M8a/RESULTS.md docs/milestones/M8a/README.md docs/status/CURRENT.md
git commit -m "docs(m8a): RESULTS + status (code complete; real-window/key pending human)"
```

> **PM 交接**：通知 PM 复核（读码审计 + 视觉对照），PM 打 `mvp/M8a-code-done`；真窗 + 真 Key 人工冒烟通过后打收官 `mvp/M8a-done`。

---

## Self-Review（plan vs spec P4）
- **spec §6 视觉对照**：T1 对照 60ea4a18 + §2 token，残留记 RESULTS ✓。
- **spec §6 收尾**：T2 RESULTS + CURRENT + README + 人工硬门槛 + PM tag 交接 ✓。
- **占位符**：RESULTS 的 `<N>` 是"填实测数"指示，非计划占位符 ✓。
