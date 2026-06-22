# Provider 工作台（AstrBot 对齐）实现结果 RESULTS

> 计划：[`plans/2026-06-21-provider-workbench.md`](plans/2026-06-21-provider-workbench.md)（A→D 15 task）
> 设计 spec：[`specs/2026-06-21-provider-workbench-design.md`](specs/2026-06-21-provider-workbench-design.md)
> 分支：`feat/provider-workbench`（自 main 切出）。本轮 inline 逐 task TDD（红→绿→提交）。

## 一句话

把单 `provider`/单 `model` 体系重构为 AstrBot 对齐的**两层「Provider Source + Model entries」**工作台：可多建 source（同 adapter 并存）、每 source 挂多 model（能力标签 + 逐模型测试）、6 能力 tab、按能力选默认（**无降级链**）、**API Key 明文随 source 存进 prefs（用户裁定，放弃 keychain）**。旧 `model.activeProvider/activeModel/*BaseUrl` 键并存，启动一次性迁移搬入新两层。

## 验证（本会话实跑）

| 包 | 测试 | typecheck | build |
| --- | --- | --- | --- |
| `@desksoul/protocol` | **200 passed** | 干净 | exit 0 |
| `@desksoul/sidecar` | **39 passed** | 干净 | exit 0 |
| `@desksoul/desktop` | **322 passed**（65 files） | **0 error** | electron-vite exit 0 |

> 铁规遵守：改 protocol 后 `pnpm --filter @desksoul/protocol build` 再跑 desktop；跑全量 desktop 前 `pnpm --filter @desksoul/sidecar build`。

## 提交（6720d37..aa77204，baseline 1 + task 15）

- `6720d37` chore(baseline)：codex 提交工作树此前未提交的 M7b/M8 实现基线（含 D3「逐 provider 自定义 baseUrl」特性——**plan A4 依赖的 `getProviderBaseUrl`/`model.*BaseUrl` 即来自此**——与一批 UI 打磨）。建立干净基线后逐 task 提交均干净。
- **A 协议**：`98b8a4c` schema+templates+helpers(+getModelsUrlForAdapter) · `54dccee` resolveChatTarget · `a8713a9` prefs 两层键 · `0b72599` 迁移纯函数 · `f229e51` methods provider.* 重写 + ChatStartFrame.adapter
- **B Main**：`88836a4` provider-service 重写 · `0bad9ba` FetchGateway 源感知 resolveHost/injectAuth · `8337501` chat 解析接 resolveChatTarget + host.send 透传 adapter/baseUrl · `81d62e4` ipc-router/index 接线 + 启动迁移
- **C Worker**：`aa0ca16` worker 按 adapter 选 provider fn（两层路由）
- **D 渲染**：`09328d4` view-model · `3d4d328` AddSourceDialog · `afce978` 左右两面板 · `f5ba7fc` ModelApiPage 工作台壳 · `aa77204` C2 引导 ProviderConfigPanel 重写

## 关键实现点

