# M7a 前端地基设计（Spec）

| 版本 | 日期 | 状态 | 关联文档 |
| --- | --- | --- | --- |
| v0.1 | 2026-06-17 | Approved（brainstorming 收敛） | [tech-design](2026-05-01-desksoul-tech-design.md) · [ui-design](2026-05-01-desksoul-ui-design.md) · [impl-plan](2026-05-01-desksoul-impl-plan.md) |

> 本文是 M7 拆分后**地基段（M7a）**的设计规格。M7 原计划（impl-plan §M7）把"整套设计系统 + 5 个设置面板 + 首启引导"压进 1.5 周；架构审查（2026-06-17）发现前端地基（prefs 持久化 / Tailwind+token / 组件库 / Hub 壳）全为空地，而它是"设置即时生效""D4 缩放主题""M8 热键"的硬依赖。故先做 M7a 地基（含一个 walking skeleton 端到端验证），再做 M7b（D 系列面板 + C 系列引导）。

---

## 1. 目标与范围

**目标**：立起前端地基，并用一个 walking skeleton 把"设置即时生效"整条链路端到端打通验证。

**M7a 范围（IN）**
- `PrefsStore`（Main 单写者）+ `prefs.json` 持久化 + `MemoryPrefsStore`（测试/降级）
- `PrefsSchema`（`@desksoul/protocol`，Zod 单一真源，编码 §14.1 全量开关 + 默认）
- `app.prefs.getAll / set` RPC + `app.prefs.changed` 通知
- Main 侧 effects registry（pref → 副作用；set 与启动 hydrate 都施加）
- Tailwind + 主题 token 体系（CSS 变量承载浅/深色，运行时切换；编码 ui-design §2 全量 token）
- Hub Window 壳（左导航 280px / 顶栏 56px / 状态条 32px，§3.3 尺寸；无 vue-router）
- 组件库 M7a 子集：`GlassPanel` `Button` `Switch` `Select` `Input` `Slider` `SettingCard` `Toast/ToastHost`
- **Walking skeleton = 界面主题（system/light/dark）**：一个最小分段控件 → `prefs.set('theme', …)` → 落盘 → `prefs.changed` 广播 → 各 renderer 切 `[data-theme]` → 顶栏 `✓ 已保存` toast

**M7a 不做（OUT → M7b/M8）**
- D2/D3/D4/D6/D8 五个完整设置面板（M7a 只接 theme 这一个真实设置；其余 key schema 已定义但副作用/UI 留 M7b）
- C1–C4 首启引导
- `Bubble` `Avatar` `EmotionDot` `KeyCap`（B/J 系列 = M8 才有消费端，YAGNI 推迟）
- 顶栏全局搜索（§7.1）、总览页内容卡片（留 M7b）
- `@vue/test-utils` 与组件渲染测试（见 §6）

---

## 2. 架构决策

### 2.1 PrefsStore — 持久化（Main）
- 独立 `<userData>/desksoul/data/prefs.json`，**原子写**（写临时文件 + rename），不进 `sessions.db`。
- 接口 `PrefsStore { getAll(): Prefs; set<K>(key, value): void; close(): void }`，仿 `ConversationStore` 的接口化 + DI；实现 `JsonPrefsStore`（生产）/ `MemoryPrefsStore`（单测/原生不可用降级）。
- 位置 `apps/desktop/electron/main/prefs/`（`store.ts` 接口 / `json-store.ts` / `memory-store.ts`）。
- **理由**：tech-design §6 明确 `prefs.json`；prefs 是 app 全局（非角色隔离）、备份/导出语义与对话不同；延续"每份数据单一写者"纪律。
- **备选（否决）**：`sessions.db` kv 表——耦合 app prefs 与对话库、复杂化导出。

### 2.2 PrefsSchema — 单一真源（protocol）
- `packages/protocol/src/prefs.ts` 定义 `PrefsSchema`（Zod），编码 ui-design §14.1 全量开关 + 默认值，分组：`general / display / privacy / model / notifications`。
- 导出 `Prefs` 类型、`DEFAULT_PREFS`、`PrefKey`。
- M7a 定义全量 key（很便宜，立住默认表真源），但只**接通** `display.theme` 的副作用；其余 key 的副作用/UI 留 M7b。
- 关键 key（M7a 起步相关，类型/默认对齐 §14.1）：

  | key | 类型 | 默认 | 备注 |
  | --- | --- | --- | --- |
  | `display.theme` | `'system'\|'light'\|'dark'` | `'system'` | **skeleton**；系统未指明降级浅色 |
  | `display.alwaysOnTop` | bool | `true` | M7b 接副作用 |
  | `display.clickThrough` | bool | `false` | M7b |
  | `display.lookAt` | bool | `true` | M7b |
  | `display.characterScale` | number 0.5–2 | `1` | M7b；替代当前不落盘的 `character.setScale` |
  | `general.launchAtLogin` | bool | `true` | M7b |
  | `general.developerMode` | bool | `false` | M7b |
  | `privacy.longTermMemory` | bool | `true` | M7b |
  | …（§14.1 其余项同此模式） | | | |

