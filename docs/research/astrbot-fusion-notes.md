# AstrBot 融合研究笔记

> 上游源码：`research/upstreams/astrbot`，当前浅克隆 `master @ b691383`。
> 结论先行：后续研究聚焦 AstrBot；AIRI 副本已移除。

## 开源与授权口径

AstrBot 根仓库是 `AGPL-3.0-or-later`。DeskSoul 本身定位为开源项目，因此 AstrBot 融合不再作为阻塞项处理；后续若要直接复用 AstrBot 代码或直接运行 AstrBot 插件生态，项目许可证与分发策略应统一到 AGPL 兼容口径。

- 可以研究并复用 AstrBot 的架构、交互流程、配置模型、插件协议和市场模式。
- 可以规划 AstrBot 插件兼容层，让 DeskSoul 插件市场直接安装/启用 AstrBot 插件。
- DeskSoul 文档中已有“MIT”字样的历史设计占位，若确定直接融合 AstrBot 生态，需要统一更新。

## 高价值融合方向

### 1. Provider 工作台

AstrBot 的 Provider 体系比 DeskSoul 当前 MVP 更完整，尤其是“Provider Source + Model entries”的两层模型。

可参考位置：

- `astrbot/core/provider/provider.py`
- `astrbot/core/provider/entities.py`
- `astrbot/core/provider/manager.py`
- `dashboard/src/views/ProviderPage.vue`
- `dashboard/src/components/provider/ProviderChatCompletionPanel.vue`
- `dashboard/src/composables/useProviderSources.ts`

可融合到 DeskSoul 的点：

- Hub 的模型 API 页面可进化为左侧 provider source，右侧 source 配置 + models 列表的工作台。
- Provider 能力标签可显示 `chat / stt / tts / embedding / rerank / tool / reasoning / vision / audio`。
- Provider test 不只测 active provider，也支持逐 model 测试、失败原因悬浮展示、保存前变更提示。
- `provider_sources` 抽象适合 DeskSoul 后续做 OpenAI-compatible base URL 复用，避免每个模型重复填 key/baseURL。

注意：

- AstrBot 的 provider 实现是 Python async，不能直接接进 Electron Main。
- DeskSoul 已有 `provider-host` worker 和 Main 侧密钥注入约束，融合时保留 DeskSoul 的密钥边界。

### 2. 动态配置渲染器

AstrBot dashboard 通过 metadata 渲染通用配置 UI，覆盖 select、list、dict、file、Monaco editor、slider、switch、特殊 selector 等。

可参考位置：

- `dashboard/src/components/shared/AstrBotConfigV4.vue`
- `dashboard/src/components/shared/ConfigItemRenderer.vue`
- `dashboard/src/components/shared/ProviderSelector.vue`
- `dashboard/src/components/shared/PersonaSelector.vue`
- `dashboard/src/components/shared/KnowledgeBaseSelector.vue`

可融合到 DeskSoul 的点：

- 插件配置页可以使用“Zod schema -> metadata -> 表单渲染”的同类机制。
- 对 DeskSoul 的 D 系列设置面板，不建议全量替换；但插件/Provider 的未知配置项适合动态渲染。
- `_special` selector 思路可迁移成 DeskSoul 的 `ui:widget`，如 `selectProvider`、`selectPersona`、`selectKnowledgeBase`。
- “高级项默认折叠 + 搜索时展开命中项”的交互值得采用。

### 3. ChatBox 交互

AstrBot 的 Web ChatBox 有较完整的聊天交互，包括 SSE/WebSocket 双传输、附件、录音、消息再生成、线程问答、推理侧栏、工具调用展示。

可参考位置：

- `dashboard/src/components/chat/Chat.vue`
- `dashboard/src/components/chat/ChatInput.vue`
- `dashboard/src/composables/useMessages.ts`
- `dashboard/src/components/chat/ReasoningSidebar.vue`
- `dashboard/src/components/chat/ThreadPanel.vue`
- `dashboard/src/components/chat/message_list_comps/ToolCallCard.vue`
- `dashboard/src/components/chat/message_list_comps/ReasoningTimeline.vue`

可融合到 DeskSoul 的点：

- DeskSoul M8 已有聊天浮层和双轨气泡；AstrBot 可补足“管理窗里的完整会话模式”。
- 推理/工具调用不要塞进桌面气泡，适合在 Hub 或调试面板侧栏展示。
- 选中文本后创建 thread 的交互可迁移为“追问这段话”。
- ChatInput 的附件预览、录音状态、发送快捷键配置可作为后续 Chat polish 参考。
- `useMessages.ts` 对 streaming chunk 的 `plain / reasoning / tool_call / tool_call_result / media` 分类，和 DeskSoul 行为标签解析可以并行存在。

### 4. MCP 与工具安全边界

