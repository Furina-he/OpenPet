# M3 验收结果 — 行为协议生产化

执行日期：2026-06-12　分支：feat/m3-behavior

## impl-plan M3 验收判据 → 证据

| # | 判据 | 证据 | 结果 |
| --- | --- | --- | --- |
| 1 | §4.1 全部标签（intent/emo/act/wait；say stub） | `behavior-parser.test.ts`（say 解析 3 例 + 消费端 stub）+ `conversation-core.test.ts`（wait 发射门 10 例：延迟/串联/保序/取消/跨 session/dispose） | ✓ |
| 2 | fail-safe：300ms 超时 flush | `conversation-core.test.ts`（stale flush 7 例：到点放行、续流重武装、流恢复继续解析、done·cancel·dispose 清理、空 buffer 不武装） | ✓ |
| 3 | 非法标签原样输出 + warn | `behavior-parser.test.ts` 五类 reason 全覆盖（malformed-tag / unregistered-tag / value-clamped / tag-overflow / misplaced-intent）；性质测试同时断言 warn 序列切分不变 | ✓ |
| 4 | Persona few-shot 模板 | `persona-prompt-template.ts` + 自洽测试（BEHAVIOR_FEWSHOTS 喂回 parser 零告警、首事件 intent、无标签泄漏） | ✓ |
| 5 | 覆盖率 ≥90% | thresholds 90 写进 `vitest run --coverage`（CI 即门槛）；实测 **lines 100% / statements 100% / functions 100% / branches 98.76%** | ✓ |
| 6 | 100+ 边界 case 全过（半截/嵌套/流截断/误用） | protocol 显式 it **116**（behavior-parser 78 + persona 8 + 既有 30）+ desktop conversation-core **29**；另切分不变性 20 样例 × 全部二分切点 + 逐字符 + 三等分 = **1067 个程序化 case**（事件与 warn 序列双重等价断言） | ✓ |

全仓回归：`pnpm typecheck`（11/11）`lint` `test`（9/9，protocol 带覆盖率门槛）`build`（9/9）全绿；e2e 冒烟 4 段 PASS 且连跑两次幂等。

## 关键设计落点

- 前缀四态分类（tag/viable/taglike/reject）：普通文本（`a<b`、`[链接](url)`、`arr[0]`）零延迟放行、零告警；未注册类标签（`<bogus:x/>`、`<div>`）等闭合整段放行 + warn——「流式即体验」与 tech-design「未注册标签 warn」两个要求同时满足。
- 未闭合标签双兜底：128 字符溢出（内存上限）+ 300ms stale flush（时间上限），互相独立。
- intent 仅段首（前导空白允许），中途出现降级为文本 + warn（§4.1「段首基调」语义）。
- `<wait/>` per-session 发射门：门关直通零开销；门开按序排队（done 不越过文本）；取消时清 pending，**pending 含 done 时当场合成 done(cancel)**——规避「流已结束、done 被 wait 压住、cancel 后无人封口」的 streaming 死锁。
- 数值 clamp：w≤1、dur≤60s、wait≤10s（`BEHAVIOR_LIMITS` 单一真源，persona 模板同步引用）。
- 协议版本 0.2.0 → 0.3.0；wire 协议（methods/schemas）零变更。

## 执行中发现并修复的问题

- **e2e smoke 幂等性 bug（M2 遗留，非 M3 回归）**：M2-2 段依赖 userData 干净。上次运行持久化的 `sessions.json` 让 App.vue 启动即重建旧「热可可」，DOM 等待条件被提前满足，快照拍在第二轮流式中途（`streaming:true`）。修复：启动前 `rmSync` 持久化文件 + 等待条件从 DOM 代理信号改为 `chat.done` 真条件（顺带消除 done 与最后 delta 间的 50ms 竞态）。已验证连跑两次全过。

## 已知限制（记录，不阻塞 M3）

- wait 门内的延迟文本在 Main 崩溃时随当轮 partial 一起丢——M6 SQLite 每条 commit 后缓解。
- say 解析后丢弃（V1+ 语音）；模板刻意不教 say。
- 渲染端打字机节奏（B2 流式气泡的视觉停顿微调）属 M8 体验范畴；M3 的停顿是真实的通知延迟。
- fetch 网关流式分块（spike-summary 旧编号「M3」）按 impl-plan 归 M5。

## 手测清单

| # | 检查项 | 通过? | 备注 |
| --- | --- | --- | --- |
| 1 | dev 起 app，发消息流式回复 + 角色表情同步 | ☐ | M1/M2 回归 |
| 2 | 普通含 `<`/`[` 的消息往返不丢字、不卡顿 | ☐ | 前缀分类 |
| 3 | `pnpm -r test` 全绿、CI 全绿 | ☐ | 覆盖率门槛生效 |
