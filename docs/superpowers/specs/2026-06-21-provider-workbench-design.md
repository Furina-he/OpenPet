# Provider 工作台（AstrBot 对齐）设计 spec

> 日期：2026-06-21 ｜ 状态：草案（待用户 review → writing-plans）
> 来源：`docs/research/astrbot-fusion-notes.md` §1 + 用户裁定（直接按 AstrBot 实现，铁律放一边）
> 上游参考：`research/upstreams/astrbot`（master @ b691383, v4.26.0-beta.11, AGPL-3.0）

## 1. 背景与动机

DeskSoul 当前 Provider 体验差，根因在**数据模型**而非 UI：

- `packages/protocol/src/provider-config.ts` 是写死的 6 条 dialect（openai/deepseek/qwen/claude/gemini/ollama）的**单选枚举**。
- 用户配置只有 `{ id, enabled, baseUrl?, model? }` + 全局 `model.activeProvider` / `model.activeModel` → **单 provider、单 model**。
- key 按 `providerId` 存 keychain、baseUrl 按固定 pref key（`model.openaiBaseUrl`…）→ **同类型无法并存两个 source**（同时配 OpenAI 官方 + 本地 vLLM + OpenRouter 做不到）。
- 无能力标签、无逐模型测试、高级配置（超时/代理/headers）写死禁用。
- `ProviderConfigPanel.vue` 里的"提供商源 / 新增"是**视觉外壳**（`SOURCE_IDS` 假 id，"新增"只是重选 6 内置之一）。

**目标**：把 AstrBot 的 provider 子系统忠实移植进 DeskSoul（TS/Electron 栈），用"Provider Source + Model entries"两层模型根治适配差，配模型 UI 参考 AstrBot 的三面板。

## 2. 用户已拍板的两项参数

- **(a) 6 能力 tab 全做成可配**：chat / agent runner / STT / TTS / embedding / rerank 都能配置、存储、展示。chat 端到端打通；其余先"可配但 DeskSoul 暂无运行时消费"（embedding 待向量 V1.0；STT/TTS/rerank 待各自后端）。不纠结"存而不接"。
- **(b) API Key 照 AstrBot 明文存配置**：放弃 keychain，key 成为 `ProviderSource.key` 字段，随 source 存进 prefs（明文）。

## 3. 参考的 AstrBot 真源（已精读）

| 关注点 | AstrBot 文件 |
| --- | --- |
| 配置形态 `provider_sources`/`provider`/`*_settings` | `astrbot/core/config/default.py` |
| 路由：default_provider_id + per-session（umo）覆盖，**无降级链** | `astrbot/core/provider/manager.py`（`get_using_provider`/`set_provider`） |
| 能力枚举 chat/stt/tts/embedding/rerank | `astrbot/core/provider/entities.py`（`ProviderType`） |
| 两层模型 + UI 行为（合并已配置/可用、能力徽标、逐模型 test/enable、模板） | `dashboard/src/composables/useProviderSources.ts` |
| UI 三面板结构 | `dashboard/.../provider/ProviderSourcesPanel.vue`、`ProviderModelsPanel.vue`、`AddNewProvider.vue`、`views/ProviderPage.vue` |

## 4. 数据模型（对齐 AstrBot `provider_sources` + `provider`）

```ts
// = AstrBot ProviderType
type Capability = 'chat' | 'agent_runner' | 'stt' | 'tts' | 'embedding' | 'rerank';
type Adapter = 'openai' | 'anthropic' | 'gemini' | 'ollama'; // openai = 任意 openai-compatible

// Source = 一个"端点账号"，可多建，同 adapter 可并存（= AstrBot provider source）
interface ProviderSource {
  id: string;            // 唯一可改，如 "openai-main" / "vllm-local"
  adapter: Adapter;      // = AstrBot type/provider
  capability: Capability; // = provider_type；决定它落在哪个 tab
  apiBase: string;       // = api_base
  key: string;           // (b) 明文随 source 存（非 keychain）
  enabled: boolean;
  // 高级（按 adapter 模板渲染，缺省可空）：
  timeoutMs?: number;
  proxy?: string;
  headers?: Record<string, string>;
  ollamaDisableThinking?: boolean;
}

// Model 条目 = 挂在某 Source 下的具体模型（= AstrBot provider 条目）
interface ModelEntry {
  id: string;            // `${sourceId}/${model}`，与 AstrBot 一致
  sourceId: string;
  model: string;
  enabled: boolean;
  caps: { vision?: boolean; audio?: boolean; tool?: boolean; reasoning?: boolean }; // = modalities + reasoning
  contextTokens?: number; // = max_context_tokens
}
```

**存储**：两个数组进 `PrefsSchema`（`prefs.ts`）：