AstrBot 的 MCP client 有比较多的 stdio 安全校验、重连和 schema 兼容处理。

可参考位置：

- `astrbot/core/agent/mcp_client.py`
- `astrbot/core/agent/tool.py`
- `astrbot/core/agent/runners/tool_loop_agent_runner.py`

可融合到 DeskSoul 的点：

- 引入 MCP 前，先做 allowlist、禁止 shell metachar、禁止 inline eval、Docker 参数限制等安全门。
- 工具调用结果在 UI 中分为 pending/success/error，并保留可折叠详情。
- MCP server 连接状态应进入诊断面板，而不是只在日志里看。

### 5. 知识库与长期记忆管理

AstrBot 有知识库上传、文档列表、向量检索、长记忆入口；DeskSoul 已有 SQLite + persona/context 方向，可借鉴管理界面和任务状态。

可参考位置：

- `astrbot/core/knowledge_base/`
- `dashboard/src/views/knowledge-base/`
- `dashboard/src/views/alkaid/LongTermMemory.vue`
- `dashboard/src/components/shared/KnowledgeBaseSelector.vue`

可融合到 DeskSoul 的点：

- Hub 增加“知识库”管理：库列表、文档导入状态、chunk 预览、检索测试。
- 上传/索引应有任务进度和错误详情，避免用户只看到失败 toast。
- 记忆与知识库要和 DeskSoul 的 character isolation 绑定，不能做全局混用。

### 6. Persona 管理

AstrBot 的 persona 管理包含 selector、快速预览、表单、文件夹树。

可参考位置：

- `astrbot/core/persona_mgr.py`
- `dashboard/src/views/persona/`
- `dashboard/src/components/shared/PersonaSelector.vue`
- `dashboard/src/components/shared/PersonaQuickPreview.vue`
- `dashboard/src/components/shared/PersonaForm.vue`

可融合到 DeskSoul 的点：

- DeskSoul 后续角色生态可以参考“角色卡 + 文件夹树 + 快速预览 + 默认角色”的管理模式。
- Persona 与 Provider、KnowledgeBase 的组合配置适合做成“角色 Profile”。

### 7. Trace / Console / Diagnostics

AstrBot dashboard 有 Trace 和 Console 页面，适合借鉴为 DeskSoul 的开发者诊断模式。

可参考位置：

- `dashboard/src/views/TracePage.vue`
- `dashboard/src/components/shared/TraceDisplayer.vue`
- `dashboard/src/views/ConsolePage.vue`
- `dashboard/src/components/shared/ConsoleDisplayer.vue`

可融合到 DeskSoul 的点：

- Provider fallback、tool call、behavior parser 事件、renderer animation event 都可进入 trace timeline。
- 对用户暴露安全摘要，对开发者模式显示更完整诊断。

### 8. 多 IM 平台融合

AstrBot 的多平台接入是核心资产之一，适合纳入 DeskSoul 的“外部消息入口”能力。DeskSoul 仍保持桌面角色为主体验，但可以让 QQ、Telegram、Discord、Slack、飞书、钉钉等 IM 成为角色的远程对话通道。

可参考位置：

- `astrbot/core/platform/`
- `astrbot/core/platform_message_history_mgr.py`
- `astrbot/core/event_bus.py`
- `dashboard/src/views/PlatformPage.vue`
- `dashboard/src/assets/images/platform_logos/`

可融合到 DeskSoul 的点：

- Hub 增加“连接 / IM 平台”页面：平台账号、二维码/Token 配置、启停状态、消息路由、会话隔离。
- DeskSoul 内核增加 `ExternalMessageAdapter` 抽象，把 IM 消息转换为统一 `ChatRequest` / `ConversationEvent`。
- 每个平台可绑定角色、Provider、Persona、知识库和权限策略。
- 桌面角色可显示“来自 Telegram/QQ群/Discord 的远程消息”提示，但完整会话管理放在 Hub。
- 多 IM 平台的消息历史应进入 DeskSoul 现有 conversation/state 层，并遵守角色隔离。

建议实现方式：

- 短期：先做 AstrBot 作为外部 sidecar/compat host 的连接模式，DeskSoul 通过本地 RPC/HTTP 与 AstrBot 交换消息。
- 中期：抽象 DeskSoul 自己的 platform adapter API，逐步把高价值平台适配迁移或兼容进 worker。
- 长期：DeskSoul 插件市场支持 “Desktop plugin” 与 “AstrBot Star plugin” 两类运行时。

### 9. AstrBot 插件市场与 Star 插件兼容

用户明确目标：DeskSoul 插件市场可直接对接 AstrBot 插件生态，到时候直接使用 AstrBot 插件。这个方向应成为插件系统的核心设计输入。

可参考位置：

