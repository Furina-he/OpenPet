# M8a 聊天体验（B1 浮层 + B2 双轨气泡 + J3 错误分级）设计（Spec）

| 版本 | 日期 | 状态 | 关联文档 |
| --- | --- | --- | --- |
| v0.1 | 2026-06-20 | Approved（brainstorming 收敛） | [ui-design §6/§14.3](../../design/ui-design.md) · [impl-plan §M8](../../design/impl-plan.md) · [M7b-1 spec](../M7b-1/spec.md) |

> **M8 拆三片**（已认可）：**M8a = 聊天体验（B1+B2+J3），本文**；M8b = 桌面层（A1–A4）；M8c = 系统集成（J1/J2/J5）。顺序 M8a→M8b→M8c（M8b 双击/右键、M8c 托盘/热键都把"打开 B1"当目标，B1 须先有）。M8a 复用 M2 既有 streaming pipeline + `chat-view` 模型 + M4 character EmotionEngine。

---

## 1. 目标与范围

**目标**：把 overlay 从 M2 朴素聊天升级为 B1 玻璃聊天浮层 + B2 双轨流式气泡（文本流 + 情绪并行）+ J3 错误分级文案，达成"一个能看的聊天界面 + 出错不吓人"。

**范围（IN）**
- **B1 聊天浮层**（替换 `overlay/App.vue` 朴素 UI）：玻璃面板（§2 token）+ 顶栏（角色名 + 当前模型 + 连接态 ● + 设置 ⚙）+ 消息列表（头像 + 气泡，连续同发言合并）+ 输入行（发送/取消）。尺寸沿用窗口 420×560。
- **B2 双轨流式气泡**：文本逐字 + **情绪 chip**（overlay 订阅 `behavior.applyEmotion`/`behavior.setIntent` 与文本并行）；特殊态：**思考中**（assistant 空文本 + streaming → 三点呼吸）、**错误/超时**（红左条 + 分级台词 + 操作）、**长文折叠**（>200 字默认折叠前 3 行 + 展开）。
- **J3 错误分级**：`chat-view` 捕获 `chat.done` 已携带的 `errorKind`（协议无需扩展）；纯 `error-copy.ts` 映射 `ErrorKind`→{角色台词, 操作集}；错误气泡渲染台词 + `[重试][换个模型]`；**重试** = 重发上一条 user；**换模型** = `app.window.openHub`（跳 D3）。Main 在 `chat.done(error)` 时广播 `behavior.applyEmotion('confused')` 驱动角色"歪头"。

**范围（OUT → 后续）**
- **B2 工具调用卡**（`🔧 正在搜索…`）：`tool_call` 事件当前在 chat-service 内消费、不广播到 overlay → 留后续（需新增工具事件广播；M8a 不做，工具仍在 Main 执行只是无 live 卡片）。
- B3 会话历史抽屉 / B4 语音 / B5 → 独立（非 M8a）。
- B1 顶栏 `📚`/`⇄` 动态图标、分离吸附浮窗、"加载更早…"分页、`↓ N 条新消息` → 后续打磨（M9 或按需）。
- A2 桌面气泡（角色旁气泡）= **M8b**；J4 离线条 = 后续。
- 内容审查 / 流式中断 两类错误：`ErrorKind` enum 无对应值（仅 auth/rate_limit/timeout/network/server/unknown），统一落 `unknown` 文案；细分留后续扩 enum。
- `@vue/test-utils`（延续：逻辑下沉纯 TS，SFC 薄渲染）。

---

## 2. 架构决策

### 2.1 复用既有，不动管线
- `overlay/chat-view.ts` 会话视图模型（snapshot/stream/done 合成 + 回显 + seq 去重）**保留**；仅扩 `ChatMessage` 带 `errorKind?` + `applyDone` 捕获之。
- streaming pipeline（chat-service→ConversationCore→NotificationQueue→broadcast）**零改动**，除 J3 的"error 广播 confused 表情"一处。
- character EmotionEngine（runtime `playAction` + emotion 映射含 `confused`）**复用**——overlay 显示情绪 chip 与 character 驱动是两个独立消费者，同源 `behavior.*` 通知。

### 2.2 B2 双轨在 overlay 的落地
- overlay `App.vue` 订阅 `behavior.applyEmotion`（`{ name, weight }`）+ `behavior.setIntent`（`{ mood, energy }`），维护"当前流的情绪"ref；在 streaming 的 assistant 气泡旁渲染 EmotionChip（mood/emotion 名）。流结束（done）后 chip 固化到该条消息。
- 这是 ui-design §6.2「双轨」的契约落地：文本流与表情流并行，均源自 `behavior-parser` 解析的标签。

### 2.3 J3 错误分级（数据已就绪）
- `chat.done` 通知 schema **已含 `errorKind`**（methods.ts），conversation-core 已转发 → 无需协议改动。
- `chat-view` 的 `DoneEvent`/`ChatMessage` 加 `errorKind?: ErrorKind`；`applyDone` 写入。
- 纯 `error-copy.ts`：`errorCopy(kind?) → { line: string; actions: ErrorAction[] }`，按 §14.3 表：

  | ErrorKind | 角色台词 | actions |
  | --- | --- | --- |
  | `timeout` / `network` | 「歪头」我没法连上大脑诶… | retry, switchModel |
  | `auth` | 「眨眼」哎，钥匙好像不对 | changeKey |
  | `rate_limit` | 「叹气」今天的额度用完啦 | switchModel |
  | `server` / `unknown` / 缺省 | 「困惑」大脑卡了一下，再说一次？ | retry |

  `ErrorAction` = `'retry' | 'switchModel' | 'changeKey'`；UI 把 changeKey/switchModel 都导向 `app.window.openHub`（D3 配置），retry 重发上一条 user。
