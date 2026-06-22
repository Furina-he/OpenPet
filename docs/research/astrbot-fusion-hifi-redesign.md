# AstrBot 融合高保真图重绘 Brief

> 依据：`docs/research/astrbot-fusion-notes.md` + `docs/design/ui-design.md` v0.2。
> 目标：保留 DeskSoul 现有 glass/token 视觉体系，把 AstrBot 融合后的新信息架构补进需要改动的高保真图。

## 当前工具状态

本地仓库与当前会话里暂未暴露可直接调用的 `image2` / `image_gen` 工具；`OPENAI_API_KEY` 也未配置，所以本轮不能实际生成 PNG。下面 prompts 可在 image2 入口可用后直接执行。

生成策略：

- 不覆盖 `UI/*.png` 现有视觉真源；先输出到 `UI/redesign/` 或 `docs/research/assets/`。
- 画布保持 `1448x1086`，浅色主题，双屏/三屏拼板结构继续沿用现有文件。
- 视觉必须保留 DeskSoul token：80% 中性玻璃、15% 暖色品牌、5% 冷色状态；不要迁移 AstrBot/Vuetify 外观。
- 避免生成不可读的小字；最终 UI 文案以实现/文档为准，图像用于布局与视觉方向。

## 必改图

| 原图 | 覆盖屏 | 重绘原因 | 建议输出名 |
| --- | --- | --- | --- |
| `UI/36b542fb-067e-41e6-88f5-26e9ce399226.png` | D3 / D4 | D3 需要从单 provider 配置升级为 Provider Source + Model entries 工作台。D4 不变。 | `UI/redesign/36b542fb-astrbot-provider-workbench-v2.png` |
| `UI/9c5783f4-403f-46c6-8fd3-ac49fa2c9492.png` | G1 / G2 | 插件详情需要区分 DeskSoul native plugin 与 AstrBot Star plugin，展示 Python compat host、权限与元数据。 | `UI/redesign/9c5783f4-astrbot-plugin-installed-v2.png` |
| `UI/b837df11-8842-45c8-976d-c74fbe78f3ad.png` | G3 / G4 | 插件市场升级为 AstrBot 市场源 + Star 插件安装闭环；开发者面板增加 compat host 日志与 Star manifest 校验。 | `UI/redesign/b837df11-astrbot-star-market-v2.png` |
| `UI/6cbd3419-b9b6-4cb5-955d-3ac680e5c8ed.png` | H4 / I1 / I2 | I1/I2 从“桥接配置雏形”升级为 AstrBot compat host、市场源、平台适配与消息路由；H4 增加工具/平台来源。 | `UI/redesign/6cbd3419-astrbot-compat-platform-v2.png` |

## 次级改图

| 原图 | 覆盖屏 | 处理建议 |
| --- | --- | --- |
| `UI/ea030568-bf0b-4f1d-8e1f-55230ec1c646.png` | H1 / H2 / H3 | 融合 MCP 安全门、工具权限与知识库任务状态时再重绘。当前只需补设计说明。 |
| `UI/60ea4a18-bf4e-4a3f-9d05-9080e49bfd8a.png` | B1 / B2 | 若做“远程 IM 消息回桌面提示 / 工具调用轻提示”，只加平台 chip 和来源边条，不重构聊天浮层。 |
| `UI/dc6e09f4-*`, `UI/3c9a77c6-*`, `UI/7283fb5f-*`, `UI/e53d5e72-*` | E / F | Persona/Profile 与知识库绑定是后续角色生态增强，暂不进入第一批 image2。 |

## Image2 Prompts

### 1. D3 Provider 工作台

```text
Use case: ui-mockup
Asset type: DeskSoul high-fidelity UI board, 1448x1086 PNG
Primary request: Redesign only the D3 "模型 API" half of the existing DeskSoul D3/D4 settings board into an AstrBot-inspired Provider Workbench. Keep the D4 "显示与窗口" half visually unchanged in structure.
Style/medium: polished desktop app high-fidelity UI mockup, light mode, glassmorphism + soft anthropomorphic companion design, consistent with DeskSoul UI.
Composition/framing: two large rounded glass panels side by side. Left panel is D3 provider workbench. Right panel remains D4 display/window settings. Keep generous padding, 12px cards, 8px buttons, 10px inputs.
Scene/backdrop: clean off-white app background with subtle warm radial glow, no dark hero art.
Color palette: neutral white glass, main text #171821, secondary text muted gray, warm orange/pink gradient only for CTA/switches/sliders, green success dots, red error dots, blue tech status only for connection.
Text (verbatim): "D3 模型 API", "Provider Sources", "OpenAI Compatible", "Claude", "Ollama Local", "AstrBot Source", "Models", "chat", "vision", "tool", "embedding", "reasoning", "Test model", "Save changes", "D4 显示与窗口".
Layout details: D3 left sub-column lists provider sources with status dots and capability badges. D3 right sub-column shows selected source config: API Key, Base URL, provider type, model table with rows, capability chips, default model radio, per-model test button, failure tooltip. Bottom cards show budget reminder and offline fallback. Include small companion avatar only as a gentle helper in the bottom offline card.
Constraints: Preserve DeskSoul glass tokens and the existing D4 right panel composition. Do not use Vuetify styling. Do not make a marketing page. No oversized hero section. No dense illegible paragraphs. No random brand logos beyond simple abstract provider icons.
Avoid: purple-dominant palette, dark blue dashboard look, beige-only theme, nested cards inside cards, overlapping text.
```

### 2. G1/G2 已安装插件与详情

