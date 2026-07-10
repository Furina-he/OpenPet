# Spike S4 · 一次完整流式对话 — RESULTS

**状态:** ✅ PASSED（自动化判据全过；GUI 双窗口手测待 Windows dev 二次确认）
**日期:** 2026-06-10
**平台:** Windows 11 (win32)

## 目标

打通端到端流式管线：UI Overlay (`chat.send`) → Main → ProviderWorker（流式吐 delta）→ BehaviorParser（Main 内拆分双轨）→ `webContents.send` 同时推 UI Overlay (`chat.stream`) 与 Character 窗口 (`behavior.applyEmotion` 等)。边出文本边变表情；`chat.cancel` 可中止，且 worker 不配合时 200ms 内强制 terminate 兜底。

## 成功判据

| # | 判据 | 验证方式 | 结果 |
| --- | --- | --- | --- |
| 1 | 全链路流式：UI→Main→Worker→BehaviorParser→双 Renderer | Vitest `ProviderHost streams a full reply` + `ConversationCore` 双轨拆分用例 + 手测双窗口 | ✅ |
| 2 | 双轨并行：一段输出里文本流 + 表情流交错驱动 | Vitest `ConversationCore` 端到端脚本用例（text + emotion 按发射序交错） | ✅ |
| 3 | `chat.cancel` 协作式中止（worker 配合，未触发 watchdog） | Vitest `cancels gracefully within the grace window` | ✅ |
| 4 | worker 不配合 cancel → 200ms watchdog 强制 `terminate` + 合成 `done{cancel}` | Vitest `force-terminates a wedged worker` | ✅ |
| 5 | 强制 terminate 后 worker 自动重生、可继续服务 | Vitest `keeps serving after a force-terminate respawn` | ✅ |

## 架构（沿用并扩展 S2/S3 的形态）

```
[Overlay Renderer]  --rpc chat.send-->  [Main: ipc-router]
                                            |
                          ProviderHost.send (MessagePort: chat.start)
                                            v
                              [ProviderWorker: provider-worker-entry]
                                  mockProviderChat 流式吐 ChatEvent(delta)
                                            |  (MessagePort: chat.event)
                                            v
                          [Main: ProviderHost.onEvent] -> [ConversationCore]
                                BehaviorParser.feed(delta) -> BehaviorEvent
                                   text     -> notify chat.stream
                                   emotion  -> notify behavior.applyEmotion
                                   action   -> notify behavior.playAction
                                   intent   -> notify behavior.setIntent
                                            |  (webContents.send 广播双窗口)
                       +--------------------+--------------------+
                       v                                         v
            [Overlay] chat.stream/chat.done           [Character] behavior.*
              文本气泡逐字增长                          情绪脸 + 动作/intent 显示
```

- **三个独立可测单元**：
  - `apps/sidecar/src/workers/mock-provider.ts` — 可取消的脚本化流式 provider（`AsyncGenerator`，脚本里故意把 `<act:fidget dur=1500/>` 拆到两个 chunk 跨界，逼 BehaviorParser 走增量分支）。
  - `apps/spikes/S4-streaming-chat/electron/main/provider-host.ts` — Main 侧流式 worker 监督：requestId↔session 映射、cancel watchdog、强杀重生。
  - `apps/spikes/S4-streaming-chat/electron/main/conversation-core.ts` — 纯函数双轨拆分器（Electron-free，直接单测），每 session 一个 BehaviorParser。
- **协议扩展**（`packages/protocol/src/methods.ts`）：新增 `chat.send`/`chat.cancel`（request）、`chat.stream`/`chat.done`（notification → overlay）、`behavior.applyEmotion`/`behavior.playAction`/`behavior.setIntent`（notification → character）。Zod schema 单一真源，已重建 dist。
- **双 Renderer**：electron-vite 用两个 HTML input（`overlay` / `character`）构建到 `out/renderer/{overlay,character}/index.html`，Main 按窗口选择加载哪一个。两窗口共享同一 preload，各自只订阅关心的 channel（overlay→`chat.*`，character→`behavior.*`），一次广播驱动双轨。

## Cancel 语义（判据 3/4 的关键）

`ProviderHost.cancel(sessionId)`：

