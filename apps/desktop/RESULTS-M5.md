# M5 Provider 插件运行时 + OpenAI 兼容 + Ollama — RESULTS

**状态:** ✅ 自动化 PASSED ／ ⏳ 真机联网验收待办（无 Key/网络受限，见末节）
**日期:** 2026-06-14
**平台:** Windows 11 (win32)
**设计/计划:** `docs/superpowers/specs/2026-06-14-m5-provider-runtime-design.md` ／ `docs/superpowers/plans/2026-06-14-m5-provider-runtime.md`

## 验收映射（impl-plan M5）

| 验收项 | 口径 | 结果 |
| --- | --- | --- |
| 配 OpenAI Key → 完整跑通流式对话 | 自动（`chat-service` e2e 集成：真 worker → openai-compat → 流式 fetch-proxy → FetchGateway，仅 HTTP 出口 mock 成 SSE，断言流出 `你好呀` + `done(stop)`） | ✅ 全链路自动通；⏳ **真机联网待用户 Key** |
| 配错 Key → 401 错误正确分级（J3） | 自动（openai-compat `classifyStatus` 401→`auth`；`chat.done.errorKind` 端到端透传；`provider.testConnection` 401 分级） | ✅ 数据侧端到端；⏳ 真机待验 |
| Ollama 启动后自动检测 + 可用 | 自动（`provider.ollamaDetect` 读 `/api/tags`；ollama NDJSON 流式单测 delta/usage/stop + 跨读边界分块） | ✅ 自动；⏳ **本地起 Ollama 待手动验** |
| Worker 内 secrets 读不到 | 自动（worker `env:{}`；密钥仅在 Main 的 FetchGateway 出网那一刻注入；`m5-secret-isolation` 静态断言 worker 不读 `process.env.*KEY/*TOKEN`、不自拼 Authorization） | ✅ |

## 加项验收（brainstorm 确认全做）

| 加项 | 口径 | 结果 |
| --- | --- | --- |
| Provider 降级链 | 自动（`chat-service` 2 用例：首 delta 前 error 顺位重试到链尾；已出 delta 后不再降级） | ✅ |
| tool_call 工具通路 | 自动（openai-compat 流式 `tool_calls` 跨块聚合为 `tool_call` 事件；`chat-service` 经 `PluginGateway.invokeTool` 执行 + 单轮回灌） | ✅（单轮；多步 agent loop V1+） |
| Embedding Provider | 自动（`embed`：openai 批量 `data[].embedding` / ollama 逐条 `/api/embeddings`） | ✅（消费方 M8 记忆） |
| Claude / Gemini dialect | 自动（anthropic SSE content_block_delta + message_delta usage；gemini candidates.parts + usageMetadata；Gemini query-key 经 injectAuth 改写 url） | ✅ |

## 执行中发现并修复的问题

1. **协议扩展破坏下游 narrowing**——`ChatEvent` 从 2 变体扩到 4（+usage/tool_call）后，`conversation-core` 的 done 分支与 `provider-host` 的 message handler 失去类型收窄。提前给 ConversationCore 加「非 delta/done 防御性忽略」、给 ProviderHost 加 `plugin.fetchRequest` 分支（本就是 Phase 2 内容）。
2. **echo fixture JSON 被 BehaviorParser 破坏**——验证 ChatRequest 下传的 fixture 把 request 以 JSON 作 delta 回吐，JSON 里的 `[{` 被双轨拆分器当行为标签吃掉。改为 base64 编码（字母表不含 `<`/`[`，安全穿过 parser）。
3. **e2e-smoke 会走真网络**——冒烟静态 import 生产 `index.js`，而 M5 默认 `defaultProviderId='openai'` → chat.send 走真实 OpenAI。改为 `defaultProviderId = process.env.DESKSOUL_DEFAULT_PROVIDER ?? 'openai'`，e2e 在模块求值期设 `=mock` 强制走 mock provider 路径，M1–M4 冒烟链路零回归。
4. **injectAuth 为 Gemini 演进签名**——Gemini key 在 url query 而非 header，FetchGateway 的 `injectAuth` 从 `(providerId, headers)→headers` 升为 `(providerId, url, headers)→{url?, headers}`，并同步迁移 provider-config 与全部调用方/测试。
5. **计划纠偏**——`createPluginClient` 实际在 `apps/sidecar` 而非 plugin-sdk，未从 SDK barrel 误导出；`schemas.test.ts`/`methods.test.ts` 已存在（追加用例而非新建）。

## 执行方式说明

subagent 派发在本环境被基础设施层阻塞（报「1m 上下文已全量可用」/ 429），改用 inline `executing-plans` 逐 task TDD（写失败测试→实现→跑绿→commit）完成全部 7 Phase。

## 测试规模

- `@desksoul/protocol`：153+ 用例（schemas / methods / provider-config 等）
- `@desksoul/plugin-sdk`：fetch-proxy 流式 / sse / define helpers
- `@desksoul/sidecar`：34 用例（openai-compat 含 tool_calls / ollama / anthropic / gemini / embedding / token-estimate / registry）
- `apps/desktop`：fetch-gateway / provider-config / provider-service / provider-host(13) / chat-service(17，含 e2e 集成/usage/fallback/tool 回灌) / m5-secret-isolation
- e2e-smoke：真实 Electron 三窗口 + mock provider 全 PASS（双轨流式 / 崩溃恢复 / cancel / chat.snapshot / 全 M4 验收）
- 全仓 `pnpm -r typecheck` 全绿；唯一 flaky 是 `provider-host cancel-grace`（M4/S4 既有 200ms watchdog 时序，并发负载偶发，隔离 13/13 绿）

## 真机联网验收待办（开发环境无 Key/直连境外不稳，需在目标机执行）

1. `pnpm --filter @desksoul/desktop dev` 起 app，`provider.saveKey` 写入 OpenAI Key，发消息验证逐 token 流式 + 表情/动作随标签触发。
2. 故意配错 Key 重发，确认 `chat.done.errorKind === 'auth'`（J3 歪头疑惑态文案待 M8）。
3. 本地 `ollama serve` 后验证 `provider.ollamaDetect` 自动检测 + `/api/chat` 真实流式。

## 已知限制（按设计延后）

- provider 配置 UI（D3 双栏 / Key 输入 / 测连接按钮）→ M7；本期仅 `provider.*` RPC + headless。
- persona / ContextAssembler 注入 → M6；本期 ChatRequest 仅用 SessionStore 历史最近 N 条。
- tool_call 仅单轮回灌（`toolRound` 防循环）；多步 agent loop → V1+。
- `provider.testConnection` 真实探活仅 openai 格式（`/models`）可靠，其余凭 hasKey；`listModels` 返回 dialect 默认（真实拉取 V1+）。
- 第三方 provider 插件的多 worker 池 → V1+；本期内置 provider 单 worker 注册表。
- token 估算用 `gpt-tokenizer`（cl100k_base 近似），provider 返回 usage 时优先用真实值。