- **理由**：仓库"Zod 单一真源"约定；§14.1 即权威默认表。
- **备选（否决）**：每设置一个 typed RPC——`methods.ts` 爆炸、默认值散落。

### 2.3 Prefs RPC — "即时生效"契约（3 个）
在 `packages/protocol/src/methods.ts` 注册：
- `app.prefs.getAll` `params {}` → 校验后的完整 `Prefs`（renderer 挂载时 hydrate）。
- `app.prefs.set` `params { key: PrefKey, value: unknown }` → 按 `PrefsSchema` 对应字段校验 → 落盘 → 施加副作用 → `{ ok: true }`；非法 key/value → `-32602`。
- `app.prefs.changed`（notification，Main→所有 renderer）`params { key, value }`。
- `✓ 已保存` toast = renderer 对 `set()` resolve 成功的反应（§7.1，无保存按钮）。
- **理由**：通用 getAll/set + changed 广播，最小且可扩展，每个未来设置零成本复用；这正是 walking skeleton 要钉死的契约。
- **备选（否决）**：set 后 renderer 自拉 getAll——多窗口一致性差、更费。

### 2.4 Effects registry — 副作用编排（Main）
- Main 侧 `Map<PrefKey, (value) => void>`，把 pref 映射到副作用。**`set()` 时**与**启动 hydrate 时**各跑一遍，维持"单写者施加副作用"。
- M7a 仅注册 `display.theme → broadcast('app.prefs.changed', …)`（renderer 据此切主题）。M7b 往表里加 `alwaysOnTop / clickThrough / characterScale / lookAt …`。
- 位置 `apps/desktop/electron/main/prefs/effects.ts`（注入窗口句柄 + broadcast，便于单测）。

### 2.5 Hub 壳 — 导航（renderer，无 vue-router）
- 响应式 `activeRoute` ref + 静态导航树配置（来自 §3.3）+ `<component :is>` 切内容区。
- 壳：左导航 280px（可折叠 64px）、顶栏 56px、状态条 32px。
- 导航树做成**数据**（`nav-tree.ts`），M7b 只往里加条目 + 内容组件；active 态解析拆纯 TS 单测。
- 内容区 M7a 仅"系统→显示"页放 theme 分段控件，其余条目渲染占位。
- 位置 `apps/desktop/src/renderer/settings/`（壳 + 页）。
- **理由**：单窗口桌面 app 无 URL/历史/深链需求；省依赖、对 sandbox 友好。
- **备选（否决）**：vue-router——overkill。

### 2.6 Tailwind + 主题 token（renderer）
- Tailwind + **CSS 自定义属性**承载可主题化 token：浅/深色值挂 `:root` / `[data-theme="dark"]`；Tailwind `theme.extend` 引用这些 var（如 `colors.glass-bg: var(--ds-glass-bg)`）。
- **主题切换 = 运行时切 `[data-theme]` attribute，零重建**；`'system'` 用 `matchMedia('(prefers-color-scheme: dark)')` 解析为具体值（未指明降级浅色，§2.2）。
- 编码 ui-design §2 全量 token：色阶（§2.1）、玻璃（`blur(28px) saturate(180%)` 等 §2.2）、字号阶梯 12/13/14/16/20/28/36（§2.3）、圆角 8/10/12/16/18 与间距 4/8/12/16/24/32/48（§2.4）、缓动 `cubic-bezier(.22,1,.36,1)`（§2.5）。
- 位置 `apps/desktop/src/renderer/theme/`（`tokens.css` + `tailwind` 配置 + `theme-resolver.ts` 纯 TS），overlay/settings 共用；`electron.vite.config.ts` renderer 接 PostCSS/Tailwind。
- **理由**：UI 文档 + CLAUDE.md 强制 Tailwind；CSS var 让主题切换免重建；M7b 写面板靠 utility class 提速。Tailwind 产物即 CSS，对 sandbox renderer 无碍。

### 2.7 组件库 M7a 子集（YAGNI）
`GlassPanel`（S/M/L 三档，§2.6.1）、`Button`（主/次/幽灵/危险 × 三尺寸）、`Switch` `Select` `Input` `Slider`、`SettingCard`（§7.1 卡片行：左 Label+Desc / 右控件）、`Toast/ToastHost`（顶栏薄条 ✓已保存 + 浮卡，§2.6.3）。
- 位置 `apps/desktop/src/renderer/components/`，SFC + 可测逻辑下沉纯 TS（延续 `chat-view.ts` 先例）。
- 推迟：`Bubble` `Avatar` `EmotionDot` `KeyCap`（消费端在 M8）。