```text
Use case: ui-mockup
Asset type: DeskSoul high-fidelity UI board, 1448x1086 PNG
Primary request: Redesign the G1 installed plugins list and G2 plugin details drawer to support two runtimes: DeskSoul native plugin and AstrBot Star plugin.
Style/medium: polished desktop app high-fidelity UI mockup, light mode, DeskSoul glass design, production settings interface.
Composition/framing: left large panel G1 list, right 560px details drawer G2, with a small permission confirmation modal overlay near the bottom center.
Color palette: neutral glass UI, warm orange CTA, green verified/success, red high-risk permission, blue runtime/connection badges.
Text (verbatim): "G1 已安装插件列表", "Native", "AstrBot Star", "Python compat host", "运行中", "Web 搜索", "群管助手", "Provider 扩展", "G2 插件详情 / 权限授权", "Star 元数据", "support_platforms", "astrbot_version", "Context bridge", "权限确认", "允许".
Layout details: G1 rows show runtime pill, plugin source, version, status, last call, cumulative calls, enable switch. Add a thin host health strip at the bottom: "Python compat host · running · pid · logs". G2 details include sections for description, config, permissions, tools, hooks, Star metadata, local path. Permission modal lists network access and file write with risk labels and "仅本次 / 允许".
Constraints: Keep the original G1/G2 information density and 560px drawer width. Use Lucide-like line icons. Visual style must be DeskSoul, not AstrBot dashboard/Vuetify. Avoid random decorative illustration.
Avoid: unreadable tiny code, nested floating cards, full-page marketplace hero, dark terminal-only developer look.
```

### 3. G3/G4 AstrBot Star 插件市场与开发者面板

```text
Use case: ui-mockup
Asset type: DeskSoul high-fidelity UI board, 1448x1086 PNG
Primary request: Redesign G3 plugin marketplace and G4 developer panel for AstrBot Star plugin compatibility.
Style/medium: high-fidelity desktop app UI board, light mode, DeskSoul glass/token system.
Composition/framing: two large panels side by side. Left G3 marketplace with search/filter/source controls and plugin cards. Right G4 developer panel with logs, compat host status, manifest/schema validation, tool replay, performance cards.
Color palette: warm orange brand CTA, neutral glass cards, green installed/healthy, red failed/high-risk, blue connection/runtime accents.
Text (verbatim): "G3 插件市场", "市场源", "AstrBot Star", "DeskSoul Native", "从 URL 安装", "GitHub 安全提醒", "安装", "已安装", "权限预览", "G4 开发者面板", "Compat Host", "Star manifest", "Context bridge", "Tool replay", "导出日志".
Layout details: G3 top toolbar includes search, market source dropdown, runtime segmented control, category, sort, tags. Cards show runtime badge, author, version, repo, support platforms, permissions preview. Add an offline/import band: "手动导入 .dsplugin / AstrBot Star 文件夹". G4 console has log levels and stack traces, host health, CPU/memory, tool-call replay stats, manifest.json schema pass/fail.
Constraints: Keep card radius no more than 12px, buttons 8px, inputs 10px. Do not create a marketing landing hero; banner may be compact and functional. Do not copy AstrBot visual system.
Avoid: huge mascot art, arbitrary gradients, purple marketplace theme, overlapping card labels.
```

### 4. H4/I1/I2 AstrBot 兼容主机与平台连接

```text
Use case: ui-mockup
Asset type: DeskSoul high-fidelity UI board, 1448x1086 PNG
Primary request: Redesign the H4/I1/I2 board to show AstrBot compat host, platform adapters, message routing, and trace timeline.
Style/medium: polished desktop app UI mockup, light mode, DeskSoul glassmorphism with restrained operational dashboard density.
Composition/framing: left panel H4 trace timeline, right upper panel I1 AstrBot compat host configuration, right lower panel I2 platform connections.
Color palette: neutral glass background, warm orange for active steps and primary actions, teal/blue for external tool/platform calls, green for online, red for auth failure, gray for disabled.
Text (verbatim): "H4 Agent 思考过程时间线", "tool_call", "platform_event", "AstrBot Star", "I1 AstrBot 兼容主机", "Python compat host", "本地启动", "远程 URL", "Context bridge", "市场源", "角色映射", "同步范围", "I2 平台连接状态", "QQ", "Discord", "Telegram", "企业微信", "消息路由", "权限白名单".
Layout details: H4 timeline alternates warm reasoning steps and teal tool/platform steps, each with duration, cost, expandable result row, and source chip. I1 has host mode segmented control, endpoint/token, health, version, pid/log/restart buttons, market source row, role-to-model mapping, sync scope toggles. I2 platform cards show bot identity, online/auth-failed status, 24h message count sparkline, configure button, message route target.
Constraints: Keep the current three-panel board structure. Show operational controls rather than explanatory prose. Preserve DeskSoul typography and glass tokens. No system prompt content in trace.
Avoid: busy network diagram, server-room illustration, dark terminal screen, platform logos that look trademark-inaccurate.
```

## 验收清单

- 图面第一眼仍是 DeskSoul：玻璃、暖色 CTA、轻量角色温度，而不是 AstrBot/Vuetify。
- 每张图都能回写到 `docs/design/ui-design.md` §4 的文件映射，不产生“图里有但契约没写”的新孤岛。
- D3 的 provider source/model entries 能指导后续 schema 与 SFC 重构。
- G3/G4 明确支持 AstrBot Star 市场源、URL/文件安装、权限预览、compat host。
- I1/I2 明确区分“本地 Python compat host”和“远程 AstrBot URL”，并保留 DeskSoul Main/worker 密钥边界。
