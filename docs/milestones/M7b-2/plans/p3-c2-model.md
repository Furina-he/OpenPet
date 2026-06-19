# M7b-2 P3 C2 LLM 配置 + 抽 ProviderConfigPanel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans（或 subagent-driven-development）逐 task 实现。步骤用 `- [ ]`。

**Goal:** 把 D3（ModelApiPage）的 provider-config 核心抽成自包含可复用组件 `ProviderConfigPanel.vue`，D3 改用不回归；再用它实现 C2 LLM 配置步骤（两路径 + 隐私条 + 跳过演示）。

**Architecture:** 自包含组件——`ProviderConfigPanel.vue` 自持 provider 状态 + `provider.*`/`app.prefs.set` RPC，对外仅 `@saved`（写偏好后宿主弹 toast）+ `@ollama-detected`（把检测到的本地模型回传，供 D3 离线兜底 select）。纯展示/计算逻辑下沉 `provider-config-view.ts`（TDD 锚点）。D3 行为靠 typecheck + 既有 `provider-status`/`key-reveal` 纯逻辑测 + 视觉对照守护，不引入 @vue/test-utils。

**Tech Stack:** Vue 3 `<script setup>`、TS strict、`@desksoul/protocol`（getDialect/Prefs）、Vitest。

**关联 spec:** [`../spec.md`](../spec.md)（§7 **P3**；§2.3 C2 复用 D3、§7.2 两路径 + 演示降级）。**前置：P1/P2 已落**（引导壳 + Step2Model 占位已被 App 路由）。

**测试运行：** desktop `pnpm --filter @desksoul/desktop exec vitest run test/<f>.test.ts`；typecheck `pnpm --filter @desksoul/desktop typecheck`；dev 视觉 `…/onboarding/index.html?step=model` 与 `…/settings/index.html?page=model`。每 task 末提交。

---

## 文件结构
- 新 `apps/desktop/src/renderer/settings/provider-config-view.ts`（纯：buildRows/modelsFor/activeModelValue）
- 新 `apps/desktop/src/renderer/components/ProviderConfigPanel.vue`（自包含两栏 provider 配置）
- 改 `apps/desktop/src/renderer/settings/pages/ModelApiPage.vue`（两栏块 → `<ProviderConfigPanel>`；保留预算/离线段）
- 改 `apps/desktop/src/renderer/onboarding/steps/Step2Model.vue`（占位 → C2 实页）
- 测试：`apps/desktop/test/provider-config-view.test.ts`(新)

---

## Task 1: 纯视图逻辑 `provider-config-view.ts`

**Files:** Create `apps/desktop/src/renderer/settings/provider-config-view.ts`；Test `apps/desktop/test/provider-config-view.test.ts`

> 把 ModelApiPage 内联的 `modelsFor`/`rows`/`activeModelValue` 计算抽成纯函数，给 ProviderConfigPanel 复用并单测。

- [ ] **Step 1: 写失败测试**

```ts
// apps/desktop/test/provider-config-view.test.ts
import { describe, it, expect } from 'vitest';
import {
  modelsFor,
  buildRows,
  activeModelValue,
  type ProviderRow,
} from '../src/renderer/settings/provider-config-view';

const PROVIDERS: ProviderRow[] = [
  { id: 'openai', name: 'OpenAI', kind: 'chat', hasKey: true, enabled: true, models: ['gpt-4o', 'gpt-4o-mini'] },
  { id: 'ollama', name: 'Ollama', kind: 'chat', hasKey: false, enabled: true, models: [] },
];

describe('provider-config-view（纯）', () => {
  it('modelsFor：ollama 有检测结果时用检测列表，否则用 provider.models', () => {
    expect(modelsFor(PROVIDERS, [], 'openai')).toEqual(['gpt-4o', 'gpt-4o-mini']);
    expect(modelsFor(PROVIDERS, ['llama3', 'qwen2'], 'ollama')).toEqual(['llama3', 'qwen2']);
    expect(modelsFor(PROVIDERS, [], 'ollama')).toEqual([]);
  });
  it('buildRows：当前 provider 用已选 activeModel，余用各自首个模型', () => {
    const rows = buildRows(PROVIDERS, 'openai', 'gpt-4o-mini', [], { openai: false });
    expect(rows[0]).toEqual({
      id: 'openai',
      name: 'OpenAI',
      model: 'gpt-4o-mini',
      hasKey: true,
      lastTestOk: false,
    });
    expect(rows[1]!.model).toBe(''); // ollama 无模型
    expect(rows[1]!.lastTestOk).toBeNull(); // 未测
  });
  it('activeModelValue：已选模型属当前列表则用它，否则回退首个', () => {
    expect(activeModelValue(['gpt-4o', 'gpt-4o-mini'], 'gpt-4o-mini')).toBe('gpt-4o-mini');
    expect(activeModelValue(['gpt-4o'], 'nonexistent')).toBe('gpt-4o');
    expect(activeModelValue([], 'x')).toBe('');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @desksoul/desktop exec vitest run test/provider-config-view.test.ts`
