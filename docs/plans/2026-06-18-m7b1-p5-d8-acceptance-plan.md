# M7b-1 P5 · D8 关于 + D3 视觉 polish + 真 Electron 验收 + 收尾 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: 用 `superpowers:executing-plans` 逐 task 推进（**inline**，勿派 subagent——429 限流，[[project-subagent-inline]]）。Steps 用 `- [ ]` 复选框。本阶段含**代码 task + 人工验收 task**，人工 task 给清单非代码。

**Goal:** 落地 D8 关于面板（外链经 `app.openExternal`）+ D3 两处视觉 polish（PM 裁决），完成 M7b-1 的**真 Electron GUI 冒烟 + 真 Key→听到回复端到端**（§6 硬门槛），定稿 RESULTS 并打 tag `mvp/M7b1-done`。

**Architecture:** D8 纯展示 + 外链（`app.openExternal` P1 已就绪，仅放行 http/https）；版本信息从常量/`package.json`。D3 polish 是样式微调（状态点改语义绿 + 标题去冗余）。真 Electron 验收前**必先 `electron-rebuild`** 解 `better-sqlite3` ABI（[[p5-electron-gui-smoke-blocker]]）。

**Tech Stack:** Vue 3 SFC + Tailwind + 设计 token；`app.openExternal` RPC；Playwright MCP 视觉闭环；真 Electron `dev` 目视。

**视觉真源:** D8 专属高保真图 = `UI/7075fa1f-2e1d-49e4-ad59-1881a0191a98.png`（右半=D8 关于；左半=D6 隐私）+ ui-design §8.8 契约 + §2 token。（ui-design v0.2 已确认 43 屏全有专属图。）

---

## 范围与边界

**做实**：D8 版本卡（版本/构建/slogan）+ 致谢 + 帮助 + 法律各区的**外链按钮**（`app.openExternal`）；D3 状态点绿 + 标题去冗余；真 Electron 冒烟 + 真 Key 端到端。

**存而不接**（按钮在、disabled 或点击 toast「留后续」）：`[检查更新]`（无 updater 后端）、`[生成 .dsdiag]` 诊断包（无脱敏日志/系统信息聚合后端）。

**留后续**：D8 七连击开发者模式彩蛋（§ line 1281）；诊断包真实生成；自动更新器。外链 URL 用占位常量（上线前替换，plan 内标注）。

---

## 文件结构
- 改 `apps/desktop/src/renderer/settings/provider-status.ts`（DOT_COLOR.ok 改色）
- 改 `apps/desktop/src/renderer/settings/pages/ModelApiPage.vue`（标题去冗余）
- 新 `apps/desktop/src/renderer/settings/pages/AboutPage.vue`（D8）
- 改 `apps/desktop/src/renderer/settings/App.vue`（接 `system.about`→AboutPage）
- 改 `apps/desktop/RESULTS-M7b1.md`（P5 段 + 全里程碑定稿）

---

## Task 0: 环境前置（非代码，必先做）

- [ ] **Step 1: electron-rebuild** — `pnpm --filter @desksoul/desktop exec electron-rebuild -f -w better-sqlite3`（装包走 npmmirror，[[project_env_network]]）。
- [ ] **Step 2: 验证不降级** — `pnpm --filter @desksoul/desktop dev`，确认主进程**不再**打印 `better-sqlite3 unavailable, falling back to in-memory`。若仍报 ABI，记录 Node/Electron 版本回 PM。

> 这是 Task 4/5 真窗验收的前置；Task 1–3 是 renderer，不依赖它。

---

## Task 1: D3 视觉 polish（PM 裁决落地）

**Files:** Modify `settings/provider-status.ts`、`settings/pages/ModelApiPage.vue`

- [ ] **Step 1: 状态点 ok 改语义绿** — `provider-status.ts` 的 `DOT_COLOR`：

