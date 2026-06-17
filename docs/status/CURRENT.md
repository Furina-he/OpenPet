# DeskSoul · 项目当前状态 / 新对话对接入口

> 这是**任何新对话的第一份要读的文件**。读完即可在零上下文下接着干。架构/PM 在每个里程碑或阶段末更新本文件。
> 最后更新：2026-06-17（对应分支 `feat/m7b1-d-series`）。

---

## 1. 一句话现状

M1–M6 + **M7a（前端地基）已完成并合入 `main`**；M7b 拆为 **M7b-1（D 系列设置面板）** 与 M7b-2（C 系列引导）；**当前待办 = 在分支 `feat/m7b1-d-series` 上执行 M7b-1 的 P1 地基计划**。

## 2. 立即要做的事（给执行者）

```bash
git checkout feat/m7b1-d-series      # 已含 M7a(main) + M7b-1 的 spec/计划文档
```
按 **`docs/plans/2026-06-17-m7b1-p1-foundation-plan.md`** 逐 task 执行（用 `superpowers:executing-plans`，TDD RED→GREEN，每 task 末提交）。P1 = 4 个 task：
1. `PrefsSchema` 扩容（§7 全量键）
2. `app.openExternal`（method + app-service，仅 http/https）
3. effects 接真实依赖（launchAtLogin / alwaysOnTop / clickThrough）
4. ipc-router/index 接线（effects 用 broadcast 构造 + setLoginItem + appService + 启动 hydrate）

P1 验收：`pnpm --filter @desksoul/protocol test` + `pnpm --filter @desksoul/desktop test` 全绿、`typecheck` 干净、prettier 干净。

> P1 落地后回到**架构/PM 对话**出 P2 计划（不要凭空写 P2，它依赖 P1 的具体 API）。

## 3. 路线图

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| M1–M6 | 骨架/IPC/行为协议/渲染/Provider/状态数据层 | ✅ 合入 main |
| 预-M7 B/C 重构 | ChatService TurnState 收敛 + characterId 动态化 + 降级守卫修复 | ✅ 合入 main（commit `bcc864e`） |
| M7a | 前端地基（PrefsStore+RPC、Tailwind+token、Hub 壳、主题 skeleton） | ✅ 合入 main |
| **M7b-1 P1** | **schema 扩容 + effects 接依赖 + openExternal** | 📋 **计划就绪，待执行** |
| M7b-1 P2 | D4 显示与窗口 + D2 通用 + D6 隐私（含高风险二次确认） | ⏳ 待 P1 后出计划 |
| M7b-1 P3 | D3 模型 API（双栏）+ chat 集成（active provider/model 喂 chat.send） | ⏳ 待 P1 后出计划 |
| M7b-1 P4 | D8 关于 + 全量验收 + RESULTS-M7b1 | ⏳ |
| M7b-2 | C1–C4 首启引导（复用 D3 的 provider-config 积木） | ⏳ 独立 spec/plan |
| M8 | 聊天 UI(B) + 桌面气泡(A) + 系统集成(J) | ⏳ |
| M9 | 打包 + 打磨 + 文档 | ⏳ |

## 4. 权威文档索引

- 产品需求：`PRD.md`
- 架构真源：`docs/plans/2026-05-01-desksoul-tech-design.md`（v0.2 Electron Pivot）
- 任务总清单：`docs/plans/2026-05-01-desksoul-impl-plan.md`
- 前端真源（做任何 renderer 前必读）：`docs/plans/2026-05-01-desksoul-ui-design.md`（§2 设计系统 / §3 IA / §7 D 面板 / §14.1 开关默认表）
- M7a：`docs/plans/2026-06-17-m7a-foundation-spec.md` + `-plan.md`
- **M7b-1 设计**：`docs/plans/2026-06-17-m7b1-d-series-spec.md`
- **M7b-1 P1 计划**：`docs/plans/2026-06-17-m7b1-p1-foundation-plan.md`

## 5. 关键约定（务必遵守）

- **TDD**：先写失败测试→看红→最小实现→看绿。里程碑走 inline 逐 task（本环境 subagent 派发被 429 限流，**不要派 subagent 跑实现**）。
- **测试不引入 `@vue/test-utils`**：逻辑下沉纯 TS 模块测，Vue SFC 只做薄渲染（先例 `chat-view.ts` / `theme-resolver.ts` / `toast-queue.ts`）。
- **协议单一真源 = Zod**：改协议先改 `packages/protocol`（`prefs.ts` / `methods.ts` / `schemas.ts`）。
- **提交**：Conventional Commits（`feat:`/`fix:`/`docs:`/`refactor:`/`test:`/`build:`）。每里程碑开 `feat/m{N}-...` 分支。
- **里程碑收尾**：RESULTS-M{N}.md + 更新本文件 + CLAUDE.md 状态行（+ 可选 git tag）。
- **装依赖走镜像**：直连 GitHub 不通，原生二进制走 npmmirror（`.npmrc` 已配）。
- **跑全量 desktop 测试前先 `pnpm --filter @desksoul/sidecar build`**（chat-service/provider-host 测试用真实 worker dist）。P1 的新测试（prefs/effects/app-service/wiring/protocol）不依赖 worker，可单独跑。

## 6. 基线（开工前应为真）

- `pnpm --filter @desksoul/protocol test` → 175 绿
- `pnpm --filter @desksoul/desktop test` → 249 绿
- 工作树干净；分支 `feat/m7b1-d-series`

## 7. M7b-1 执行者需知的 gotcha（架构决策记录）

1. **D3 worker 零改动**：`ChatRequestSchema.model` 已存在，各 provider worker 已 `req.model ?? dialect.defaultModels[0]`。D3 集成纯 Main+renderer：chat.send 从 prefs 读 `model.activeProvider`（→ providerChain）+ `model.activeModel`（→ `ChatRequest.model`）。手法同 B/C 重构里 characterId 动态化（给 ChatService 注入 getter）。
2. **theme/lookAt/footGlow 不进 effects 表**：`prefs-service.set` 对**所有** key 广播 `app.prefs.changed`，renderer 自响应即可。effects 表只装有 Main 动作的键。
3. **characterScale 延到 P2**：它与既有 `character.setScale` RPC + ipc-router 的 `characterSize` 真源纠缠，跟 D4 面板一起做（slider 改走 `app.prefs.set('display.characterScale')`，收编旧 RPC）。
4. **启动 hydrate 行为变化**：P1 后 `applyAllEffects` 启动会把 `display.alwaysOnTop`(默认 true) 施加到角色窗——这是 §14.1「始终置顶默认开」的预期语义，记入 RESULTS。
5. **D2「通用」无 nav 槽位**：§3.3 与现 `nav-tree` 都没有，P1 不涉及；P2 决策为在「系统」组首位加 `system.general`→D2。
6. **全量渲染+持久化策略**：§7 所有开关都进 `PrefsSchema` 持久化，但只有"有后端"的接真实 effect，其余存而不接（功能落地再消费）——已与产品确认。

## 8. 角色分工（本项目当前模式）

- **架构/PM（在与我对接的对话里）**：管路线图、写 spec/计划、维护本文件 + CLAUDE.md，做收尾归档。
- **执行（新开对话）**：按就绪的 plan 文档逐 task TDD 实现并提交。完成一阶段后，回 PM 对话出下一阶段计划。
