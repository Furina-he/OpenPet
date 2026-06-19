# M7b-1 D 系列设置面板设计（Spec）

| 版本 | 日期 | 状态 | 关联文档 |
| --- | --- | --- | --- |
| v0.1 | 2026-06-17 | Approved（brainstorming 收敛） | [m7a-spec](../../plans/2026-06-17-m7a-foundation-spec.md) · [ui-design §8](../../design/ui-design.md) · [impl-plan §M7](../../design/impl-plan.md) |

> M7b 拆两片（已定）：**M7b-1 = D 系列设置面板（D2/D3/D4/D6/D8）**，本文；M7b-2 = C 系列首启引导（后续）。M7b-1 直接建在 M7a 地基（PrefsStore + app.prefs.* + effects seam + Hub 壳 + 组件库）之上。

---

## 1. 目标与范围

**目标**：在 Hub 壳里落地 5 个真实设置面板，给 prefs 接通"有后端"的副作用，并完成 D3→chat 集成（满足"配 Key→听到回复"验收）。

**范围（IN）**
- 5 面板：D2 通用 / D3 模型 API（双栏）/ D4 显示与窗口 / D6 隐私 / D8 关于。
- **全量渲染 + 全量持久化**（已定）：§7 所有开关进 `PrefsSchema`；有后端的接真实 effect，其余存而不接（registry 一次立全、与设计稿一致；功能落地时再消费）。
- effects 接真实依赖：`launchAtLogin / alwaysOnTop / clickThrough / characterScale / lookAt / footGlow`（+ theme 已在 M7a）。
- D3：复用 M5 `provider.*` RPC；新增 `model.activeProvider/activeModel` prefs；chat.send 动态解析 active provider+model 喂下去。
- 新增 `app.openExternal` RPC（D8/D3 外链）。

**范围（OUT → 后续）**
- C 系列首启引导（M7b-2）；D5 语音 / D7 数据（独立；D7 后端 M6 已有，UI 另排）。
- 无后端开关的实际功能（游戏检测、会议降级、对话脱敏、上下文窗裁剪、多显示器策略、预算计费、主密码加密…）——**本期仅持久化为 prefs，不实现其行为**。
- `@vue/test-utils`（延续 M7a：逻辑下沉纯 TS）。

---

## 2. 架构决策

### 2.1 PrefsSchema 扩容（protocol 单一真源加键）
扁平 dotted key，延续 M7a；全部带默认（对齐 ui-design §14.1）。新增分组：
- `general.*`：`startupShow`('character+tray'|'tray'|'none'=‘character+tray’)、`language`('zh-CN')、`timezone`(string,'Asia/Shanghai')、`hour24`(true)、`autoUpdate`(true)、`updateChannel`('stable'|'preview'='stable')、`desktopNotifications`(true)、`proactiveSpeech`(false)、`proactiveFreq`(0–100=30)、`dndStart`('23:00')、`dndEnd`('08:00')
- `display.*`：`lookAtStrength`(0–100=50)、`physics`(true)、`clickThroughBar`(false)、`wallpaperMode`(false)、`followDisplay`('primary')、`crossScreenDrag`('snap')、`fullscreenHide`(true)、`gameDetect`(true)、`meetingDowngrade`(true)
- `privacy.*`：`masterPassword`(false)、`contentUpload`(true)、`masking`(true)、`contextWindow`(number=20)、`clipboard`(false)、`screenshot`(false)、`camera`(false)、`microphone`(true)、`systemNotify`(true)、`affectionProfile`(true)、`logRetentionDays`(7)
- `model.*`：`activeProvider`(string='')、`activeModel`(string='')
- `budget.*`：`enabled`(false)、`monthlyCap`(number=0)、`warnAt`(number=80)、`onExceed`('warn'|'pause'='warn')
- `offline.*`：`fallbackMode`('ollama'|'demo'|'error'='ollama')、`ollamaModel`(string='')

> 既有键（M7a）：`general.launchAtLogin/developerMode/agentThinkingDisplay`、`display.theme/alwaysOnTop/clickThrough/lookAt/footGlow/characterScale`、`privacy.longTermMemory/anonymousStats/crashReport` 不动。