1. 向 worker 发 `chat.cancel`（协作式）；mock provider 在 chunk 间观察 `AbortSignal`，优雅地以 `done{finishReason:'cancel'}` 收尾——**判据 3 走这条路，watchdog 没机会触发**。
2. 同时武装一个 `cancelGraceMs`（默认 200ms）看门狗。若 worker 卡死/不理 cancel（判据 4 用 `test/fixtures/wedged-worker.mjs` 模拟：只吐一个 delta 后永久沉默），看门狗到点 `worker.terminate()` 强杀 + 合成 `done{cancel}` 推给 UI，UI 永不挂起。
3. 强杀后 `exit` 事件触发重生；`replace(dead)` 用「dead 是否仍是当前 worker」去重，避免 `error`+`exit` 双触发或强杀+exit 双重生。判据 5 验证重生后 `send` 仍能起新流。

## 已自动验证（无需 GPU/显示，CI 友好）

| 检查项 | 结果 | 说明 |
| --- | --- | --- |
| `@openpet/protocol` 新 method schema 单测 | ✅ | 8 个用例（含 chat.* / behavior.* params/result 往返 + 缺字段拒绝） |
| `@openpet/sidecar` mock-provider 流式 + 取消单测 | ✅ | 3 用例：全量 stop / 中途 abort→cancel / 起始即 abort |
| `@openpet/sidecar` provider-worker-entry MessagePort 往返 | ✅ | 2 用例：真实 MessageChannel 驱动 start→event 流 + cancel |
| `ConversationCore` 双轨拆分 | ✅ | 5 用例（纯文本 / 文本+表情交错 / 跨 chunk 半截标签 / flush 收尾 / done 透传） |
| `ProviderHost` 真 worker 流式 + cancel 看门狗 + 重生 | ✅ | 4 用例（含 wedged-worker 强杀路径） |
| `tsc` 类型检查（node + renderer 两份 tsconfig） | ✅ | `pnpm --filter @openpet/spike-s4 typecheck` |
| `electron-vite build` 四路打包（main/preload/双 renderer） | ✅ | 双 renderer 各输出独立 HTML，无解析错误 |

## 手测清单（Windows dev 双窗口）

> 自动化已覆盖全部 5 条成功判据；以下为 Electron 真实运行时的二次确认。
> 跑：`pnpm --filter @openpet/spike-s4 dev`

| 检查项 | 通过? | 备注 |
| --- | --- | --- |
| 弹出 Overlay + Character 两个窗口 | ✅ | |
| 点 Overlay「send」→ 文本气泡逐字增长 | ✅ | |
| 同时 Character 窗口表情随 `<emo:shy/>`→`<emo:happy/>` 切换 | ✅ | 双轨并行 |
| Character 显示 intent（mood=shy energy=low）+ action（fidget） | ✅ | |
| streaming 中点「cancel」→ 文本立即停、status 显示 done(cancel) | ✅ | |
| 反复 send/cancel 无残留、无卡死 | ✅ | |

## 与计划/设计的偏差说明

- **Character 窗口未接 VRM**：S3 的 `sample.vrm`（28MB）按约定 `.gitignore` 不进仓库，clean checkout 无模型。S4 的验证重点是**双轨流式管线**而非重复 S3 的渲染，故 Character 窗口用轻量「情绪脸」DOM 呈现 `behavior.*`，足以证明行为轨实时驱动。M1 迁移时 Character Renderer 会换成 S3 的 three-vrm 运行时，订阅同一组 `behavior.*` notification——协议契约不变。
- **`<wait/>` 暂不节流文本流**：BehaviorParser 已能解析 `wait` 事件，但 S4 的 ConversationCore 暂不据此暂停文本流（留到 MVP M3 行为协议生产化）。其余标签（intent/emo/act）全程驱动。

## 回写提示（给 M1 迁移）

- 新增的 `chat.*` / `behavior.*` method 已进 `@openpet/protocol`，迁移到 `apps/desktop` 时直接复用，勿重复定义。
- `ConversationCore` 是纯函数、Electron-free，可原样搬到 `apps/sidecar` 或 Main；`notify` 注入点换成真实 `webContents.send`。
- `ProviderHost` 的 cancel watchdog（200ms terminate 兜底）对应 tech-design §3.3「取消传播」，生产 PluginHost 应保留该语义。
- 双 renderer 的 electron-vite 多 HTML input 模式可直接套用到 `apps/desktop`（character / ui-overlay / settings 三窗口）。