- `model.providerSources: ProviderSource[]`
- `model.models: ModelEntry[]`
- 每能力一个默认指针：`model.defaultChatModelId`、`model.defaultEmbeddingModelId`、`model.defaultSttModelId`、`model.defaultTtsModelId`、`model.defaultRerankModelId`、`model.defaultAgentModelId`（值 = 某 `ModelEntry.id`）。对齐 AstrBot `provider_settings.default_provider_id` / `provider_stt_settings.provider_id` …

沿用现有 `app.prefs.*`（get/set/changed 广播 + effects）管线。**淘汰**：`model.activeProvider`、`model.activeModel`、各 `model.*BaseUrl`。

**adapter 模板**（替代旧 `BUILTIN_PROVIDERS` 单选）：保留为"新建 source 时的默认值表"——每个模板含 `{ adapter, capability, 默认 apiBase, authStyle, format, 默认模型 }`，喂"新增 source"弹窗与高级字段渲染。不再是可选 provider 全集。模板按"能力"分组（chat/embedding 首批有 openai/anthropic/gemini/ollama 等；agent_runner/stt/tts/rerank 首批模板可少或空——tab 存在但暂无可选 adapter 属正常，对齐"先做成可配"）。

## 5. 能力 tab 范围（照 AstrBot 6 tab，(a)）

顶部能力 tab：对话 / Agent Runner / 语音转文字 / 文字转语音 / 向量 / 重排。Source 与 Model 按当前 tab 的 `capability` 过滤。

| tab | 配置 | DeskSoul 消费 |
| --- | --- | --- |
| chat | ✅ | ✅ 端到端 |
| embedding | ✅ | 待向量 V1.0（sqlite-vec） |
| agent_runner / stt / tts / rerank | ✅ | 暂无运行时（先可配，按 (a)） |

## 6. 路由 / 选择（照 AstrBot，无降级链）

- `chat.send` 解析：`model.defaultChatModelId` → 找 `ModelEntry` → 它的 `ProviderSource` → 拼 `{ sourceId, adapter, apiBase, model }` 交 worker（**不含 key**；key 由 Main 在 FetchGateway 边界注入，见 §9）。
- **无自动跨 provider 降级链**（AstrBot 没有）。`chat-service.ts` 现有 `TurnState.chain` 引擎保留但喂单项 `[默认]`；失败走现有"离线兜底卡"（Ollama/演示/报错）。引擎在，未来恢复链容易。
- **每会话临时切模型**（AstrBot `set_provider(umo)`）：schema 预留默认指针即可，本轮**不做** UI（后续聊天浮层选模型）。

## 7. 协议（重写 `provider.*`，`methods.ts` Zod 单一真源）

淘汰旧：`provider.listProviders` / `provider.saveKey` / `provider.deleteKey` / `provider.testConnection`（被下列取代）。保留：`provider.ollamaDetect`。

新增/改写：

- `provider.getConfig` → `{ sources: ProviderSource[], models: ModelEntry[], templates: AdapterTemplate[] }`
- `provider.upsertSource({ source })` → `{ ok, id }`（id 改名时级联 models.sourceId；key 含在 source 内一并存）
- `provider.deleteSource({ id })` → `{ ok }`（级联删该 source 下 models；若默认指针指向被删 model 则清空）
- `provider.fetchModels({ sourceId })` → `{ models: string[] }`（复用现有按 adapter 拉 `/models`、`/api/tags`）
- `provider.addModel({ entry })` / `provider.deleteModel({ id })` / `provider.setModelEnabled({ id, enabled })` / `provider.updateModelCaps({ id, caps })`
- `provider.testModel({ id })` → `{ ok, latencyMs?, errorKind? }`（逐模型测，带耗时；对齐 AstrBot `testProvider`）
- `provider.setDefault({ capability, modelId })` → `{ ok }`

## 8. Main 服务改动

- **`provider-config.ts`**（key 注入边界，最关键）：
  - `resolveHost(url)`：不再遍历 6 内置 host，改为遍历**配置的 sources**，`url.startsWith(source.apiBase)` → `{ sourceId }`。保留 SSRF allowlist 语义（仅已配端点可达）。
  - `injectAuth(sourceId, url, headers)`：从 source 配置读 `source.key`（非 keychain），按 adapter authStyle 注入（Bearer / x-api-key / query-key）。仍在 **Main FetchGateway 边界**注入，复用现有 gateway——key 不必进 worker（零额外工作；明文只是落盘形态）。
- **`provider-service.ts`**：按新协议重写为操作动态 sources/models（从 prefs 读）+ source.key；`testModel`/`fetchModels` 读 source.key 注 header。`errorKind` 分类沿用。
- **`chat-resolve.ts` / `chat-service.ts`**：`resolveModel()`（ipc-router 注入）改为读 `defaultChatModelId` → 解析出 `{ sourceId, adapter, apiBase, model }`。现有 `TurnState.chain` 的链项标识用 `sourceId`（FetchGateway 据 url→sourceId 注 key）；`model`/`apiBase` 随 send 透传给 worker。chain 单项。
- **`index.ts`**：依赖接线调整；keychain 对 provider 退役（若无其它用户则整体保留备用，不删类）。