Expected: FAIL — cannot find module provider-config-view。

- [ ] **Step 3: 实现**

```ts
// apps/desktop/src/renderer/settings/provider-config-view.ts
/** D3/C2 provider 配置的纯视图计算（无 Vue 依赖，便于单测）。 */

export interface ProviderRow {
  id: string;
  name: string;
  kind: 'chat' | 'embedding';
  hasKey: boolean;
  enabled: boolean;
  models: string[];
}

export interface ListRow {
  id: string;
  name: string;
  model: string;
  hasKey: boolean;
  lastTestOk: boolean | null;
}

/** 某 provider 的可选模型：ollama 有检测结果优先用之，否则用 provider.models。 */
export function modelsFor(
  providers: ProviderRow[],
  ollamaModels: string[],
  id: string,
): string[] {
  if (id === 'ollama' && ollamaModels.length) return ollamaModels;
  return providers.find((p) => p.id === id)?.models ?? [];
}

/** 左栏列表行：当前 provider 显示已选 activeModel，其余显示各自首个模型。 */
export function buildRows(
  providers: ProviderRow[],
  activeId: string,
  activeModel: string,
  ollamaModels: string[],
  testOk: Record<string, boolean | null>,
): ListRow[] {
  return providers.map((p) => ({
    id: p.id,
    name: p.name,
    model:
      p.id === activeId && activeModel ? activeModel : (modelsFor(providers, ollamaModels, p.id)[0] ?? ''),
    hasKey: p.hasKey,
    lastTestOk: testOk[p.id] ?? null,
  }));
}

/** 默认模型下拉显示值：已选模型属当前列表则用它，否则回退首个（= worker 缺省 defaultModels[0]）。 */
export function activeModelValue(activeModels: string[], savedModel: string): string {
  return savedModel && activeModels.includes(savedModel) ? savedModel : (activeModels[0] ?? '');
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @desksoul/desktop exec vitest run test/provider-config-view.test.ts`
Expected: PASS (3)

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/renderer/settings/provider-config-view.ts apps/desktop/test/provider-config-view.test.ts
git commit -m "feat(settings): extract pure provider-config-view helpers (buildRows/modelsFor/activeModelValue)"
```

---

## Task 2: 自包含组件 `ProviderConfigPanel.vue` + D3 改用

**Files:** Create `apps/desktop/src/renderer/components/ProviderConfigPanel.vue`；Modify `apps/desktop/src/renderer/settings/pages/ModelApiPage.vue`

- [ ] **Step 1: 实现 ProviderConfigPanel（自持状态 + RPC，复用纯助手）**

```vue
<!-- apps/desktop/src/renderer/components/ProviderConfigPanel.vue
     D3/C2 共用：左栏 Providers+状态点 / 右栏 Key·Endpoint·默认模型·测试连接。
     自持 provider 状态 + provider.*/app.prefs.set RPC + Ollama 检测。
     @saved：写偏好/Key 后宿主弹 toast；@ollama-detected：回传检测到的本地模型。 -->