1. **数据模型**（`packages/protocol/src/provider-config.ts`）：`ProviderSourceSchema`（key 默认空、enabled 默认 true）、`ModelEntrySchema`（id=`${sourceId}/${model}`、caps 默认 `{}`）、`Capability`(6)、`Adapter`(4)、`ModelCaps`、`AdapterTemplate` + `ADAPTER_TEMPLATES` + `generateUniqueSourceId`/`modelEntryId`/`getModelsUrlForAdapter`/`resolveChatTarget`（无降级链，任一缺失/disabled → null 走离线兜底）。
2. **prefs**：追加 `model.providerSources`/`model.models`（数组默认 `[]`）+ `model.default{Chat,Embedding,Stt,Tts,Rerank,Agent}ModelId`（默认 `''`）。
3. **协议方法**：删旧 `provider.saveKey/deleteKey/listProviders/testConnection/listModels`，加 `getConfig/upsertSource/deleteSource/fetchModels/addModel/deleteModel/setModelEnabled/updateModelCaps/testModel/setDefault`，保留 `ollamaDetect`；`ChatStartFrame` 加可选 `adapter`。
4. **Main**：`provider-service` 操作动态 sources/models（读 `source.key`）；`provider-config` `resolveHost`（最长 apiBase 前缀匹配 → sourceId）/`injectAuth`（按 adapter authStyle 注入 `source.key`，去 keychain）；`chat-resolve.resolveSendTarget` + `chat-service` 用 `resolveChatTarget`，`host.send` 透传 `adapter`/`baseUrl`，`TurnState.adapter`；`startup-provider-migrate.runProviderMigrationIfNeeded`（异步预取 keychain key，仅 sources 空且有旧 activeProvider 时合成）；`ipc-router.resolveModel` → `resolveChatTarget`；`index` 去 provider 的 keychain 依赖、whenReady 改 async 先迁移再 registerIpcRouter。
5. **Worker**：`resolveProviderByAdapter(adapter, baseUrl)`（合成最小 dialect，与 `resolveProvider` 共用 `chatFnFor`）；`provider-worker-entry` **adapter 优先**选流（两层 sourceId 非内置 dialect，必须走 adapter+baseUrl），抽 `errorStream`。
6. **渲染**：`provider-config-view`（纯）`sourcesForTab/modelsForSource/mergedModelEntries/capsBadges/formatContextLimit/defaultPrefKeyFor/CAPABILITY_TABS`；`provider/AddSourceDialog.vue`、`provider/ProviderSourcesPanel.vue`、`provider/ProviderModelsPanel.vue`；`ModelApiPage.vue` 重写为工作台壳（能力 tab + 两面板 + AddSourceDialog + 全 provider.* RPC，保留预算/离线卡）；`ProviderConfigPanel.vue` 重写为 C2 引导精简版（建源→Key→拉模型→设 chat 默认）。

## 计划外修正（A3 连带）

A3 给 `Prefs[PrefKey]` 加入数组值类型后，`Display/General/Privacy/ModelApiPage.vue` 里 `set<K>(key, value: Prefs[K])` 转发到只收标量的 `app.prefs.set` 触发 TS2322。修法：保留签名、在 rpc 边界 cast `value as string|number|boolean`（渲染端只经 `app.prefs.set` 写标量，两层数组键走 `provider.*`）。

## 人工硬门槛（已通过，收官 2026-06-22）

1. **PM 复核** ✅ 签收（信任已跑测试 200/39/322 全绿，[[pm-review-trust-reports]]）。
2. **真 Electron GUI 冒烟** ✅ 已人工验证可用（工作台建源/填 Key/拉模型/加模型/设默认/逐模型测试 + onboarding C2）。**残留**：[`docs/research/astrbot-fusion-hifi-redesign.md`](../research/astrbot-fusion-hifi-redesign.md) 的 redesign 工作台 PNG 始终未生成（`UI/36b542fb` 仍旧单 provider），**像素级视觉终审未做**（[[ui-must-match-design-pngs]] / [[design-png-verify-before-claims]]）——已接受当前为可用，出图后可补对照。
3. **真 Key 端到端** ✅ 已人工验证（配 source + key + 设默认 → 聊天走该模型）。
4. **收官 tag** ✅ `mvp/provider-workbench-done` 已打。

## 已知 follow-up（非阻塞，记录）

- `dev/mock-bridge.ts` 仍 mock 旧 `provider.listProviders/saveKey/...`；`?page=ModelApiPage` 视觉 harness 要渲染工作台需补 `provider.getConfig/fetchModels/...` mock。
- `index.ts` 托盘 `connected: () => !!prefs['model.activeProvider']` 仍读旧键；纯两层新用户（无迁移）可能显示「未连」。
- 旧 `model.activeProvider/activeModel/*BaseUrl` 键并存（迁移后弃用，未删，留后续清理）。
- 同 `apiBase` 仅 key 不同的多 source，URL→source 反查取首个匹配（已知限制，常见多端点 apiBase 不同不受影响）。
- `ProviderList.vue` 可能已成孤儿（typecheck 干净，未删）。
