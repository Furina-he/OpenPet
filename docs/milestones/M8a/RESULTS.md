# M8a 交付结果（RESULTS）

> spec [`spec.md`](spec.md) · plans [`plans/`](plans/)。聊天体验：B1 玻璃浮层 + B2 双轨气泡 + J3 错误分级。
> 状态：**代码完成 + 全量绿 + build exit 0**；真窗 GUI 冒烟 + 真 Key 端到端 = 人工硬门槛待跑。

## 摘要

- overlay 从 M2 朴素 UI 重构为 **B1 玻璃聊天浮层**（顶栏 角色名/模型/连接态 ●/⚙ + 头像气泡列表[连续同 role 合并] + 输入行 发送/取消）。
- **B2 双轨**：文本流 + 情绪 chip（overlay 订阅 `behavior.applyEmotion`/`behavior.setIntent`，与文本并行；流结束清空）；**思考态**三点呼吸；**长文折叠**（>200 码点折叠前 3 行 + 展开/收起）。
- **J3 错误分级**：`chat-view` 捕获 `chat.done` 已携带的 `errorKind`（协议零改动）；纯 `error-copy.ts` 映射 `ErrorKind`→{角色台词, actions}；错误气泡红左条 + 分级台词 + `[重试][换个模型/改 Key]`（重试=重发上一条 user；switchModel/changeKey=`app.window.openHub`）。Main 在 `chat.done(error)` 时旁路广播 `behavior.applyEmotion('confused')` 驱动角色"歪头"。

## 测试

- **protocol 180 / sidecar 37 / desktop 297**；typecheck 干净；`pnpm --filter @desksoul/desktop build` exit 0。
- 新增（desktop 基线 287 → 297，+10）：
  - `test/overlay/error-copy.test.ts`（4）— 6 个 ErrorKind + 缺省映射（§14.3 全覆盖）。
  - `test/overlay/bubble-view.test.ts`（3）— isThinking / shouldFold / groupMessages 边界。
  - `test/overlay/chat-view-error.test.ts`（2）— done(error,errorKind) 落末条 / done(stop) 不带。
  - `test/chat-service.test.ts`（+1）— error done 广播 `behavior.applyEmotion(confused)`。
- 既有不回归：chat-view（8）、chat-service（22→23）、全 53 文件绿。

## 阶段

- **P1 纯逻辑**：error-copy + bubble-view + chat-view errorKind（TDD 先红后绿，3 commit）。
- **P2 B1 壳**：overlay 重构玻璃浮层 + Bubble/EmotionChip 骨架 + `?fixture=chat` harness（2 commit）。
- **P3 B2+J3**：Bubble 思考/折叠/错误态 + 情绪双轨订阅 + 重试/换模型 + Main 广播 confused（3 commit）。
- **P4 保真 + 收尾**：本文 + CURRENT + README。

## 偏离计划处（诚实交代）

- **P3 Task 3 测试**：confused 广播测试改为「等首 delta 再 `killWorkerForTest()`」（沿用本文件既有 kill→error done 用例 178–194 的稳妥写法），而非计划的「send 后立即 kill」。断言逻辑与计划一致（error done → 含 confused 广播）；改动仅为时序稳健性。
- 其余按计划逐 task、逐 commit；commit message 与计划一致。

## 残留（spec §1 OUT，留后续）

- **B2 工具调用卡**（`🔧 正在搜索…`）：`tool_call` 仍在 chat-service 内消费、未广播到 overlay → 后续（需新增工具事件广播）。
- B1 分离吸附 / "加载更早…"分页 / `↓ N 条新消息` / 顶栏 `📚`·`⇄` 动态图标 → M9 或按需。
- A2 桌面气泡 = **M8b**；J4 离线条 = 后续；内容审查 / 流式中断错误细分（`ErrorKind` enum 无值，统一落 unknown 文案）= 后续扩 enum。
- B3 会话历史抽屉 / B4 语音 / B5 → 独立里程碑。

## 人工硬门槛（留人工冒烟终审，未跑）

- 真透明 Electron 窗跑聊天，逐项对照 `UI/60ea4a18`（B1 区 顶栏/头像气泡/输入行；B2 区 文本+情绪 chip/思考三点/错误红左条/长文折叠）+ §2 token。
- 真 Key → 看到流式回复逐字出 + 情绪 chip 并行（双轨）。
- 断网 / 错 Key → 分级错误态（红左条 + 角色台词 + 操作）+ 重试可重发成功 + 角色"歪头"（confused）。
- 通过后 PM 打 `mvp/M8a-code-done`；真窗 + 真 Key 人工冒烟通过后打收官 `mvp/M8a-done`。