<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import type { Prefs } from '@desksoul/protocol';
import { DEFAULT_PREFS, getDialect } from '@desksoul/protocol';
import ProviderList from './ProviderList.vue';
import KeyInput from './KeyInput.vue';
import Select from './Select.vue';
import {
  modelsFor as modelsForView,
  buildRows,
  activeModelValue as activeModelValueView,
  type ProviderRow,
} from '../settings/provider-config-view';

const emit = defineEmits<{ saved: []; 'ollama-detected': [models: string[]] }>();

const prefs = ref<Prefs>({ ...DEFAULT_PREFS });
const providers = ref<ProviderRow[]>([]);
const testOk = ref<Record<string, boolean | null>>({});
const ollamaModels = ref<string[]>([]);
const testMsg = ref('');

const FORMAT_LABEL: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Gemini',
  ollama: 'Ollama',
};

const activeId = computed(
  () => prefs.value['model.activeProvider'] || providers.value[0]?.id || '',
);
const modelsFor = (id: string): string[] => modelsForView(providers.value, ollamaModels.value, id);
const rows = computed(() =>
  buildRows(
    providers.value,
    activeId.value,
    prefs.value['model.activeModel'],
    ollamaModels.value,
    testOk.value,
  ),
);
const activeP = computed(() => providers.value.find((p) => p.id === activeId.value));
const activeDialect = computed(() => getDialect(activeId.value));
const activeFormatLabel = computed(() => {
  const f = activeDialect.value?.format;
  const label = f ? (FORMAT_LABEL[f] ?? f) : '';
  return label && label !== activeP.value?.name ? label : '';
});
const activeModels = computed(() => modelsFor(activeId.value));
const modelOptions = computed(() => activeModels.value.map((m) => ({ value: m, label: m })));
const activeModelValue = computed(() =>
  activeModelValueView(activeModels.value, prefs.value['model.activeModel']),
);

async function refreshProviders(): Promise<void> {
  const res = (await window.desksoul.rpc('provider.listProviders', {})) as {
    providers: ProviderRow[];
  };
  providers.value = res.providers;
}

onMounted(async () => {
  prefs.value = (await window.desksoul.rpc('app.prefs.getAll', {})) as Prefs;
  await refreshProviders();
  if (providers.value.some((p) => p.id === 'ollama')) {
    const det = (await window.desksoul.rpc('provider.ollamaDetect', {})) as {
      available: boolean;
      models: string[];
    };
    ollamaModels.value = det.models;
    emit('ollama-detected', det.models);
  }
});

async function setPref(key: 'model.activeProvider' | 'model.activeModel', value: string): Promise<void> {
  prefs.value = { ...prefs.value, [key]: value };
  await window.desksoul.rpc('app.prefs.set', { key, value });
  emit('saved');
}
function onSelect(id: string): void {
  testMsg.value = '';
  void setPref('model.activeProvider', id);
}
async function saveKey(id: string, key: string): Promise<void> {
  await window.desksoul.rpc('provider.saveKey', { providerId: id, key });
  testOk.value = { ...testOk.value, [id]: null };
  testMsg.value = '';
  await refreshProviders();
  emit('saved');
}
async function clearKey(id: string): Promise<void> {
  await window.desksoul.rpc('provider.deleteKey', { providerId: id });
  testOk.value = { ...testOk.value, [id]: null };
  testMsg.value = '';
  await refreshProviders();
  emit('saved');
}
async function testConnection(): Promise<void> {
  const id = activeId.value;
  if (!id) return;
  testMsg.value = '测试中…';
  const res = (await window.desksoul.rpc('provider.testConnection', { providerId: id })) as {
    ok: boolean;
    errorKind?: string;
    detail?: string;
  };
  testOk.value = { ...testOk.value, [id]: res.ok };
  testMsg.value = res.ok ? '✓ 连接成功' : `✗ 连接失败（${res.errorKind ?? 'error'}）`;
}
</script>