### 2.2 effects 接真实依赖（Main）
`createPrefEffects(deps)` 注入 `{ characterWindow: () => BrowserWindow|null; setLoginItem: (open:boolean)=>void; broadcast: (ch,p)=>void }`。注册（仅有后端者）：
- `general.launchAtLogin` → `setLoginItem`（包 `app.setLoginItemSettings({ openAtLogin })`，注入便于测）
- `display.alwaysOnTop` → `characterWindow()?.setAlwaysOnTop(v)`
- `display.clickThrough` → `characterWindow()?.setIgnoreMouseEvents(v, { forward: true })`
- `display.characterScale` → 复用 `window-scale.scaledBounds` 设 character 窗口 bounds（**收编**当前不落盘的 `character.setScale`；ipc-router 的 `characterSize` 真源改读 prefs）
- `display.lookAt` / `display.footGlow` → `broadcast('app.prefs.changed', …)`（character renderer 已是播放器，加 flag 响应；lookAt 关时渲染端停插值）

`index.ts`：`createPrefEffects({ characterWindow, setLoginItem, broadcast })`（broadcast 来自 ipc-router，故 effects 实例在 ipc-router 内构造，与 prefs-service 一致）。启动 `applyAllEffects(effects, getAll())` 还原窗口态（始终置顶/缩放重启保持）。其余键 effect 留空。

> 调整：M7a 的 `createPrefEffects()` 无参 → 改 `createPrefEffects(deps)`；`EffectsDeps` 落地具体字段。effects 实例构造从 index.ts 移到 ipc-router（因需 broadcast），index.ts 改为传 `characterWindow/setLoginItem` 原料。

### 2.3 D3 模型 API + chat 集成（满足 90s 验收）
- 复用 M5 `provider.*`（saveKey/deleteKey/listProviders/listModels/testConnection/ollamaDetect），**不新增 provider 后端**。
- 新增 `model.activeProvider`/`model.activeModel` prefs（D3 选中即 `app.prefs.set`）。
- **chat.send 动态解析**（手法同 [[里程碑收尾清单]] 提到的 B/C 重构里 characterId 动态化）：给 `ChatService` 注入 `resolveModel?: () => { providerId?: string; model?: string }`；`send()` 未显式带 providerId 时，用 `resolveModel()` 决定 providerChain 首项 + 把 `model` 并入 `assembleContext` 产出的 `ChatRequest.model`。
- **worker 侧零改动**（已核实）：`ChatRequestSchema.model` 已存在；openai-compat/ollama/anthropic/gemini 均已 `req.model ?? dialect.defaultModels[0]`。
- 离线兜底 / 预算告警卡：本期**仅持久化 prefs + 渲染**，不接降级/计费行为（OUT）。

### 2.4 新增 RPC
- `app.openExternal { url }` → `shell.openExternal`（仅允许 http/https，否则 -32602）。result `{ ok:true }`。D8 外链 / D3 文档用。

### 2.5 新组件（最小集，纯逻辑下沉）
- `SettingSection`（带标题分组卡 + 内分隔线 `rgba(white,.06)`，§7.1）
- `RadioGroup`（v-model；离线兜底/启动显示）
- `KeyInput`（遮罩 + 眼睛显示，5s 自动遮回；纯计时逻辑 `key-reveal.ts` 单测）
- `ProviderList`（D3 左栏；状态点 绿=有Key/灰=待填/红=测失败，映射逻辑 `provider-status.ts` 纯测）
- `ConfirmDialog`（D6 高风险开关首启二次确认，§2.8 ②级；红描边）
- 复用 M7a：GlassPanel/Button/Switch/Select/Slider/Input/SettingCard/ToastHost。

### 2.6 页面与接线
- `pages/{GeneralPage,PrivacyPage,ModelApiPage,AboutPage}.vue` 新增；`DisplayPage` 扩成完整 D4。
- `App.vue` active 切换里接上（nav-tree 的 id 已就位：system.display→D4、general?…）。
  - 映射：`model`→D3、`system.display`→D4、`system.privacy`→D6、`system.about`→D8。
  - **D2 通用在 §3.3 与现 nav-tree 均无对应项（源文档缺口）** → 本期决策：在 `系统` 组首位新增叶子 `system.general`→D2（不另立顶级组，避免与 §3.3 偏离过大）。
