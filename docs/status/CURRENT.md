# DeskSoul · 项目当前状态 / 新对话对接入口

> 这是**任何新对话的第一份要读的文件**。读完即可在零上下文下接着干。架构/PM 在每个阶段末更新本文件。
> 最后更新：2026-06-17（分支 `feat/m7b1-d-series`，M7b-1 **P1 已落**）。

---

## 1. 一句话现状

M1–M6 + 预-M7 B/C 重构 + **M7a 前端地基** 已在 `main`；M7b 拆 **M7b-1（D 系列设置面板）/ M7b-2（C 引导）**；M7b-1 **P1 地基已完成**（在 `feat/m7b1-d-series`）。**当前待办 = 执行 M7b-1 的 P2（D4 显示与窗口）**。

## 2. 立即要做的事（给执行者）

```bash
git checkout feat/m7b1-d-series
```
按 **`docs/plans/2026-06-17-m7b1-p2-d4-plan.md`** 逐 task 执行（`superpowers:executing-plans`，TDD RED→GREEN，每 task 末提交）。完成后跑全量测试 + typecheck，停下汇报。

> ⚠️ 本阶段改了 `packages/protocol/src/*`（无）——P2 主要在 desktop renderer + ipc-router；**若改 protocol src，跑 desktop 前先 `pnpm --filter @desksoul/protocol build`**（desktop 消费 protocol 的 dist，见 [[build-test-workflow-gotchas]]）。

> P2 落地后回**架构/PM 对话**出 P3（D2+D6）计划。

## 3. 路线图（PM 维护的当前细分）

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| M1–M6 / B/C 重构 / M7a | 见 git；地基齐备 | ✅ main |
| M7b-1 P1 | schema 扩容 + effects 接依赖（launchAtLogin/alwaysOnTop/clickThrough）+ app.openExternal | ✅ 完成（254/177 绿） |
| **M7b-1 P2** | **D4 显示与窗口（含 SettingSection 组件 + characterScale 收编）** | 📋 **计划就绪，待执行** |
| M7b-1 P3 | D2 通用 + D6 隐私（含 ConfirmDialog 高风险二次确认 + nav `system.general`） | ⏳ 待 P2 后出计划 |
| M7b-1 P4 | D3 模型 API（双栏）+ chat 集成（active provider/model 喂 chat.send） | ⏳ |
| M7b-1 P5 | D8 关于（app.openExternal 接外链）+ 全量验收 + RESULTS-M7b1 定稿 + tag | ⏳ |
| M7b-2 | C1–C4 首启引导（复用 D3 provider-config 积木） | ⏳ 独立 spec/plan |
| M8 / M9 | 聊天UI+气泡+系统集成 / 打包打磨 | ⏳ |

> 注：原 spec 把 D2/D4/D6 并为一阶段；PM 据 D4 的组件+收编工作量细分为 P2(D4)/P3(D2+D6)，每阶段一计划、一执行对话，保持可控。spec 仍是 WHAT 的真源，phase 计划是 HOW/顺序。

## 4. 权威文档索引

- 产品：`PRD.md`；架构真源：`docs/plans/2026-05-01-desksoul-tech-design.md`；任务总清单：`docs/plans/2026-05-01-desksoul-impl-plan.md`
- 前端真源（做 renderer 前必读）：`docs/plans/2026-05-01-desksoul-ui-design.md`（§2 设计系统 / §3 IA / §7 D 面板 / §14.1 开关默认表）
- M7a：`docs/plans/2026-06-17-m7a-foundation-{spec,plan}.md`
- **M7b-1 设计（WHAT）**：`docs/plans/2026-06-17-m7b1-d-series-spec.md`
- 阶段计划（HOW）：`...-m7b1-p1-foundation-plan.md`（✅）、`...-m7b1-p2-d4-plan.md`（待执行）
- 阶段结果：`apps/desktop/RESULTS-M7b1.md`（P1 已记）

## 5. 关键约定（务必遵守）

- **TDD**：先红后绿；里程碑 inline 逐 task（subagent 派发被 429 限流，**别派 subagent 跑实现**，见 [[project-subagent-inline]]）。
- **测试不引入 `@vue/test-utils`**：逻辑下沉纯 TS 测，SFC 薄渲染（先例 chat-view/theme-resolver/toast-queue）。
- **协议单一真源 = Zod**：改 `packages/protocol`；**改 protocol src 后必 `pnpm --filter @desksoul/protocol build` 再跑 desktop**（dist 消费，[[build-test-workflow-gotchas]]）。
- **跑全量 desktop 测试前先 `pnpm --filter @desksoul/sidecar build`**（chat-service/provider-host 用真实 worker dist）。
- **prettier 非 CI 门禁**（CRLF 假阳性）：**只格式化自己新写的文件/行，别动旧代码**（methods.ts/index.ts 有存量欠账，留 M9 清）。
- 提交 Conventional Commits；每里程碑 `feat/m{N}-...` 分支；收尾 RESULTS + 更新本文件 + CLAUDE 状态行。
- 装原生依赖走 npmmirror 镜像（[[project_env_network]]）。

## 6. 基线（开工前应为真）

- `pnpm --filter @desksoul/protocol test` → **177 绿**
- `pnpm --filter @desksoul/sidecar build` 后 `pnpm --filter @desksoul/desktop test` → **254 绿**
- `pnpm --filter @desksoul/desktop typecheck` → 干净；工作树干净；分支 `feat/m7b1-d-series`

## 7. M7b-1 执行者需知的 gotcha（架构决策记录）

1. **D3 worker 零改动**（P4 用）：`ChatRequest.model` 已存在、各 worker 已 honor；D3 集成纯 Main+renderer（chat.send 从 prefs 读 activeProvider→providerChain、activeModel→request.model，手法同 characterId 动态化）。
2. **theme/lookAt/footGlow 不进 Main effects 表**：`prefs-service.set` 对所有 key 广播 `app.prefs.changed`，renderer 自响应。effects 表只装有 Main 动作的键（P1：launchAtLogin/alwaysOnTop/clickThrough）。
3. **characterScale 收编（P2 做）**：D4 slider 持久化经 `app.prefs.set('display.characterScale')`；effect 设窗口 bounds（`scaledBounds`，底边中点锚定、幂等）并同步 ipc-router 的 `characterSize` 真源；旧 `character.setScale` RPC 留作拖动实时预览。
4. **启动 hydrate**：`applyAllEffects` 启动施加 `alwaysOnTop`(默认 true) 等到角色窗（§14.1 默认），属预期。
5. **D2「通用」无 nav 槽位**（P3 做）：§3.3/nav-tree 均无 → 在「系统」组首位加 `system.general`→D2。
6. **全量渲染+持久化**：§7 所有开关进 PrefsSchema 持久化；只有"有后端"的接真实 effect，其余存而不接（功能落地再消费）。

## 8. 角色分工

- **架构/PM（与我对接的对话）**：管路线图、写 spec/计划、维护本文件 + CLAUDE.md、收尾归档。每阶段落地后回我出下一阶段计划。
- **执行（新开对话）**：按就绪 plan 逐 task TDD 实现提交。