<template>
  <div class="flex gap-4">
    <section class="ds-glass w-[240px] shrink-0 rounded-card p-3">
      <header class="mb-2 px-1 text-sm text-text-sub">Providers</header>
      <ProviderList :rows="rows" :active-id="activeId" @select="onSelect" />
    </section>

    <section class="ds-glass min-w-0 flex-1 rounded-card p-4">
      <template v-if="activeP">
        <div class="text-md text-text-main">
          {{ activeP.name }}
          <span v-if="activeFormatLabel" class="text-text-sub">· {{ activeFormatLabel }}</span>
        </div>
        <div class="my-3 border-t border-glass-border"></div>

        <div class="mb-1 text-sm text-text-sub">API Key</div>
        <KeyInput
          :key="activeId"
          :has-key="activeP.hasKey"
          @save="(k: string) => saveKey(activeId, k)"
          @clear="clearKey(activeId)"
        />

        <div class="mb-1 mt-4 text-sm text-text-sub">Endpoint</div>
        <div
          class="rounded-input border border-glass-border px-3 py-2 text-base text-text-sub"
          :title="'默认端点（自定义留后续）'"
        >
          {{ activeDialect?.baseUrl }}
        </div>

        <div class="mb-1 mt-4 text-sm text-text-sub">默认模型</div>
        <Select
          :model-value="activeModelValue"
          :options="modelOptions"
          @update:model-value="(v: string) => setPref('model.activeModel', v)"
        />

        <div class="mt-5 flex items-center gap-3">
          <button
            class="rounded-btn px-4 py-2 text-sm text-white"
            style="background: linear-gradient(90deg, var(--ds-brand-from), var(--ds-brand-to))"
            @click="testConnection"
          >
            测试连接
          </button>
          <span v-if="testMsg" class="text-sm text-text-sub">{{ testMsg }}</span>
        </div>
      </template>
      <div v-else class="text-text-sub">选择左侧 Provider 进行配置</div>
    </section>
  </div>
</template>
```

- [ ] **Step 2: 重构 ModelApiPage 改用组件（保留预算/离线段）**

整体替换 `apps/desktop/src/renderer/settings/pages/ModelApiPage.vue`：

```vue
<!-- settings/pages/ModelApiPage.vue — D3 模型 API（ui-design §7.3；参照 36b542fb + §2 token）
     provider-config 主体抽到 ProviderConfigPanel（C2 复用）。
     存而不接（渲染+持久，无 live 行为）：预算告警卡、离线兜底卡。 -->
<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import type { Prefs, PrefKey } from '@desksoul/protocol';
import { DEFAULT_PREFS } from '@desksoul/protocol';
import SettingSection from '../../components/SettingSection.vue';
import SettingCard from '../../components/SettingCard.vue';
import Switch from '../../components/Switch.vue';
import Select from '../../components/Select.vue';
import Slider from '../../components/Slider.vue';
import Input from '../../components/Input.vue';
import ProviderConfigPanel from '../../components/ProviderConfigPanel.vue';

const emit = defineEmits<{ saved: [] }>();

const prefs = ref<Prefs>({ ...DEFAULT_PREFS });
const ollamaModels = ref<string[]>([]); // 由 ProviderConfigPanel 的 @ollama-detected 回传

const EXCEED = [
  { value: 'warn', label: '提醒' },
  { value: 'pause', label: '提醒并暂停' },
];
const FALLBACK = [
  { value: 'ollama', label: '切换到本地模型 (Ollama)' },
  { value: 'demo', label: '使用预设台词（演示模式）' },
  { value: 'error', label: '直接报错让我手动处理' },
];
const ollamaOptions = computed(() => {
  const names = new Set(ollamaModels.value);
  if (prefs.value['offline.ollamaModel']) names.add(prefs.value['offline.ollamaModel']);
  const arr = [...names];
  return arr.length
    ? arr.map((m) => ({ value: m, label: m }))
    : [{ value: '', label: '（未检测到本地模型）' }];
});

onMounted(async () => {
  prefs.value = (await window.desksoul.rpc('app.prefs.getAll', {})) as Prefs;
});

