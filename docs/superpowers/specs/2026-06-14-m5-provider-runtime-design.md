# M5 设计 · Provider 插件运行时 + OpenAI 兼容 + Ollama

- **日期**：2026-06-14
- **里程碑**：M5（tech-design §4.3 + §5）
- **分支**：`feat/m5-provider-runtime`
- **上游权威**：`docs/plans/2026-05-01-desksoul-tech-design.md`、`docs/plans/2026-05-01-desksoul-impl-plan.md`

## 1. 目标与范围

把 chat 管线从「mock 脚本驱动」接通到「真实 LLM 流式」。M5 的骨架（`ProviderHost` worker 监督/取消/退避、`PluginGateway`、`Keychain`、worker 侧 `fetch-proxy`、`plugin-client`、`ConversationCore` 双轨拆分、流式帧协议）已在 M1/M2/Spike 阶段就位；M5 补齐「接真实 LLM」这一段。

**本期必做（核心基线）**

- `@desksoul/plugin-sdk` 定型：`defineProvider` / `defineSkill` / `defineTool` + 聚合导出
- Main 侧 **FetchGateway**：host 白名单 + Keychain 取密钥注入 `Authorization` + Electron `net` 流式请求
- 内置 `provider-openai-compat`：OpenAI / Claude / Gemini / DeepSeek / 通义（同一文件 + dialect 配置区分）
- 内置 `provider-ollama`：本地零配置探测
- 取消（AbortSignal）端到端（已有，需接真 provider）
- token usage 统计 + 兜底估算
- Keychain 密钥存储（已基本完成，需接线进 FetchGateway）

**本期加项（用户确认全做）**

- Provider 降级链（primary → fallback 顺位重试，同一对话一次）
- tool_call 工具调用通路（数据侧落地 + 回灌）
- Embedding Provider 接口 + openai/ollama 实现

**本期不做（推迟）**

- 设置面板 UI（D3）→ M7：本期只做 `provider.*` RPC + headless 验证
- persona / ContextAssembler 注入 → M6：本期 ChatRequest 只用 SessionStore 历史消息
- 第三方 provider 插件的多 worker 池 → V1+
- J3「歪头疑惑」UI 表现 → M8（本期只做错误分级**数据侧**）

## 2. 关键架构决策

| # | 决策 | 选择 | 理由 |
| --- | --- | --- | --- |
| ① | Provider Worker 拓扑 | **单 worker + 内置 provider 注册表**，`chat.start` 带 `providerId` 分发 | 内置 provider 是可信代码，用不上 worker 隔离收益；最小改动现有单 worker 监督逻辑。第三方插件多 worker 推迟 V1+ |
| ② | fetch 网关流式 | **流式**：Main 用 `net` 边收边转 `plugin.fetchChunk`，worker 侧重建 `ReadableStream` Response | OpenAI/Ollama 都是 SSE；「流式即体验」是硬要求 |
| ③ | ChatRequest messages 来源 | **只用 SessionStore 历史最近 N 条** | M5 聚焦接通真实 LLM；persona/ContextAssembler 属 M6 |
| ④ | token 估算库 | 纯 JS `gpt-tokenizer` | 避免 native 编译 + 镜像下载（呼应 Windows 网络约束） |
| ⑤ | openai-compat 文件粒度 | **单文件 + dialect 配置** | 各厂商差异主要是 endpoint + 字段映射，配置化更紧凑 |

## 3. 端到端数据流

```
Renderer chat.send {sessionId, text}
  → ChatService.send
      ├─ SessionStore.appendUser + beginAssistant
      ├─ 组装 ChatRequest：历史最近 N 条 messages + provider 配置（providerId + fallback 链 + model + 采样参数）
      └─ ProviderHost.send(sessionId, chatRequest)
          → chat.start 帧（扩展：messages / model / providerId / params / tools）
            → [provider worker] providerRegistry[providerId].chat(req, signal)
                → provider 内 fetch(endpoint)  ← 被 installFetchProxy 拦截
                  → plugin.fetchRequest 帧 → ProviderHost → FetchGateway(Main)
                      ├─ host 白名单校验（命中 manifest network:<host>）
                      ├─ Keychain.get(providerId,'apiKey') → 注入 Authorization
                      └─ Electron net.request 发起 → SSE 响应分块
                          → plugin.fetchChunk 帧（流式回传）→ worker 重建 ReadableStream Response
                → provider 解析 SSE → yield ChatEvent: delta / tool_call / usage / done
            → chat.event 帧 → ProviderHost.onEvent → ConversationCore（双轨拆分）
                ├─ delta → chat.stream + behavior.*（BehaviorParser）
                ├─ usage → SessionStore 落 token 账（新增）
                ├─ tool_call → 回灌通路（新增）
                └─ done(stop/cancel/error+errorKind) → chat.done
```

**密钥隔离不变量**：worker `env:{}`，key 永不进 worker；`Authorization` 由 Main 的 FetchGateway 在出网那一刻注入。验收时 grep worker 代码 `process.env` 无可用密钥。

## 4. 组件清单（新增 ✚ / 改造 ✎）