```ts
/** 点色 → CSS 变量（绿=可用用 success，红=失败用 danger，灰=待填用 sub）。 */
export const DOT_COLOR: Record<ProviderDot, string> = {
  ok: 'var(--ds-success)',
  fail: 'var(--ds-danger)',
  pending: 'var(--ds-text-sub)',
};
```

> 依据：D3 专属图 `UI/36b542fb…`（状态点为绿）+ §2 约定「暖色用于品牌、冷色/语义色仅用于状态」。`providerDot` 逻辑与其 3 测不变（颜色是常量，无需改测）。先确认 `--ds-success`(#7fe3a1) 在 `theme/tokens.css` 浅/深都有定义；若缺则补 token。

- [ ] **Step 2: provider 标题去冗余** — `ModelApiPage.vue` 的 `activeFormatLabel` computed：`name` 与格式标签相同时返回空，模板按需隐藏。

```ts
const activeFormatLabel = computed(() => {
  const f = activeDialect.value?.format;
  const label = f ? (FORMAT_LABEL[f] ?? f) : '';
  return label && label !== activeP.value?.name ? label : '';
});
```

模板（标题行）：`· {{ activeFormatLabel }}` 外层加 `v-if="activeFormatLabel"`：

```vue
          <div class="text-md text-text-main">
            {{ activeP.name }}
            <span v-if="activeFormatLabel" class="text-text-sub">· {{ activeFormatLabel }}</span>
          </div>
```

- [ ] **Step 3: typecheck + 提交** — `pnpm --filter @desksoul/desktop typecheck` 干净；`git commit -m "fix(desktop): D3 status dot uses success-green + dedupe provider title (PM review)"`

---

## Task 2: D8 AboutPage（ui-design §8.8）

**Files:** Create `settings/pages/AboutPage.vue`；Modify `settings/App.vue`

- [ ] **Step 1: AboutPage.vue** — 五区（版本/致谢/帮助/法律/诊断），外链经 `app.openExternal`，检查更新 + 诊断包存而不接

```vue
<!-- settings/pages/AboutPage.vue — D8 关于（ui-design §8.8；视觉参照 UI/7075fa1f 右半 + §2 token）
     做实：版本信息 + 致谢 + 帮助/法律外链（app.openExternal）。
     存而不接：[检查更新]（无 updater）/[生成 .dsdiag]（无诊断聚合后端）。
     URL 为占位，上线前替换。 -->
<script setup lang="ts">
import SettingSection from '../../components/SettingSection.vue';

const VERSION = '0.1.0';
const BUILD = 'Beta · 构建于 2026-04-30';
// 占位 URL（上线前替换为真实站点）
const LINKS = {
  site: 'https://desksoul.app',
  github: 'https://github.com/desksoul/desksoul',
  community: 'https://desksoul.app/community',
  manual: 'https://desksoul.app/docs',
  issues: 'https://github.com/desksoul/desksoul/issues',
  license: 'https://github.com/desksoul/desksoul/blob/main/LICENSE',
  terms: 'https://desksoul.app/terms',
  privacy: 'https://desksoul.app/privacy',
};
const ACK = ['three-vrm', 'pixi-live2d-display', 'XState', 'better-sqlite3', 'Lucide', 'Vue'];

function open(url: string): void {
  void window.desksoul.rpc('app.openExternal', { url });
}
</script>

<template>
  <div class="max-w-[640px]">
    <SettingSection title="DeskSoul">
      <div class="px-4 py-3">
        <div class="text-lg text-text-main">DeskSoul</div>
        <div class="text-sm text-text-sub">v{{ VERSION }} · {{ BUILD }}</div>
        <div class="mt-1 text-base text-text-sub">一个会被你看见的 AI 灵魂体</div>
        <div class="mt-3 flex flex-wrap gap-2">
          <button class="rounded-btn px-3 py-1.5 text-sm text-text-sub" disabled title="暂未接入更新器">
            检查更新
          </button>
          <button class="rounded-btn px-3 py-1.5 text-sm text-text-main" @click="open(LINKS.site)">
            打开官网
          </button>
          <button class="rounded-btn px-3 py-1.5 text-sm text-text-main" @click="open(LINKS.github)">
            GitHub
          </button>
          <button class="rounded-btn px-3 py-1.5 text-sm text-text-main" @click="open(LINKS.community)">
            社区
          </button>
        </div>
      </div>
    </SettingSection>

    <SettingSection title="致谢">
      <div class="px-4 py-3 text-base text-text-sub">
        本产品基于以下开源项目：{{ ACK.join(' · ') }}
        <button class="ml-2 text-text-main underline" @click="open(LINKS.license)">完整开源许可证</button>
      </div>
    </SettingSection>

    <SettingSection title="反馈与帮助">
      <div class="flex flex-wrap gap-2 px-4 py-3">
        <button class="rounded-btn px-3 py-1.5 text-sm text-text-main" @click="open(LINKS.manual)">📖 用户手册</button>
        <button class="rounded-btn px-3 py-1.5 text-sm text-text-main" @click="open(LINKS.issues)">🐛 报告问题</button>
        <button class="rounded-btn px-3 py-1.5 text-sm text-text-main" @click="open(LINKS.community)">💬 社区交流</button>
      </div>
    </SettingSection>

    <SettingSection title="诊断">
      <div class="px-4 py-3 text-base text-text-sub">
        <button class="rounded-btn px-3 py-1.5 text-sm text-text-sub" disabled title="诊断包生成留后续">
          生成 .dsdiag
        </button>
        <span class="ml-2 text-sm">含脱敏日志 + 系统信息 + 配置摘要（自动剔除 Key / 对话）—— 留后续</span>
      </div>
    </SettingSection>

    <SettingSection title="法律">
      <div class="flex flex-wrap gap-2 px-4 py-3">
        <button class="rounded-btn px-3 py-1.5 text-sm text-text-main" @click="open(LINKS.terms)">服务条款</button>
        <button class="rounded-btn px-3 py-1.5 text-sm text-text-main" @click="open(LINKS.privacy)">隐私政策</button>
        <button class="rounded-btn px-3 py-1.5 text-sm text-text-main" @click="open(LINKS.license)">开源许可证 (MIT)</button>
      </div>
    </SettingSection>
  </div>
</template>
```

- [ ] **Step 2: App.vue 接入** — import + 分支（在占位 `v-else` 前）：

```ts
import AboutPage from './pages/AboutPage.vue';
```
```vue
        <AboutPage v-else-if="active === 'system.about'" @saved="saved" />
```

> AboutPage 无 `saved` 触发（纯展示/外链），`@saved` 仅为与其它页统一签名；不绑则去掉 emit。若 typecheck 抱怨未用 emit，AboutPage 不声明 emit、App.vue 去掉 `@saved`。

- [ ] **Step 3: typecheck + 提交** — typecheck 干净；`git commit -m "feat(desktop): D8 about panel with external links (§7.8)"`

---

## Task 3: D8 视觉闭环

- [ ] **Step 1: 截图比对** — `pnpm --filter @desksoul/desktop dev` → Playwright MCP `?page=system.about` 浅/深 1080×720 → `Read` 比对 **`UI/7075fa1f…`（右半 D8）** + ui-design §8.8（版本卡/致谢/帮助/诊断/法律分区，玻璃卡 + 外链按钮）+ §2 token。偏差修正重截。
- [ ] **Step 2: 提交**（如有样式修正）— `git commit -m "style(desktop): D8 about visual pass"`（无修正则跳过）

---

## Task 4: 真 Electron GUI 冒烟（人工，§6 硬门槛）

> 前置：Task 0 完成（electron-rebuild）。在真 Electron 窗逐屏对照设计图目视，**非"能显示就行"**。偏差立 polish task。

- [ ] `pnpm --filter @desksoul/desktop dev` 起真 Electron（确认不降级 in-memory）。
- [ ] 打开 Hub（`Ctrl+Shift+,` 或 overlay ⚙）→ 左导航各组 + 空组可点。 ☐
- [ ] 逐屏对照**各屏专属图**：D2=`774644b7`(右半) / D3+D4=`36b542fb` / D6=`7075fa1f`(左半) / D8=`7075fa1f`(右半)。玻璃/分组卡/暖色开关/状态点绿/滑块翼标。 ☐
- [ ] 主题：切深色 → Hub + overlay 同步换肤 + `✓ 已保存`；重启 app → 保持。 ☐
- [ ] D4 缩放：拖 slider → 角色实时缩放；松手持久；重启保持。置顶/穿透即时。 ☐
- [ ] D6 高风险二次确认：截屏/摄像头 off→on → 红描边 ConfirmDialog；确认才 ON、取消回退。 ☐
- [ ] D8 外链：点[GitHub]等 → 系统浏览器打开对应 URL。 ☐
- [ ] 偏差清单回填 RESULTS；任何偏差立 polish。

---

## Task 5: 真 Key → 听到回复 端到端（人工，90s 旅程）

> 验「配 Key→听到回复」核心验收（spec 目标）。

- [ ] D3 选一个真实可用 provider（如 `claude`/`openai`/`deepseek`）→ 填**真实 API Key**（`provider.saveKey`→Keychain）。
- [ ] `[测试连接]` → 绿点 / ✓ 连接成功。
- [ ] 选默认模型（或留空靠 worker 默认）。
- [ ] overlay 发一条消息 → 确认走**该 provider + model** 出**流式**回复（表情/动作双轨随文本流）。
- [ ] 记录实测 provider+model + 截图/要点回填 RESULTS；失败则记录 errorKind 回 PM。

---

## Task 6: 全量验收 + RESULTS 定稿 + tag

- [ ] **Step 1: 全量绿** — `pnpm --filter @desksoul/protocol build && pnpm --filter @desksoul/sidecar build`，then `pnpm -r typecheck`、`pnpm --filter @desksoul/desktop test`（≥273 + D8 若加测）、`pnpm --filter @desksoul/protocol test`（178）、`pnpm --filter @desksoul/desktop build`（electron-vite build exit 0）。
- [ ] **Step 2: RESULTS 定稿** — RESULTS-M7b1.md 追加 P5 段 + **M7b-1 整体收尾小结**（P1–P5 汇总：5 面板 D2/D3/D4/D6/D8 + chat 集成 + Hub 可达 + 视觉 harness；累积测试数；GUI 冒烟 + 真 Key 实测结论；残留总账）。
- [ ] **Step 3: tag** — 提交 RESULTS 后 `git tag mvp/M7b1-done`（[[milestone-results-convention]]）。`git commit -m "docs(m7b1): RESULTS P5 + M7b-1 final"`（tag 在 commit 后）。
- [ ] **Step 4: 回报 PM** — 按交接「报告 7 项」+ GUI 冒烟/真 Key 实测结论 + 残留总账。

---

## Self-Review
- **spec/§8 覆盖**：D8 §8.8 五区（版本/致谢/帮助/诊断/法律）✓；外链 `app.openExternal`（P1 RPC）✓；§6 GUI 冒烟硬门槛（Task 4）✓；spec「配 Key→听到回复」验收（Task 5）✓；D3 PM 裁决 polish（Task 1）✓。
- **存而不接已声明**：检查更新 / 诊断包（Task 2 disabled + 范围段）。
- **placeholder**：Task 1/2 给全代码；URL 为占位常量并标注；人工 task（4/5）给清单。
- **类型**：`open(url)`→`app.openExternal{url}` 与 app-service 签名一致 ✓。

---

## 执行交接
Plan 已存 `docs/plans/2026-06-18-m7b1-p5-d8-acceptance-plan.md`。**`executing-plans` inline 逐 task**。**Task 0（electron-rebuild）是 Task 4/5 真窗验收的前置**——无法 electron-rebuild 或真 Key 时，Task 1–3 + 6 的代码/全量仍可完成，Task 4/5 记录阻塞回 PM（勿假装跑过）。完成打 tag `mvp/M7b1-done`，M7b-1 收官。