async function set<K extends PrefKey>(key: K, value: Prefs[K]): Promise<void> {
  prefs.value = { ...prefs.value, [key]: value };
  await window.desksoul.rpc('app.prefs.set', { key, value });
  emit('saved');
}
function onOllama(models: string[]): void {
  ollamaModels.value = models;
}
</script>

<template>
  <div class="max-w-[840px]">
    <ProviderConfigPanel class="mb-4" @saved="emit('saved')" @ollama-detected="onOllama" />

    <SettingSection title="预算与告警">
      <SettingCard label="启用预算告警">
        <Switch
          :model-value="prefs['budget.enabled']"
          @update:model-value="(v) => set('budget.enabled', v)"
        />
      </SettingCard>
      <SettingCard label="本月预算上限" description="¥ / 月">
        <Input
          :model-value="String(prefs['budget.monthlyCap'])"
          @update:model-value="(v) => set('budget.monthlyCap', Math.max(0, Number(v) || 0))"
        />
      </SettingCard>
      <SettingCard label="已使用" description="本期暂无用量计量源">
        <span class="text-base text-text-sub">¥0.00 / —</span>
      </SettingCard>
      <SettingCard label="告警阈值" :description="`达到 ${prefs['budget.warnAt']}% 时提醒`">
        <Slider
          :model-value="prefs['budget.warnAt']"
          :min="0"
          :max="100"
          min-label="0%"
          max-label="100%"
          @update:model-value="(v) => set('budget.warnAt', v)"
        />
      </SettingCard>
      <SettingCard label="达到上限时">
        <Select
          :model-value="prefs['budget.onExceed']"
          :options="EXCEED"
          @update:model-value="(v) => set('budget.onExceed', v as Prefs['budget.onExceed'])"
        />
      </SettingCard>
    </SettingSection>

    <SettingSection title="离线兜底">
      <SettingCard label="当所有 Provider 不可用时">
        <Select
          :model-value="prefs['offline.fallbackMode']"
          :options="FALLBACK"
          @update:model-value="(v) => set('offline.fallbackMode', v as Prefs['offline.fallbackMode'])"
        />
      </SettingCard>
      <SettingCard label="Ollama 备用模型" indent>
        <Select
          :model-value="prefs['offline.ollamaModel']"
          :options="ollamaOptions"
          @update:model-value="(v) => set('offline.ollamaModel', v)"
        />
      </SettingCard>
    </SettingSection>
  </div>
</template>
```

- [ ] **Step 3: typecheck + 全量回归 + 视觉对照（D3 不回归）**

Run:
```bash
pnpm --filter @desksoul/desktop typecheck
pnpm --filter @desksoul/desktop test
pnpm exec prettier --write apps/desktop/src/renderer/components/ProviderConfigPanel.vue apps/desktop/src/renderer/settings/pages/ModelApiPage.vue
```
Expected: typecheck 干净；desktop 全量绿（`provider-status`/`key-reveal`/`provider-config-view` 用例覆盖核心逻辑）。然后 `pnpm --filter @desksoul/desktop dev` 开 `…/settings/index.html?page=model`，对照 `UI/36b542fb`（D3 区）确认两栏 + Key + 默认模型 + 测试连接 + 预算/离线段与重构前一致。

- [ ] **Step 4: 提交**

```bash
git add apps/desktop/src/renderer/components/ProviderConfigPanel.vue apps/desktop/src/renderer/settings/pages/ModelApiPage.vue
git commit -m "refactor(settings): extract self-contained ProviderConfigPanel; D3 ModelApiPage uses it"
```

---

## Task 3: C2 LLM 配置实页 Step2Model

**Files:** Modify `apps/desktop/src/renderer/onboarding/steps/Step2Model.vue`（替换 P2 占位）

- [ ] **Step 1: 实现 C2（两路径提示 + ProviderConfigPanel + 隐私条 + 跳过演示）**

```vue
<!-- apps/desktop/src/renderer/onboarding/steps/Step2Model.vue — C2 LLM 配置（ui-design §7.2；视觉 d63b4f97 C2 区）
     复用 ProviderConfigPanel（API Key / Ollama 两路径都在其中）。跳过演示 → emit('skip')（App 照常进 C3，
     无 active provider 时 C4 自动走 demo 空链）。 -->