- Main：`chat-service.onNotification` 的 `chat.done` 且 `finishReason==='error'` 分支，额外 `broadcast('behavior.applyEmotion', { name: 'confused', weight: 1 })`（character 哑播放器自动歪头）。

### 2.4 纯逻辑下沉（TDD 锚点）
- `overlay/error-copy.ts`：errorKind→文案/操作（§2.3 表）。
- `overlay/bubble-view.ts`：`isThinking(msg, streaming)`（assistant 且 text==='' 且 streaming）、`shouldFold(text)`（字数 > 200）、`groupMessages(messages)`（连续同 role 合并为渲染组，保留各自 finishReason）。
- `chat-view.ts` 扩 errorKind（既有测试不回归 + 新增 errorKind 捕获用例）。

### 2.5 组件（最小集）
- `overlay/components/Bubble.vue`：单条气泡（text + 流式 caret + 思考三点 + 长文折叠 + 错误红左条 + 错误台词/操作按钮）。
- `overlay/components/EmotionChip.vue`：情绪小 chip（emotion/mood 名 + 暖色）。
- `overlay/App.vue` 重构为 B1 玻璃壳（顶栏 + 列表[头像+Bubble] + 输入行）。
- 复用：tokens.css `.ds-glass` + 设计 token；`?`-harness 经 overlay main.ts 接 `installMockBridge`（dev 视觉用）。

---

## 3. 数据流

```
overlay App.vue:
  onMounted: 订阅 chat.stream / chat.done / behavior.applyEmotion / behavior.setIntent → chat.snapshot
  发送: echoUser → chat.send(sessionId='default', text)
  B2 双轨: behavior.applyEmotion → 当前情绪 ref → EmotionChip（与文本并行）
  J3 错误: chat.done(error, errorKind) → chat-view 写 errorKind → Bubble 渲染 errorCopy(kind)
           [重试]→ chat.send(上一条 user) ; [换模型/改Key]→ app.window.openHub
Main（J3 角色态）:
  chat.done(error) → broadcast behavior.applyEmotion(confused) → character 歪头
```

---

## 4. 新增/改动文件
- **protocol**：无（`chat.done` 已含 errorKind）。
- **Main**：`chat-service.ts`（onNotification: error done 广播 confused 表情）。
- **Renderer(overlay)**：`overlay/App.vue`（重构 B1）、新 `overlay/components/{Bubble,EmotionChip}.vue`、新 `overlay/{error-copy,bubble-view}.ts`、`overlay/chat-view.ts`（+errorKind）、`overlay/main.ts`（+installMockBridge）。
- **收尾**：`docs/milestones/M8a/{README,spec,plans/,RESULTS}`、`CURRENT.md`、milestones 索引。

---

## 5. 测试策略（TDD）
- **error-copy**：每个 ErrorKind + 缺省 → 正确台词 + actions（§2.3 表全覆盖）。
- **bubble-view**：isThinking/shouldFold/groupMessages 边界。
- **chat-view errorKind**：done(error, errorKind) → 末条 message.errorKind 落值；stop/cancel 不带；既有 snapshot/stream/seq 用例不回归。
- **chat-service confused 广播**：注入假 broadcast，chat.done(error) → 调 `behavior.applyEmotion(confused)`；stop/cancel 不调。
- 组件薄：typecheck + 视觉 harness（overlay `?fixture=` 注入假快照）对照 `60ea4a18`。不引入 @vue/test-utils。

## 6. 验收
- overlay 呈 B1 玻璃浮层（顶栏角色名+模型+连接态 / 头像气泡列表 / 输入行），对照 `UI/60ea4a18`（B1 区）+ §2 token。
- 流式回复逐字出 + 情绪 chip 并行（B2 双轨）；思考态三点；长文折叠/展开。
- 出错（断网/错 Key）→ 红左条 + 分级台词 + `[重试][换模型]`；重试重发成功；角色歪头（confused）。
- desktop/protocol 既有测试不回归；typecheck + prettier（仅新写文件）干净。
- RESULTS-M8a + CURRENT + milestones 索引。

> **人工硬门槛**（同前里程碑）：真窗跑聊天逐屏对照 `60ea4a18` + 真 Key→看到流式回复+情绪 chip + 断网/错 Key 看分级错误态 + 角色歪头。代码完成后人工冒烟终审再打 tag。

---

## 7. 分阶段执行
- **P1 纯逻辑地基**：`error-copy` + `bubble-view` + `chat-view` 扩 errorKind（全 TDD）。
- **P2 B1 玻璃壳**：重构 `overlay/App.vue` 玻璃 + 顶栏/列表/输入 + `Bubble`/`EmotionChip` 骨架 + overlay harness。
- **P3 B2 状态 + J3**：Bubble 思考/长文折叠/错误态 + 情绪 chip 双轨订阅 + 重试/换模型 + Main 广播 confused。
- **P4 视觉保真 + 收尾**：对照 `60ea4a18` 逐项 polish + RESULTS。

## 8. 衔接
- B1 落地后，M8b 的 A1 双击/右键「聊天」、M8c 的托盘/热键「跟小灵聊聊」均以"显示+聚焦 overlay"为目标（M8c 把 overlay 显隐纳入托盘/热键正式入口）。
- 工具调用卡 / B3 历史 / 离线条（J4）/ 分离吸附在各自后续里程碑补。