---

## 3. 数据流（walking skeleton：界面主题）

```
启动：Main 读 prefs.json → hydrate → effects.apply(全量) →
      app.prefs.getAll 就绪
切换：settings renderer 分段控件
  → window.desksoul.rpc('app.prefs.set', {key:'display.theme', value:'dark'})
  → Main: PrefsSchema 校验 → JsonPrefsStore.set（原子写）→ effects['display.theme'] →
          broadcast('app.prefs.changed', {key, value})
  → 所有 renderer: on('app.prefs.changed') → theme-resolver → 切 [data-theme]
  → settings renderer: set() resolve → ToastHost 顶栏 ✓ 已保存
```

崩溃/重启：renderer 挂载 `getAll` → 据 `display.theme` 还原 `[data-theme]`（与 prefs 一致）。

---

## 4. 新增/改动文件

**新增**
- `packages/protocol/src/prefs.ts`（PrefsSchema / Prefs / DEFAULT_PREFS / PrefKey）
- `packages/protocol/src/methods.ts` +3 方法（改动）
- `apps/desktop/electron/main/prefs/{store.ts, json-store.ts, memory-store.ts, effects.ts}`
- `apps/desktop/electron/main/prefs-service.ts`（`app.prefs.*` handler 工厂，仿 `provider-service.ts`）
- `apps/desktop/src/renderer/theme/{tokens.css, theme-resolver.ts}` + Tailwind/PostCSS 配置
- `apps/desktop/src/renderer/components/*`（上列子集）
- `apps/desktop/src/renderer/settings/{App.vue, nav-tree.ts, pages/*}`（替换 2 行占位）

**改动**
- `apps/desktop/electron/main/index.ts`（构造 PrefsStore + effects，注入 prefs-service；启动 hydrate）
- `apps/desktop/electron/main/ipc-router.ts`（spread prefs-service handlers，仿 providerService）
- `apps/desktop/electron.vite.config.ts`（Tailwind/PostCSS）
- `apps/desktop/package.json`（tailwindcss / postcss / autoprefixer devDeps）

---

## 5. 单元边界（每块可独立理解/测试）
- `PrefsStore`：纯 Node，getAll/set/close；不知 RPC/Electron。
- `prefs-service`：纯函数集合，注入 PrefsStore + effects；不依赖 Electron。
- `effects`：注入窗口句柄 + broadcast 的 Map；可注假依赖单测。
- `theme-resolver`：纯 TS（system+matchMedia → light/dark）。
- `nav-tree` / active 态：纯 TS。
- 组件：SFC 薄渲染，逻辑（若有）下沉纯 TS。

---

## 6. 测试策略（TDD）
- `JsonPrefsStore`：get/set/默认合并/原子写/**坏 JSON 文件降级到默认**——比照 `sqlite-store.test.ts`。
- `prefs-service` + `effects`：注入 `MemoryPrefsStore` + 假窗口/假 broadcast，验证 set→落盘→副作用→changed；非法 key/value → `-32602`。比照 `provider-service` 范式。
- `theme-resolver`：`system`+各 matchMedia → 具体值；未指明降级浅色。
- `nav-tree` active 态解析。
- `router.test.ts` 既有套件覆盖新 RPC 的 Zod 路由。
- **不引入 `@vue/test-utils`**：逻辑下沉纯 TS 模块测，SFC 只做薄渲染（延续 `chat-view.ts` 先例）。
- E2E（Playwright-with-Electron）非 M7a 硬性项；skeleton 的端到端契约由 Main 侧集成单测 + 手动冒烟覆盖（写入 RESULTS-M7a）。

---

## 7. 验收
- `app.prefs.getAll/set` + `changed` 全链路单测绿；坏 prefs.json 不崩、降级默认。
- 界面主题在 settings 改 → 落盘 + 跨 renderer 即时换肤 + 顶栏 `✓ 已保存`；重启后保持。
- Hub 壳按 §3.3 尺寸渲染，导航可切（内容多为占位）；玻璃组件按 §2 token 呈现。
- desktop 既有 226 测试不回归；typecheck + prettier 干净。
- 收尾按 [里程碑收尾清单] 出 RESULTS-M7a + CLAUDE.md 状态行。

## 8. 遗留 / 衔接
- M7b：D2/D3/D4/D6/D8 五屏接入（往 effects + nav-tree + pages 加），C1–C4 引导，总览页卡片，顶栏搜索。
- `character.setScale`（当前不落盘）在 M7b 收编进 `display.characterScale` 的 effect。