### packages/protocol
- ✎ `schemas.ts`：扩展 `ChatStartFrame`（+`messages`/`model`/`providerId`/`params`/`tools`）；✚ `plugin.fetchChunk` 帧；✚ `ChatRequest` / `ProviderConfig` schema；✎ `ChatEvent.done` 增 `errorKind`（`auth`/`rate_limit`/`timeout`/`network`/`server`/`unknown`）
- ✎ `methods.ts`：✚ `provider.*` 命名空间（`saveKey`/`deleteKey`/`listProviders`/`testConnection`/`listModels`/`ollamaDetect`）；`chat.send` 增可选 `providerId`

### packages/plugin-sdk
- ✎ `index.ts`：聚合导出 `defineProvider` / `types` / `fetch-proxy` / `plugin-client`
- ✚ `define-skill.ts` / `define-tool.ts`（thin client，对齐 tech-design §5.3）
- ✎ `fetch-proxy.ts`：改流式 —— 收 `plugin.fetchChunk` 重建 `ReadableStream` 作为 `Response.body`
- ✚ `sse.ts`：SSE 行解析 helper

### apps/sidecar/src/workers
- ✚ `provider-registry.ts`：`providerId → ChatProvider`
- ✚ `providers/openai-compat.ts`：OpenAI/Claude/Gemini/DeepSeek/通义（dialect 配置区分 endpoint + 请求/响应映射 + SSE 解析 + usage + tool_call）
- ✚ `providers/ollama.ts`：`/api/chat` 流式 + `/api/tags` 探测 + `/api/embeddings`
- ✚ `providers/embedding.ts`：`EmbeddingProvider` 接口 + openai/ollama 实现
- ✎ `provider-worker-entry.ts`：`chat.start` 按 `providerId` 分发；保留 mock 供测试
- ✚ `token-estimate.ts`：`gpt-tokenizer` 纯 JS 兜底估算

### apps/desktop/electron/main
- ✚ `fetch-gateway.ts`：处理 `plugin.fetchRequest` → host 白名单 → Keychain 注入 → Electron `net` 流式请求 → `plugin.fetchChunk` 回传 + 取消传播
- ✎ `provider-host.ts`：message handler 增 `plugin.fetchRequest` 分支；`send` 携带 ChatRequest
- ✚ `provider-config.ts`：内置 provider 注册表 + 配置（endpoint/model/host 白名单/enabled），存 `prefs.json`
- ✚ `provider-service.ts`：`provider.*` RPC handlers
- ✎ `chat-service.ts`：组装 ChatRequest、usage 落账、降级链重试
- ✎ `conversation-core.ts`：`handleEvent` 处理 `usage`（落账回调）+ `tool_call`（回灌）
- ✎ `session-store.ts`：每条 message 存 `tokens_in/out`
- ✎ `ipc-router.ts` / `router.ts`：注册 `provider.*`

## 5. 降级链（关键约束）

流式下不能「吐了一半再换 provider」。规则：**只有在该 session 尚未产出任何 `delta` 时**，首选 provider 的 error 才触发顺位重试（同一对话只重试一次，对齐 §4.3）；首个 delta 之后的 error 直接终结为 `done(error)`。在 `ChatService`（已是编排者）实现。

## 6. 错误分级（J3 数据侧）

provider 把 HTTP/网络错误归一化为 `errorKind`，经 `chat.done` 传出。M5 只做数据侧分级；UI「歪头疑惑」表现留 M8/J3。

| HTTP/情形 | errorKind |
| --- | --- |
| 401 / 403 | `auth` |
| 429 | `rate_limit` |
| 请求超时 | `timeout` |
| 连接失败/DNS | `network` |
| 5xx | `server` |
| 其他 | `unknown` |

## 7. 测试策略

- **单测（vitest）**：
  - openai-compat：mock SSE 流 → 断言 ChatEvent 序列（delta/usage/tool_call/done）+ 错误分级
  - ollama：mock `/api/chat`、`/api/tags`
  - fetch-gateway：白名单放行/拒绝、Keychain 注入、流式 chunk 转发、取消传播
  - 流式 fetch-proxy 重建 `ReadableStream`
  - 降级链：primary 失败（首 delta 前）→ fallback 接管
  - provider-service RPC
  - token 估算兜底
- **e2e-smoke**：保留 mock provider 通路
- **真实端到端**：用户提供 OpenAI Key 手动验（验收项）；本地有 Ollama 则跑探测

## 8. 增量交付（同一分支分阶段提交）

1. SDK 定型 + 流式 fetch-proxy + 协议帧扩展
2. FetchGateway + Keychain 接线（白名单 + net + 注入）
3. openai-compat + ChatRequest 下传 + **管线接通**（里程碑：真实流式跑通）
4. token usage 落账 + 错误分级 + 降级链
5. ollama 探测 + `provider.*` RPC + headless 验证脚本
6. tool_call 通路 + Embedding provider

## 9. 验收对照（impl-plan M5）

| 验收项 | 覆盖方式 |
| --- | --- |
| 配 OpenAI Key → 完整跑通流式对话 | 阶段3 + 用户真实 Key 端到端 |
| 配错 Key → 401 错误正确分级（J3） | 阶段4 错误分级（数据侧 `errorKind=auth`） |
| Ollama 启动后自动检测 + 可用 | 阶段5 `ollamaDetect` + `/api/chat` |
| Worker 内 secrets 读不到 | 密钥隔离不变量 + grep `process.env` 验收 |