## 9. Worker / Host 改动

`apps/sidecar/src/workers/provider-registry.ts` + `provider-worker-entry.ts`：当前按 providerId 从 6-table 查 format/baseUrl。改为 **honor 显式传入的 `{ adapter(→format), apiBase(→baseUrl), model }`**（sources 是动态的，不能再查静态表）。key 仍由 Main FetchGateway 注入，worker 不见 key。

## 10. 渲染层 UI（参考 AstrBot 三面板 + DeskSoul 视觉）

`ModelApiPage.vue` 改造为工作台：

- **能力 tab 条**（顶部，6 tab）。
- **左：Source 列表**（对应 `ProviderSourcesPanel`）——按 tab 过滤；行显 adapter 图标 + id + enable 状态；底部"➕ 新增"开 **AddSourceDialog**（对应 `AddNewProvider`，选 adapter 模板 → `generateUniqueSourceId`）。
- **右：Source 配置 + Models 表**（对应 `ProviderModelsPanel`）：
  - 上：basic（id / apiBase / KeyInput）+ 可折叠 advanced（timeout / proxy / headers，按 adapter 模板）。
  - 下：Models 表——搜索框、`拉取模型`、`+自定义模型`、合并"已配置 + 可用"列表、每行**能力徽标**（vision/audio/tool/reasoning + 上下文 `128K/1M`）+ `测试`（带耗时）+ enable 开关 + 删除 + **设为默认**单选。
- 复用现有 `Input/Select/Switch/Slider/KeyInput` + `ds-glass`/§2 token；**视觉真源** = `UI/36b542fb….png`（D3）+ `docs/research/astrbot-fusion-hifi-redesign.md` 的 D3 工作台 brief；实现期对照 AstrBot 三 `.vue` 抠交互。
- **C2 引导页**：`ProviderConfigPanel.vue`（D3/C2 共用积木，见 `provider-config-view.ts`）同步改为"建 1 source + 选 1 model"精简版，保证首启不回归。

## 11. 迁移（老配置不丢，一次性幂等）

启动时若新数组为空且检测到旧 prefs（`model.activeProvider` / `activeModel` / `model.*BaseUrl`）：

1. 每个配过的内置 provider → 合成一个 `ProviderSource`（adapter=该内置、apiBase=旧 BaseUrl 或默认）。
2. 旧 keychain `[providerId].apiKey` → 读出写入新 `source.key`（明文，(b)）。
3. `activeModel` → 一个 `ModelEntry`，`defaultChatModelId` 指向它。
4. 清旧键（或留着不读）。

## 12. 安全说明（明确决策）

**(b) 用户明确选择 key 明文存配置**（`prefs.json` 内），等同 AstrBot。放弃 keychain/safeStorage 加密。`resolveHost` 的 url allowlist 仍保留（限已配端点）。此项为用户知情裁定，记录在案。

## 13. 测试（TDD，Vitest）

先红后绿，逻辑下沉纯 TS 单测：

- 目标解析（sources/models + defaultChatModelId → worker target）
- 迁移函数（旧 prefs/keychain → 新 sources/models/默认）
- 唯一 id 生成（`generateUniqueSourceId` / `${sourceId}/${model}`）
- 能力默认推断、`testModel` errorKind 分类
- `resolveHost`/`injectAuth`（新 source 驱动）

SFC 薄渲染（不引入 `@vue/test-utils`）。**改 protocol src 后必 `pnpm --filter @desksoul/protocol build` 再跑 desktop；跑全量 desktop 前 `pnpm --filter @desksoul/sidecar build`。**

## 14. 不在本轮范围（future）

- 完整 metadata 动态配置渲染器（notes §2）——本轮高级字段按 adapter 写死，够用即可。
- 每会话临时切模型 UI、自动降级链恢复。
- STT/TTS/rerank/agent_runner 的真实运行时消费。
- 模型能力自动探测（AstrBot 靠后端 metadata；DeskSoul 暂靠用户勾选 + 内置默认）。

## 15. 影响文件清单

- `packages/protocol/src/provider-config.ts`（新 schema + adapter 模板）
- `packages/protocol/src/prefs.ts`（新 prefs 键 + 弃旧）
- `packages/protocol/src/methods.ts`（新 `provider.*` Zod）
- `apps/desktop/electron/main/provider-config.ts`、`provider-service.ts`、`chat-resolve.ts`、`chat-service.ts`、`ipc-router.ts`、`index.ts`
- `apps/sidecar/src/workers/provider-registry.ts`、`provider-worker-entry.ts`
- `apps/desktop/src/renderer/settings/pages/ModelApiPage.vue`
- `apps/desktop/src/renderer/components/ProviderConfigPanel.vue`、`settings/provider-config-view.ts`
- 新增：`ProviderSourcesPanel.vue`、`ProviderModelsPanel.vue`、`AddSourceDialog.vue`
- onboarding C2（复用 ProviderConfigPanel）
- 对应 `test/` 单测
