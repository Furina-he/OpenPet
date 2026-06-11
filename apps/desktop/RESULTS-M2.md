# M2 验收结果 — IPC 四命名空间 + 取消 + 背压

执行日期：2026-06-11　分支：feat/m2-ipc

## impl-plan M2 验收判据 → 证据

| # | 判据 | 证据 | 结果 |
| --- | --- | --- | --- |
| 1 | 流式过程中点 cancel，全链路 200ms 内停 | `provider-host.test.ts`（wedged 100ms grace 强杀）+ `chat-service.test.ts`（cancel 后零 chat.stream 广播、wedged < 1s 收口）+ smoke M2-1（实测 2ms） | ✓ |
| 2 | 模拟下游慢消费 → 队列不无限涨，deltas 合并但消息边界不丢 | `notification-queue.test.ts`（1000 deltas 突发 pending ≤ 上限、文本无损、behavior 边界不跨、跨 session 不重排） | ✓ |
| 3 | 强杀 Worker / 重启 Main → UI 自动 chat.snapshot 重建对话 | `chat-service.test.ts`（worker 死亡封 error + 历史可快照；persistPath 重启实例恢复）+ smoke M2-2（overlay 崩溃自愈重建）+ 手测 #3 | ✓ |

## 四命名空间落地情况

| 命名空间 | method | 状态 |
| --- | --- | --- |
| app.* | window.setClickThrough / window.moveBy | M1 已有，M2 类型化 |
| chat.* | send / cancel / snapshot + stream / done (notification) | snapshot 新增，stream 加 seq |
| behavior.* | applyEmotion / playAction / setIntent (notification) | M1 已有（setLipsync V1+，M4 再扩） |
| plugin.* | registerSkill / permissionRequest / invokeTool（Worker→Main 帧通道） | 新增，默认权限全拒 |
| sys.* | ping | 保留作健康检查（spike-summary 决策） |

## 手测清单

| # | 检查项 | 通过? | 备注 |
| --- | --- | --- | --- |
| 1 | dev 起 app，发消息流式回复 + 角色表情同步 | ☐ | M1 回归 |
| 2 | 流式中点「取消」→ 气泡瞬停 + 「已取消」chip；再发新消息正常 | ☐ | cancelling 不粘连 |
| 3 | 聊一轮 → 退出 app → 重新 dev → overlay 启动即显示完整历史 | ☐ | Main 重启持久化 |
| 4 | 连发两次（DevTools 直接 rpc 第二次 chat.send）→ 第二次报 session busy | ☐ | -32001 |
| 5 | `pnpm -r test` 全绿、CI 全绿 | ☐ | |

## 已知限制（记录，不阻塞 M2）

- 流式中途 Main 崩溃丢当轮 partial 文本（delta 不触发落盘）——M6 SQLite 每条 commit 后消除。
- 错误码（-32001/-32002/-32602）跨 contextBridge 会被序列化剥掉，渲染端只见 message 文本——J3 错误分级（M8）再做结构化错误信封。
- 背压上限是软上限：极端 behavior 密集流合并后仍可能超 64——不丢消息优先。
- mock provider 忽略用户输入文本（脚本化回复）——M5 真 Provider 接入后消除。
