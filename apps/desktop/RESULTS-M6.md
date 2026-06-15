# M6 状态层（Working + Persona State）+ 数据层 — RESULTS

**状态:** ✅ 自动化 PASSED（含真实 better-sqlite3 落库）／ ⏳ Electron ABI rebuild + 真机端到端待办（见末节）
**日期:** 2026-06-15
**平台:** Windows 11 (win32)
**设计/计划:** `docs/superpowers/plans/2026-06-14-m6-state-data-layer.md`（tech-design §6 + §8 MVP 子集）

## 验收映射（impl-plan M6）

| 验收项 | 口径 | 结果 |
| --- | --- | --- |
| 跑 100 轮对话，DB < 5MB，查询最近 20 轮 < 10ms | 自动（`db/acceptance.test`：真 SqliteStore 写 200 条 → `storageUsage().dbBytes < 5MB` + `recentMessages(20)` 计时 < 10ms） | ✅ 实测通过 |
| 强杀进程后重启对话历史完整 | 自动（`acceptance` + `sqlite-store` reopen：新 SqliteStore 复用同文件读回已 commit 行/persona；`chat-service` 跨实例 snapshot） | ✅ 数据侧；⏳ 真机杀 app 手验 |
| D7 数据管理 UI 能看到存储占用 | 自动（`app.storageUsage` RPC → `chat.storageUsage()`；`app.exportData` → `.dsbak`）；UI 留 M7 | ✅ 后端 RPC（用户确认「仅后端」） |
| better-sqlite3 + WAL，schema 四表（messages/persona_state/facts/episodes） | 自动（`db/schema.ts` 建表 + `PRAGMA journal_mode=WAL`；`sqlite-store` 实测） | ✅ |
| 单连接归 Main，Worker 不直连 | 架构（唯一 `ConversationStore` 归 `ChatService`；Worker 仅 provider/fetch 通道） | ✅ |
| 每条 msg 立刻 commit；每轮更新 persona_state | 自动（`session-store`：user 即落库、assistant finish 落库；`chat-service` done(stop)→`updatePersonaState`） | ✅ |
| ContextAssembler（Working 20 轮 + persona）→ ProviderRequest | 自动（`context-assembler.test` 6 例：system 注入 / 20 轮裁剪 / persona 反映 / 空消息过滤 / 角色隔离） | ✅ |
| 角色隔离（character_id 强制前缀） | 自动（store 所有读写带 character_id；`memory-store`/`session-store`/`context-assembler` 隔离用例） | ✅ |
| 导出一键 .dsbak zip | 自动（`export-bundle.test`：zip 含 manifest.json，**不含 secrets.kc**；sqlite 后端含 sessions.db 快照） | ✅ |
| Episodic/Semantic/sqlite-vec stub | `schema.ts` 建 facts/episodes 表，无业务写入方 | ✅（V1.0 启用） |

## 关键设计决策（brainstorm 确认）

1. **数据访问接口化**：`ConversationStore` 接口 + `SqliteStore`（生产）/ `MemoryStore`（单测真源 + 原生不可用降级）。业务单测全注入 MemoryStore，不依赖原生模块；`createConversationStore` 工厂在 better-sqlite3 加载失败时 `console.warn` 降级，不阻塞 app 启动。
2. **导出仅 DB + manifest，不含密钥**（隐私 + 可移植）。
3. **D7 仅后端 + RPC**，UI 留 M7（与 M5 provider.* 先行一致）。
4. **§6 schema 扩展**：`messages` 加 `finish_reason TEXT` 列（运行协议早已用 stop|cancel|error）——已回写 tech-design §6 脚注。
5. **characterId 来源**：不改 `chat.send` 协议；`ChatService` 构造注入 `character()`（接 `CharacterService.current()`，MVP 单角色 `default`/「小灵」）。

## 执行中发现并修复的问题

1. **SessionStore 重构破坏 ChatService 编译**——SessionStore 从「内存 + JSON」改为「运行时状态机 + 委托 ConversationStore」，构造签名从 `{persistPath}` 变 `{store, characterId}`，连带重写 ChatService 接线。三文件（session-store/chat-service/ipc-router+index）作为原子重构连续完成，全量 222→224 测试零回归。
2. **buildSystemPrompt 整段不可被 BehaviorParser 零告警解析**——规约说明文本含示意性 `` `<emo:名字/>` `` 占位与行中 `[intent ...]`，本就不是给解析器重解析的（只有 few-shot 常量保证零告警，已在 `persona-prompt-template.test` 覆盖）。修正测试前提：改为断言 system prompt 复用同源 few-shot。
3. **exactOptionalPropertyTypes 严格 optional**——`updatePersonaState` 不能显式赋 `lastMood: undefined`，改用条件展开；`snapshot`/`assembleContext`/character 入参同此处理。
4. **M5「assembles messages」测试**——ContextAssembler 引入 system 后 roles 由 `[user,assistant,user]` 变 `[system,user,assistant,user]`，同步更新断言。
5. **better-sqlite3 本地装通（Node ABI）**——`.npmrc` 配 `better_sqlite3_binary_host_mirror=npmmirror`（仅二进制镜像，不覆盖 registry，CI 不受影响），`prebuild-install` 命中预编译。vitest 跑在系统 Node 上 → SqliteStore/acceptance **真实跑通**（非 skip）。

## 测试规模

- `@desksoul/protocol`：state(5) + build-system-prompt(4) + methods app.*(3 新增)；全套 100% 覆盖。
- `apps/desktop`：memory-store(6) + sqlite-store(2 真实 SQLite) + export-bundle(2) + context-assembler(6) + session-store(9 重写) + chat-service(20，+3 M6 persona/storageUsage) + db/acceptance(2)。
- 全仓 `pnpm -r typecheck` 全绿；`pnpm -r test` 全绿（apps/desktop 30 文件 224 用例；含 spikes）。

## 真机/打包待办（开发环境为 Node ABI，需在目标机/打包链验证）

1. **Electron ABI rebuild**：本地装的 better-sqlite3 是 Node ABI（供 vitest）；Electron Main 运行时需 `@electron/rebuild`（M9 打包接入 `pnpm rebuild better-sqlite3 --runtime=electron`）。未 rebuild 时 app 内 `createConversationStore` 会降级 MemoryStore（warn），数据不落盘——M9 前属预期。
2. `pnpm --filter @desksoul/desktop dev` 起 app：发消息 → 验证 `userData/data/sessions.db` 落库、persona 演进、ContextAssembler 的 system prompt 注入真 provider。
3. 杀 app 重启 → `chat.snapshot` 读 SQLite，历史完整。
4. `app.exportData` 导出 `.dsbak` 真机校验 zip 内容。

## 已知限制（按设计延后）

- Episodic / Semantic 记忆 + sqlite-vec 向量：仅建表，无 MemoryWorker 写入方 → V1.0。
- ContextAssembler 无 token budget packing（最近 20 轮全注入）；Episodic 向量召回 / Semantic 事实硬注入 → V1+。
- persona_state MVP 字段最小集（affinity/turns/lastMood/lastEnergy/lastInteraction）；约定/关系图谱富 KV → V1+。
- 单角色 `default`；多角色按 session 映射 characterId → V1+（角色管理 E 系列）。
- 导出仅 DB + manifest（无密钥、无角色包文件）；完整迁移 → V1+。
- 旧 `sessions.json` 不迁移（开发期数据；生产首发无历史用户）。
- D7 数据管理 UI → M7。
