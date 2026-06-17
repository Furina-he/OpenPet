# M7a 前端地基（PrefsStore + RPC / Tailwind+token / Hub 壳 / 主题 walking-skeleton） — RESULTS

**状态:** ✅ 自动化 PASSED（CI 等价四关全绿）／ ⏳ 运行时 GUI 目视冒烟待办（见末节）
**日期:** 2026-06-17
**平台:** Windows 11 (win32)
**设计/计划:** `docs/plans/2026-06-17-m7a-foundation-spec.md` + `docs/plans/2026-06-17-m7a-foundation-plan.md`（ui-design §2/§3.3/§14.1）
**分支:** `feat/m7a-foundation`（建在 B/C 重构 `bcc864e` 之上）

## 验收映射（M7a spec §1）

| 验收项 | 口径 | 结果 |
| --- | --- | --- |
| PrefsSchema 单一真源（全量 key + 默认 + 单点校验） | 自动（`protocol/prefs.test`：DEFAULT_PREFS 默认 / `.shape` 逐字段 safeParse / strip 未知 key） | ✅ |
| `app.prefs.getAll/set/changed` RPC 注册 | 自动（`protocol/methods.test`：三方法 + params 校验） | ✅ |
| PrefsStore 接口化 + DI（Memory 单测／Json 生产，仿 ConversationStore） | 自动（`memory-store` 3 / `json-store` 4） | ✅ |
| JsonPrefsStore 原子写（.tmp→rename）+ 坏文件降级不崩 | 自动（`json-store.test`：reopen 持久 / 坏 JSON→默认 / 缺 key 回填） | ✅ |
| createPrefsStore 工厂（无路径→Memory，构造失败降级） + effects 空 seam | 自动（`effects.test` 2；工厂分支） | ✅ |
| prefs-service：深校验→落盘→广播 changed→施加副作用；非法 key/值→-32602 | 自动（`prefs-service.test` 4：getAll/set 广播/未知 key/非法值不落盘） | ✅ |
| 接线 Main（构造+spread+dispose+启动 hydrate） + `prefs.json` 路径 | 自动（`prefs/wiring.test`：经 createRouter 分发 + 缺 value→-32602）+ 全量回归 | ✅ |
| Tailwind v3 + PostCSS + 设计 token（浅/深 CSS 变量） | 自动（`build`：`assets/settings-*.css` 15.4kB Tailwind 编译入 Hub） | ✅ |
| theme-resolver（pref+系统→具体主题，'system' 跟随） | 自动（`theme-resolver.test` 2） | ✅ |
| 组件子集 GlassPanel/Button/SettingCard + 表单 Switch/Select/Input/Slider + ToastHost | typecheck（vue-tsc 含 `**/*.vue`）+ build；Toast 队列逻辑自动（`toast-queue.test` 3） | ✅ |
| Hub 壳无 router（左导航 280 / 顶栏 56 / 状态条 32），nav-tree §3.3 | 自动（`nav-tree.test` 3：分组/扁平/active）+ build 编译 App.vue | ✅ |
| 主题 walking-skeleton 端到端（设置→prefs.set→落盘→广播→换肤→✓已保存） | 编译验证（build 产 settings renderer）+ 逐环节单测；⏳ 运行时目视 | ✅ 编译/逻辑；⏳ GUI |
| 跨 renderer 即时换肤（overlay/character 订阅 changed，DRY helper） | 自动（`subscribe.ts` + 三入口接线）+ typecheck + build | ✅ 编译/接线；⏳ GUI |

## 关键设计决策

1. **Prefs 持久化接口化 + DI**（与 M6 `ConversationStore` 同构）：`PrefsStore` 接口 + `JsonPrefsStore`（生产，原子写）/ `MemoryPrefsStore`（单测真源 + 降级）。`createPrefsStore` 工厂在无路径或构造失败时降级内存，不阻塞启动。
2. **PrefsSchema 扁平 dotted key**（`display.theme` 等）：便于 `set(key,value)` 按 `PrefsSchema.shape[key]` 单点深校验；params 浅校验在协议层、深校验在 prefs-service。
3. **"即时生效"契约**：`app.prefs.set` → 深校验 → 落盘 → 广播 `app.prefs.changed` → Main 副作用。M7a 界面主题靠**广播让 renderer 自行换肤**，无需 Main 副作用，故 effects 表为空（M7b 的 seam：alwaysOnTop/clickThrough/characterScale/lookAt）。
4. **主题用 CSS 变量 + `[data-theme]`**：逻辑（pref+系统→具体主题）下沉纯 TS `resolveTheme` 单测；SFC 仅薄 DOM 写入。三 renderer 共用 `subscribeTheme()`（DRY）。
5. **组件薄 SFC**：有分支逻辑的（Toast 队列）下沉纯 TS 测；纯展示组件靠 vue-tsc（tsconfig include `**/*.vue` + DOM lib，实测真校验非跳过）+ build 集成验证，不引入 @vue/test-utils。