- 页面薄；onMounted `getAll` 回填，控件 change → `app.prefs.set` → `saved` toast（沿用 DisplayPage 范式）。

---

## 3. 数据流（D3 配 Key→听到回复）

```
D3 ModelApiPage:
  选 provider → app.prefs.set model.activeProvider
  填 Key → provider.saveKey（Keychain，Main）
  选 model → app.prefs.set model.activeModel
  [测试连接] → provider.testConnection
chat.send（overlay）:
  ChatService.send 无显式 providerId → resolveModel() 读 prefs
   → providerChain=[activeProvider]，assembleContext 产出 request.model=activeModel
   → ProviderHost → worker（honor req.model）→ 流式回复
```

设置即时生效副作用（如 alwaysOnTop）：`app.prefs.set` → effects[key](value) 立即作用于 character 窗口 + 顶栏 ✓ 已保存。

---

## 4. 新增/改动文件
**protocol**：`prefs.ts`（加键）、`methods.ts`（+`app.openExternal`）
**Main**：`prefs/effects.ts`（deps 化 + 注册）、`ipc-router.ts`（构造 effects/传 deps、openExternal handler、characterScale 真源改读 prefs）、`index.ts`（传 characterWindow/setLoginItem）、`chat-service.ts`（`resolveModel` 注入 + send 用它）、`app-service.ts`（新，openExternal handler 工厂）
**Renderer**：`components/{SettingSection,RadioGroup,KeyInput,ProviderList,ConfirmDialog}.vue` + `{key-reveal,provider-status}.ts`；`settings/pages/{GeneralPage,PrivacyPage,ModelApiPage,AboutPage}.vue` + `DisplayPage` 扩；`settings/App.vue` + `nav-tree.ts`（加 general）
**收尾**：`RESULTS-M7b1.md`、`CLAUDE.md` 状态行

---

## 5. 测试策略（TDD）
- **effects（核心后端价值）**：注入假 `characterWindow/setLoginItem/broadcast`，验证每个有后端开关施加正确副作用；`applyAllEffects` 启动还原 alwaysOnTop/scale。
- **ChatService resolveModel**：注入 `resolveModel` 返回不同 provider/model，断言 send 出去的 providerChain 首项 + `request.model` 正确（仿 C 重构 dynamic 测）。
- **app.openExternal**：http/https 放行、其它 scheme → -32602（注入假 opener）。
- 纯逻辑：`key-reveal`（5s 计时遮回）、`provider-status`（点色映射）、budget 进度计算、nav active。
- 页面薄，靠 typecheck + 手动冒烟；不引入 @vue/test-utils。

## 6. 验收
- 5 面板按 §7 渲染；所有开关持久化、重启保持；有后端开关即时生效（始终置顶/穿透/缩放/lookAt/footGlow/开机自启）。
- D3：填 Key+选 provider/model → overlay 发消息走该 provider+model 出流式回复（90s 旅程）。
- D6 高风险开关（截屏/摄像头/文件）首启弹二次确认。
- desktop 既有 249 + protocol 175 测试不回归；typecheck + prettier 干净。
- RESULTS-M7b1 + CLAUDE.md 状态行（[[里程碑收尾清单]]）。

## 7. 分阶段执行
- **P1**：PrefsSchema 扩容 + effects-with-deps + index/ipc-router 接线 + app.openExternal（后端，全 TDD）
- **P2**：D4 显示与窗口（消费最多真 effect）+ D2 通用 + D6 隐私（含 ConfirmDialog）
- **P3**：D3 模型 API（ProviderList/KeyInput）+ ChatService resolveModel 集成
- **P4**：D8 关于 + 全量验收 + RESULTS

## 8. 衔接
- M7b-2（C 系列引导）复用本期 D3 的 provider-config 积木（KeyInput/ProviderList/provider.* 调用）。
- 无后端开关（游戏检测/脱敏/预算…）在各自功能里程碑消费已持久化的 prefs。