- `astrbot/core/star/`
- `astrbot/core/star/star.py`
- `astrbot/core/star/base.py`
- `astrbot/core/star/context.py`
- `astrbot/core/star/star_manager.py`
- `astrbot/core/star/session_plugin_manager.py`
- `dashboard/src/views/ExtensionPage.vue`
- `dashboard/src/components/extension/MarketPluginCard.vue`
- `dashboard/src/components/extension/McpServersSection.vue`
- `dashboard/src/components/extension/SkillsSection.vue`
- `dashboard/src/components/extension/componentPanel/`

可融合到 DeskSoul 的点：

- DeskSoul 插件市场新增 AstrBot 市场源管理：默认源、第三方源、从 URL/文件安装、GitHub 安全提醒、版本兼容提示。
- 插件详情页显示 AstrBot Star 元数据：`name / display_name / author / desc / version / repo / logo_path / support_platforms / astrbot_version / pages / i18n`。
- 插件运行时分层：
  - DeskSoul 原生插件：继续走 `@desksoul/plugin-sdk` + worker_threads。
  - AstrBot Star 插件：走 Python compat host，暴露 AstrBot `Context` 兼容 API。
- 插件配置页复用 AstrBot metadata 动态表单思路，并映射到 DeskSoul 设计系统。
- 插件注册的 pages 可以在 DeskSoul Hub 中以隔离 iframe/webview 或 schema-driven page 呈现。
- Star 插件的 command/filter/tool/web api 能力映射到 DeskSoul 的 capability/permission 模型。

兼容层关键问题：

- Python runtime 生命周期：安装、依赖隔离、启动、崩溃恢复、日志收集、禁用策略。
- 上下文桥接：AstrBot `Context` 中的 provider/persona/kb/platform/db/cron 等接口需要映射到 DeskSoul Main/worker 服务。
- 权限模型：AstrBot 插件已有平台和工具能力，DeskSoul 需要安装前确认、运行时最小授权、诊断可见。
- UI 风格：保留 AstrBot 市场和插件管理的信息结构，但视觉必须套 DeskSoul glass/token。

## 暂不建议直接融合

- Vuetify 视觉体系：DeskSoul 已有 UI 高保真图和 glass token，不应把 AstrBot 的 Vuetify 外观搬进来。
- DeerFlow/LangGraph runner：可作为未来外部 agent backend 适配参考，但不是当前融合重点。
- 直接把 AstrBot Python 逻辑塞进 Electron Main：即使要直接使用 AstrBot 插件，也应放在隔离的 Python compat host / sidecar，而不是破坏 Main 进程约束。

## 建议落地顺序

1. **AstrBot 生态兼容设计**：定义 DeskSoul native plugin 与 AstrBot Star plugin 双运行时、权限模型、安装模型、许可证口径。
2. **插件市场对接**：先做市场源、插件列表、详情、安装/卸载/重载 UI；后端可先 mock，再接 AstrBot compat host。
3. **AstrBot Python compat host**：独立进程运行 Star 插件，提供 Context 兼容 API 与 DeskSoul Main RPC 桥。
4. **多 IM 平台入口**：先以 AstrBot platform adapter 为 sidecar 能力接入，再逐步抽象 DeskSoul `ExternalMessageAdapter`。
5. **Provider 工作台 polish**：把 D3 模型 API 页演进成 source/model 双栏，并兼容 AstrBot provider source 概念。
6. **Chat 管理窗增强**：把 reasoning/tool-call/attachments/thread 交互纳入 Hub Chat，而桌面气泡仍保持轻量。
7. **MCP 安全门**：在真正开放 MCP 前实现 allowlist 和配置校验。
8. **知识库/Persona 管理**：把 AstrBot 的管理交互拆成 DeskSoul 设计体系下的页面。

## DeskSoul 对应映射

| AstrBot 能力 | DeskSoul 对应位置 | 采用方式 |
| --- | --- | --- |
| Provider Source + Model | `apps/desktop/src/renderer/settings/pages/ModelApiPage.vue`、Main provider service | 重写适配 |
| Dynamic config renderer | Hub 设置 / 插件配置 | 借鉴 metadata 设计 |
| ChatBox full mode | M8 Chat UI / Hub Chat | 借鉴交互 |
| Reasoning / tool timeline | Dev diagnostics / Hub Chat side panel | 重写组件 |
| MCP client safety | future plugin/tool host | 借鉴安全规则 |
| KnowledgeBase dashboard | future Knowledge Hub | 借鉴页面信息架构 |
| Persona manager | future Character/Profile Hub | 借鉴交互 |
| Multi-IM platform adapters | External message adapters / Hub connections | 兼容优先，逐步原生化 |
| Star plugin runtime | Plugin market / plugin host | Python compat host + Context bridge |
| AstrBot plugin market | Hub plugin market | 直接对接市场源与安装流程 |