<script setup lang="ts">
import ProviderConfigPanel from '../../components/ProviderConfigPanel.vue';

const emit = defineEmits<{ next: []; skip: [] }>();
</script>
<template>
  <div class="flex h-full flex-col">
    <div class="min-h-0 flex-1 overflow-y-auto">
      <div class="text-md text-text-main">连接一个大脑</div>
      <p class="mt-1 text-base text-text-sub">
        🔑 填 API Key（OpenAI / Claude / Gemini / 通义 / DeepSeek / 自定义），或 💻 选本地 Ollama。
      </p>

      <ProviderConfigPanel class="mt-4" />

      <div class="mt-4 rounded-card border border-glass-border p-3 text-sm text-text-sub">
        🔒 你的 API Key 仅本地加密存储，不会上传任何服务器。
      </div>
    </div>

    <div class="mt-5 flex items-center justify-between">
      <button class="text-sm text-text-sub hover:text-text-main" @click="emit('skip')">
        暂时跳过 · 先和角色玩一下
      </button>
      <button
        class="rounded-btn px-5 py-2 text-base text-white"
        style="background: linear-gradient(90deg, var(--ds-brand-from), var(--ds-brand-to))"
        @click="emit('next')"
      >
        下一步 →
      </button>
    </div>
  </div>
</template>
```

- [ ] **Step 2: typecheck + 视觉自检**

Run:
```bash
pnpm --filter @desksoul/desktop typecheck
pnpm exec prettier --write apps/desktop/src/renderer/onboarding/steps/Step2Model.vue
```
Expected: typecheck 干净。`pnpm --filter @desksoul/desktop dev` 开 `…/onboarding/index.html?step=model`，对照 `UI/d63b4f97`（C2 区）确认两路径提示 + provider 配置 + 隐私条 + 跳过/下一步（精修留 P4 保真 pass）。

- [ ] **Step 3: 提交**

```bash
git add apps/desktop/src/renderer/onboarding/steps/Step2Model.vue
git commit -m "feat(onboarding): C2 LLM config step (reuses ProviderConfigPanel + privacy bar + skip)"
```

---

## Self-Review（plan vs spec P3）
- **spec §2.3 抽 ProviderConfigPanel + D3 复用不回归**：T2 自包含组件 + ModelApiPage 改用（保留预算/离线，ollamaModels 经 `@ollama-detected` 回传保持离线 select 行为）✓。
- **spec §7.2 C2 两路径 + 隐私条 + 跳过演示**：T3 提示两路径（API Key/Ollama 都在 panel）+ 隐私条 + `暂时跳过` ✓。
- **TDD 锚点**：T1 `provider-config-view` 纯函数覆盖 buildRows/modelsFor/activeModelValue（原 ModelApiPage 内联逻辑）✓。
- **占位符**：无 TBD；组件/页面均完整 SFC + 命令 + 预期。
- **类型一致**：`ProviderRow`/`ListRow`/`modelsFor`/`buildRows`/`activeModelValue`(T1) ↔ ProviderConfigPanel import(T2) 一致；ProviderConfigPanel emits `saved`/`ollama-detected`(T2) ↔ ModelApiPage 监听 `@saved`/`@ollama-detected="onOllama"`(T2 Step2) 与 Step2Model（仅嵌入，不监听）一致；`prefs.set` key `'model.activeProvider'|'model.activeModel'`(T2) 属既有 PrefKey ✓。
- **回归点（重点）**：ModelApiPage 的 provider 主体行为全部迁入组件——左栏状态点（ProviderList+providerDot 不变）、Key（KeyInput 不变）、默认模型、测试连接、Ollama 检测均保留；离线 `ollamaOptions` 改由组件 emit 喂（等价于原 onMounted 本地 detect）。`provider-status`/`key-reveal` 既有测试不动且继续绿。D3 视觉对照 `36b542fb` 守护。
- **依赖顺序**：T1（纯助手）→ T2（组件用助手 + D3 改用）→ T3（C2 用组件）。