## 执行中发现并修复的问题

1. **`z.unknown()` 在对象里自动可选**（计划缺陷）——`app.prefs.set` 原计划 `value: z.unknown()`，实测使 `{key}`（缺 value）仍 parse 成功，违反计划自身的 Task 2 / Task 7 wiring 断言（缺 value 应 -32602）。改为 `value: z.union([z.string(), z.number(), z.boolean()])`（必填 + 覆盖所有 pref 标量值），深校验仍由 prefs-service 按 key 做。
2. **desktop 消费 protocol 的 dist 而非 src**——`@desksoul/protocol.main → dist/index.js`。新增 `prefs.ts` 后 desktop 测试 `PrefsSchema` 运行时 undefined，须先 `pnpm --filter @desksoul/protocol build` 再跑 desktop 测试。（改协议 → 重建 protocol → 测 desktop 的固定节奏。）
3. **prettier --check 的 Windows CRLF 假阳性 + 旧代码连带重排**——`prettier --write` 会把 pre-existing 未格式化的旧代码（chat.send 块 / M2-M6 测试 / require.resolve）一并重排；且 git 检出的 CRLF 工作副本被 prettier 误报行尾（repo 存 LF，CI 全新检出会过）。处置：只手动换行**我自己**超 100 的 union 行（`style(protocol)` 提交），不触碰任何旧代码。
4. **`cd apps/desktop && pnpm add` 留下部分安装态**——随后 `pnpm typecheck`（全量 turbo）报 spikes `Cannot find type definition file for 'electron-vite/node'`；根目录跑一次完整 `pnpm install` 对账后 12/12 全绿。（partial install 会破坏未 hoist 的 spike 本地 electron-vite 链接。）

## CI 等价验收（全量 turbo）

- `pnpm typecheck`：**12/12 successful**（含 4 真实包 + 5 spikes + tsconfig）。
- `pnpm lint`：0 tasks（无包配 lint 脚本，CI 此步为 no-op）。
- `pnpm test`：**10/10 successful** — `@desksoul/desktop` 38 文件 **249** 用例 / `@desksoul/protocol` 10 文件 **175** 用例 / 余包绿。
- `pnpm build`：**9/9 successful**（electron-vite 三路；`settings` renderer 含 Tailwind CSS 编译产物）。

## 测试规模（本里程碑新增）

- `@desksoul/protocol`（+4 → 175）：`prefs.test`(3) + `methods.test` app.prefs.*(1)。
- `apps/desktop`（+23 → 249）：`prefs/memory-store`(3) + `prefs/json-store`(4) + `prefs/effects`(2) + `prefs-service`(4) + `prefs/wiring`(2) + `theme-resolver`(2) + `toast-queue`(3) + `nav-tree`(3)。
- 全程 RED→GREEN→commit；零回归（旧 226 desktop 用例全保留）。

## 运行时 GUI 目视冒烟（待办，需真机 `pnpm --filter @desksoul/desktop dev`）

> 编译（build 产 settings renderer + Tailwind CSS）与逐环节逻辑（prefs-service 广播 / theme-resolver / toast 队列 / nav-tree / wiring）均已自动覆盖；**坏文件降级亦由 `json-store.test` 自动覆盖**。以下为纯运行时视觉/跨窗行为，需人工目视：

1. Hub 窗口按 §3.3 渲染（左导航 280 / 顶栏 56 / 内容区 / 状态条 32）。
2. 改"界面主题"下拉 → Hub + overlay（+ character）**同时换肤** + 顶栏闪 `✓ 已保存`。
3. 重启 app → 主题保持（`userData/data/prefs.json` 落盘生效）。
4. 删 / 故意写坏 `prefs.json` → app 正常启动用默认（不崩）。

## 已知衔接缺口（按设计延后至 M7b）

- D 系列五屏正式面板 / C 系列首启引导 / Bubble 等组件 / Hub 搜索 / 总览页 —— M7a 仅 `system.display` 有真实内容，余路由占位"留待 M7b"。
- pref effects 表为空 seam：`display.alwaysOnTop / clickThrough / characterScale / lookAt` 的 Main 副作用在 M7b 注册（`character.setScale` 旧路径届时收编进 `display.characterScale` effect）。
- `general.*` / `privacy.*` 已在 schema 定义默认，但无 UI / 无副作用接线（M7b）。
