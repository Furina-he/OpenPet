<!-- settings/pages/ModelApiPage.vue — D3 模型 API → Provider 工作台（AstrBot 对齐两层 Source+Model）
     能力 tab + 左 source 列表 + 右 source 配置/models 表 + 新增弹窗；全部经 provider.* RPC。
     存而不接（渲染+持久，无 live 行为）：预算告警卡、离线兜底卡。视觉对照 hifi brief + §2 token。 -->
<script setup lang="ts">
import { onMounted, ref, computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type {
  Prefs,
  PrefKey,
  Capability,
  ProviderSource,
  ModelEntry,
  AdapterTemplate,
  ProviderTemplate,
  ModelCaps,
} from '@openpet/protocol';
import { DEFAULT_PREFS, modelEntryId, generateUniqueSourceId } from '@openpet/protocol';
import Select from '../../components/Select.vue';
import Switch from '../../components/Switch.vue';
import Slider from '../../components/Slider.vue';
import Input from '../../components/Input.vue';
import ProviderSourcesPanel from '../../components/provider/ProviderSourcesPanel.vue';
import ProviderModelsPanel from '../../components/provider/ProviderModelsPanel.vue';
import AddSourceDialog from '../../components/provider/AddSourceDialog.vue';
import ProviderCard from '../../components/provider/ProviderCard.vue';
import ProviderEditDialog from '../../components/provider/ProviderEditDialog.vue';
import {
  CAPABILITY_TABS,
  sourcesForTab,
  modelsForSource,
  defaultPrefKeyFor,
  fetchOutcomeMessage,
} from '../provider-config-view';

const emit = defineEmits<{ saved: [] }>();
const { t } = useI18n();

const prefs = ref<Prefs>({ ...DEFAULT_PREFS });
const sources = ref<ProviderSource[]>([]);
const models = ref<ModelEntry[]>([]);
const templates = ref<AdapterTemplate[]>([]);
const providerTemplates = ref<ProviderTemplate[]>([]);
const activeTab = ref<Capability>('chat');
const activeSourceId = ref('');
const available = ref<string[]>([]);
const testing = ref<Record<string, boolean | null>>({});
const sourceTesting = ref(false);
const sourceTestMsg = ref('');
const fetching = ref(false);
const fetchMsg = ref('');
const adding = ref(false);
const ollamaModels = ref<string[]>([]);
// 非对话：卡片网格 + 编辑弹窗（照 AstrBot）
const isChat = computed(() => activeTab.value === 'chat');
const editOpen = ref(false);
const editMode = ref<'add' | 'edit'>('edit');
const editingSource = ref<ProviderSource | null>(null);
const detecting = ref(false);
const cardTesting = ref<Record<string, boolean>>({});
const cardTestMsg = ref<Record<string, string>>({});

const tabSources = computed(() => sourcesForTab(sources.value, activeTab.value));
const activeSource = computed(
  () => tabSources.value.find((s) => s.id === activeSourceId.value) ?? tabSources.value[0],
);
const activeModels = computed(() =>
  activeSource.value ? modelsForSource(models.value, activeSource.value.id) : [],
);
const defaultModelId = computed(() => prefs.value[defaultPrefKeyFor(activeTab.value)] as string);

async function reloadConfig(): Promise<void> {
  const cfg = await window.openpet.rpc('provider.getConfig', {});
  sources.value = cfg.sources;
  models.value = cfg.models;
  templates.value = cfg.templates;
  providerTemplates.value = cfg.providerTemplates;
  if (!tabSources.value.some((s) => s.id === activeSourceId.value)) {
    activeSourceId.value = tabSources.value[0]?.id ?? '';
  }
}
async function reloadPrefs(): Promise<void> {
  prefs.value = await window.openpet.rpc('app.prefs.getAll', {});
}

/** 深拷成纯对象——Vue 反应式代理(尤其嵌套 config)无法经 IPC 结构化克隆，必须先拆。 */
function plain<T>(o: T): T {
  return JSON.parse(JSON.stringify(o)) as T;
}
function upsert(source: ProviderSource): Promise<unknown> {
  return window.openpet.rpc('provider.upsertSource', { source: plain(source) });
}

onMounted(async () => {
  await reloadPrefs();
  await reloadConfig();
  void detectOllama();
});

watch(activeTab, () => {
  activeSourceId.value = tabSources.value[0]?.id ?? '';
  available.value = [];
  fetchMsg.value = '';
  sourceTestMsg.value = '';
});
function selectSource(id: string): void {
  activeSourceId.value = id;
  available.value = [];
  fetchMsg.value = '';
  sourceTestMsg.value = '';
}

async function detectOllama(): Promise<void> {
  const r = await window.openpet.rpc('provider.ollamaDetect', {});
  ollamaModels.value = r.models;
}

// 新增：从模板卡片建源。对话 → 直接进工作台；非对话 → 打开编辑弹窗（mode add，照 AstrBot）。
function onCreateFromTemplate(source: ProviderSource): void {
  adding.value = false;
  if (source.capability === 'chat') {
    void addSourceChat(source);
  } else {
    editingSource.value = source;
    editMode.value = 'add';
    detectedDim.value = undefined;
    detectMsg.value = '';
    dialogTestMsg.value = '';
    editOpen.value = true;
  }
}
async function addSourceChat(source: ProviderSource): Promise<void> {
  await upsert(source);
  await reloadConfig();
  activeSourceId.value = source.id;
  emit('saved');
}
const detectedDim = ref<number | undefined>(undefined);
const detectMsg = ref('');
const dialogTesting = ref(false);
const dialogTestMsg = ref('');
function openEdit(s: ProviderSource): void {
  editingSource.value = { ...s };
  editMode.value = 'edit';
  detectedDim.value = undefined;
  detectMsg.value = '';
  dialogTestMsg.value = '';
  editOpen.value = true;
}
async function saveProvider(source: ProviderSource): Promise<void> {
  editOpen.value = false;
  await upsert(source);
  await syncSingleModel(source);
  await reloadConfig();
  await reloadPrefs();
  emit('saved');
}
/** 非对话：config.model 作为该源单模型 + 该能力默认（openpet 两层 → AstrBot 单模型 UX）。 */
async function syncSingleModel(source: ProviderSource): Promise<void> {
  const m = typeof source.config?.model === 'string' ? source.config.model.trim() : '';
  if (!m) return;
  const id = modelEntryId(source.id, m);
  await window.openpet.rpc('provider.addModel', {
    entry: { id, sourceId: source.id, model: m, enabled: true, caps: {} },
  });
  await window.openpet.rpc('provider.setDefault', { capability: source.capability, modelId: id });
}
async function copyProvider(s: ProviderSource): Promise<void> {
  const id = generateUniqueSourceId(
    s.id,
    sources.value.map((x) => x.id),
  );
  await upsert({ ...s, id });
  await reloadConfig();
  emit('saved');
}
async function toggleSourceEnabled(s: ProviderSource, enabled: boolean): Promise<void> {
  await upsert({ ...s, enabled });
  await reloadConfig();
  emit('saved');
}
/** 该源下任一已配置模型名（卡片测试在 config.model 缺失时兜底）。 */
function sourceModelName(s: ProviderSource): string {
  return models.value.find((m) => m.sourceId === s.id)?.model ?? '';
}
/** 探测一个**已持久化**的源连接 → 结果文案。embedding 走 embedding 探针(POST)，其余 GET /models。 */
async function probeSource(s: ProviderSource): Promise<string> {
  if (s.capability === 'embedding') {
    const model =
      (typeof s.config?.model === 'string' && s.config.model.trim()) || sourceModelName(s);
    if (!model) return `✗ ${t('settings.model.needEmbeddingModel')}`;
    const r = await window.openpet.rpc('provider.detectEmbeddingDim', { sourceId: s.id, model });
    return r.ok
      ? `✓ ${t('settings.model.connectOkDim', { dim: r.dimensions ?? 0 })}${r.latencyMs !== undefined ? ` ${r.latencyMs}ms` : ''}`
      : `✗ ${r.error ?? t('settings.model.failed')}`;
  }
  const r = await window.openpet.rpc('provider.testSource', { id: s.id });
  return r.ok
    ? `✓ ${t('settings.model.connectOk')}${r.latencyMs !== undefined ? ` (${r.latencyMs}ms)` : ''}`
    : `✗ ${r.error ?? r.errorKind ?? t('settings.model.failed')}`;
}
async function testCard(s: ProviderSource): Promise<void> {
  cardTesting.value = { ...cardTesting.value, [s.id]: true };
  cardTestMsg.value = { ...cardTestMsg.value, [s.id]: '' };
  try {
    cardTestMsg.value = { ...cardTestMsg.value, [s.id]: await probeSource(s) };
  } catch (e) {
    cardTestMsg.value = {
      ...cardTestMsg.value,
      [s.id]: `✗ ${e instanceof Error ? e.message : String(e)}`,
    };
  } finally {
    cardTesting.value = { ...cardTesting.value, [s.id]: false };
  }
}
/** 弹窗内「测试连接」：先存当前表单（含刚填的模型/Key），再探测——所见即所测。 */
async function testFromDialog(source: ProviderSource): Promise<void> {
  dialogTesting.value = true;
  dialogTestMsg.value = '';
  try {
    await upsert(source);
    dialogTestMsg.value = await probeSource(source);
    await reloadConfig();
  } catch (e) {
    dialogTestMsg.value = `✗ ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    dialogTesting.value = false;
  }
}
/** 嵌入维度自动检测：先存源（key 经 fetch 网关注入），再 embed 探针读维度，回填弹窗；失败显式提示。 */
async function autodetectDim(source: ProviderSource): Promise<void> {
  const m = typeof source.config?.model === 'string' ? source.config.model.trim() : '';
  if (!m) {
    detectMsg.value = t('settings.model.needEmbeddingModel');
    return;
  }
  detecting.value = true;
  detectMsg.value = '';
  try {
    await upsert(source);
    const r = await window.openpet.rpc('provider.detectEmbeddingDim', {
      sourceId: source.id,
      model: m,
    });
    if (r.ok && r.dimensions) detectedDim.value = r.dimensions;
    else detectMsg.value = t('settings.model.detectFail', { detail: r.error ?? t('settings.model.unknownError') });
  } catch (e) {
    detectMsg.value = t('settings.model.detectFail', { detail: e instanceof Error ? e.message : String(e) });
  } finally {
    detecting.value = false;
  }
}
async function removeSource(id: string): Promise<void> {
  await window.openpet.rpc('provider.deleteSource', { id });
  await reloadConfig();
  emit('saved');
}
async function saveSource(source: ProviderSource): Promise<void> {
  await upsert(source);
  await reloadConfig();
  emit('saved');
}
async function fetchModels(source: ProviderSource): Promise<void> {
  // 先持久化当前编辑（apiBase + 已保存的 key），再按持久态拉取——否则拉的是旧/空配置。
  await upsert(source);
  await reloadConfig();
  fetching.value = true;
  fetchMsg.value = '';
  try {
    const r = await window.openpet.rpc('provider.fetchModels', { sourceId: source.id });
    available.value = r.models;
    const ok = fetchOutcomeMessage({ count: r.models.length });
    fetchMsg.value = t(ok.key, ok.params);
  } catch (e) {
    available.value = [];
    const bad = fetchOutcomeMessage({ error: e });
    fetchMsg.value = t(bad.key, bad.params);
  } finally {
    fetching.value = false;
  }
  emit('saved');
}
async function addModel(model: string): Promise<void> {
  if (!activeSource.value) return;
  const sid = activeSource.value.id;
  await window.openpet.rpc('provider.addModel', {
    entry: { id: modelEntryId(sid, model), sourceId: sid, model, enabled: true, caps: {} },
  });
  await reloadConfig();
  emit('saved');
}
async function deleteModel(id: string): Promise<void> {
  await window.openpet.rpc('provider.deleteModel', { id });
  await reloadConfig();
  emit('saved');
}
async function toggleModel(p: { id: string; enabled: boolean }): Promise<void> {
  await window.openpet.rpc('provider.setModelEnabled', p);
  await reloadConfig();
  emit('saved');
}
async function updateCaps(p: { id: string; caps: ModelCaps }): Promise<void> {
  await window.openpet.rpc('provider.updateModelCaps', p);
  await reloadConfig();
  emit('saved');
}
async function testModel(id: string): Promise<void> {
  testing.value = { ...testing.value, [id]: null };
  const r = await window.openpet.rpc('provider.testModel', { id });
  testing.value = { ...testing.value, [id]: r.ok };
}
/** 源级「测试连接 / 检测」（照 AstrBot test provider）：先存当前编辑，再探活 base+key。 */
async function testSource(source: ProviderSource): Promise<void> {
  await upsert(source);
  await reloadConfig();
  sourceTesting.value = true;
  sourceTestMsg.value = '';
  try {
    const r = await window.openpet.rpc('provider.testSource', { id: source.id });
    sourceTestMsg.value = r.ok
      ? `✓ ${t('settings.model.connectOk')}${r.latencyMs !== undefined ? ` (${r.latencyMs}ms)` : ''}`
      : `✗ ${t('settings.model.connectFail', { detail: r.error ?? r.errorKind ?? t('settings.model.unknownError') })}`;
  } catch (e) {
    sourceTestMsg.value = `✗ ${t('settings.model.connectFail', { detail: e instanceof Error ? e.message : String(e) })}`;
  } finally {
    sourceTesting.value = false;
  }
  emit('saved');
}
async function setDefault(id: string): Promise<void> {
  await window.openpet.rpc('provider.setDefault', { capability: activeTab.value, modelId: id });
  await reloadPrefs();
  emit('saved');
}

// 标量 pref（预算 / 离线卡）；两层数组键走 provider.* RPC。
async function set<K extends PrefKey>(key: K, value: Prefs[K]): Promise<void> {
  prefs.value = { ...prefs.value, [key]: value };
  await window.openpet.rpc('app.prefs.set', { key, value: value as string | number | boolean });
  emit('saved');
}

const FALLBACK = computed(() => [
  { value: 'ollama', label: t('settings.model.fallbackOllama') },
  { value: 'demo', label: t('settings.model.fallbackDemo') },
  { value: 'error', label: t('settings.model.fallbackError') },
]);
const ollamaOptions = computed(() => {
  const names = new Set(ollamaModels.value);
  if (prefs.value['offline.ollamaModel']) names.add(prefs.value['offline.ollamaModel']);
  const arr = [...names];
  return arr.length
    ? arr.map((m) => ({ value: m, label: m }))
    : [{ value: '', label: t('settings.model.noLocalModels') }];
});

// --- 批次⑥ F-AI-08：用量与预算卡（口径 = 万 tokens；月界 Main 侧自然月）。 ---
const usage = ref<{ sinceTs: number; tokensIn: number; tokensOut: number; messages: number } | null>(
  null,
);
onMounted(async () => {
  usage.value = await window.openpet.rpc('app.usageSummary', {});
});
const usedTokens = computed(() => (usage.value ? usage.value.tokensIn + usage.value.tokensOut : 0));
const capTokens = computed(() => prefs.value['budget.monthlyCap'] * 10_000);
const usagePct = computed(() =>
  capTokens.value > 0 ? Math.min(100, (usedTokens.value / capTokens.value) * 100) : 0,
);
const nearBudget = computed(
  () =>
    prefs.value['budget.enabled'] &&
    capTokens.value > 0 &&
    usagePct.value >= prefs.value['budget.warnAt'],
);
function fmtTokens(n: number): string {
  return n >= 10_000 ? t('settings.model.tenThousand', { n: (n / 10_000).toFixed(2) }) : String(n);
}
const ON_EXCEED = computed(() => [
  { value: 'warn', label: t('settings.model.exceedWarn') },
  { value: 'pause', label: t('settings.model.exceedPause') },
]);
</script>

<template>
  <div class="w-full max-w-[1180px]">
    <!-- Provider 工作台 -->
    <section class="ds-glass rounded-panel mb-4 p-5">
      <div class="flex items-start justify-between gap-4">
        <div>
          <h2 class="text-md font-semibold text-text-main">{{ t('settings.model.providersTitle') }}</h2>
          <p class="mt-1 text-base text-text-sub">
            {{ t('settings.model.providersDesc') }}
          </p>
        </div>
        <button
          v-if="!isChat"
          class="shrink-0 rounded-btn px-4 py-2 text-base text-white"
          style="background: linear-gradient(135deg, var(--ds-brand-from), var(--ds-brand-to))"
          @click="adding = true"
        >
          {{ t('settings.model.addProvider') }}
        </button>
      </div>

      <!-- 能力 tab -->
      <div class="mt-4 flex flex-wrap gap-1 border-b border-glass-border pb-2">
        <button
          v-for="tab in CAPABILITY_TABS"
          :key="tab.value"
          class="rounded-btn px-3 py-1.5 text-base transition"
          :class="
            activeTab === tab.value
              ? 'ds-glass border border-brand-to text-text-main'
              : 'text-text-sub hover:text-text-main'
          "
          @click="activeTab = tab.value"
        >
          {{ t(tab.label) }}
        </button>
      </div>

      <!-- 对话：左 source 列表 + 右配置/models 工作台 -->
      <div v-if="isChat" class="mt-4 grid gap-4 lg:grid-cols-[260px_1fr]">
        <div class="min-h-[320px] rounded-card border border-glass-border p-3">
          <ProviderSourcesPanel
            :sources="tabSources"
            :active-source-id="activeSource?.id ?? ''"
            @select="selectSource"
            @add="adding = true"
            @remove="removeSource"
          />
        </div>
        <div class="min-h-[320px]">
          <ProviderModelsPanel
            v-if="activeSource"
            :source="activeSource"
            :models="activeModels"
            :available="available"
            :default-model-id="defaultModelId"
            :testing="testing"
            :fetching="fetching"
            :fetch-msg="fetchMsg"
            :source-testing="sourceTesting"
            :source-test-msg="sourceTestMsg"
            @save-source="saveSource"
            @test-source="testSource"
            @fetch-models="fetchModels"
            @add-model="addModel"
            @delete-model="deleteModel"
            @toggle-model="toggleModel"
            @test-model="testModel"
            @set-default="setDefault"
            @update-caps="updateCaps"
          />
          <div
            v-else
            class="flex h-full items-center justify-center rounded-card border border-dashed border-glass-border p-6 text-center text-sm text-text-sub"
          >
            {{ t('settings.model.emptySourcesChat') }}
          </div>
        </div>
      </div>

      <!-- 非对话：provider 卡片网格（照 AstrBot） -->
      <div v-else class="mt-4">
        <div
          v-if="!tabSources.length"
          class="rounded-card border border-dashed border-glass-border p-10 text-center text-sm text-text-sub"
        >
          {{ t('settings.model.emptySources') }}
        </div>
        <div v-else class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <ProviderCard
            v-for="s in tabSources"
            :key="s.id"
            :source="s"
            :testing="cardTesting[s.id]"
            :test-msg="cardTestMsg[s.id]"
            @toggle="(v) => toggleSourceEnabled(s, v)"
            @edit="openEdit(s)"
            @copy="copyProvider(s)"
            @remove="removeSource(s.id)"
            @test="testCard(s)"
          />
        </div>
      </div>
    </section>

    <AddSourceDialog
      v-if="adding"
      :templates="providerTemplates"
      :existing-ids="sources.map((s) => s.id)"
      :capability="activeTab"
      @create="onCreateFromTemplate"
      @close="adding = false"
    />
    <ProviderEditDialog
      :open="editOpen"
      :source="editingSource"
      :mode="editMode"
      :detecting="detecting"
      :detected-dim="detectedDim"
      :detect-msg="detectMsg"
      :testing="dialogTesting"
      :test-msg="dialogTestMsg"
      @save="saveProvider"
      @autodetect="autodetectDim"
      @test="testFromDialog"
      @cancel="editOpen = false"
    />

    <div class="grid gap-4">
      <!-- 批次⑥ F-AI-08：用量与预算（照 ui-design 8.3 预算告警卡） -->
      <section class="ds-glass rounded-panel p-5">
        <h2 class="text-md font-semibold text-text-main">{{ t('settings.model.budgetTitle') }}</h2>
        <p class="mt-2 text-base text-text-sub">
          {{ t('settings.model.usedThisMonth') }}
          <span class="font-semibold text-text-main">{{ fmtTokens(usedTokens) }}</span> tokens
          <template v-if="usage">
            {{ t('settings.model.usageDetail', { tin: fmtTokens(usage.tokensIn), tout: fmtTokens(usage.tokensOut), n: usage.messages }) }}
          </template>
          <span v-if="nearBudget" class="ml-2 font-medium" style="color: var(--ds-danger)">
            {{ t('settings.model.nearBudget') }}
          </span>
        </p>
        <div
          v-if="prefs['budget.enabled'] && capTokens > 0"
          class="mt-3 h-2 overflow-hidden rounded-full bg-glass-border"
        >
          <div
            class="h-full transition-all ease-ds"
            :style="{
              width: `${usagePct}%`,
              background: nearBudget
                ? 'var(--ds-danger)'
                : 'linear-gradient(90deg, var(--ds-brand-from), var(--ds-brand-to))',
            }"
          />
        </div>
        <div class="mt-4 divide-y divide-glass-border rounded-card border border-glass-border">
          <div class="grid min-h-[58px] gap-4 px-4 py-3 md:grid-cols-[1fr_auto] md:items-center">
            <div>
              <div class="font-semibold text-text-main">{{ t('settings.model.budgetEnable') }}</div>
              <div class="mt-1 text-sm text-text-sub">{{ t('settings.model.budgetEnableDesc') }}</div>
            </div>
            <Switch
              :model-value="prefs['budget.enabled']"
              @update:model-value="(v) => set('budget.enabled', v)"
            />
          </div>
          <div class="grid min-h-[58px] gap-4 px-4 py-3 md:grid-cols-[1fr_auto] md:items-center">
            <div>
              <div class="font-semibold text-text-main">{{ t('settings.model.budgetCap') }}</div>
              <div class="mt-1 text-sm text-text-sub">{{ t('settings.model.budgetCapDesc') }}</div>
            </div>
            <div class="w-[120px]">
              <Input
                :model-value="String(prefs['budget.monthlyCap'])"
                type="number"
                @update:model-value="(v) => set('budget.monthlyCap', Math.max(0, Number(v) || 0))"
              />
            </div>
          </div>
          <div class="grid min-h-[58px] gap-4 px-4 py-3 md:grid-cols-[1fr_auto] md:items-center">
            <div>
              <div class="font-semibold text-text-main">{{ t('settings.model.warnAt') }}</div>
              <div class="mt-1 text-sm text-text-sub">
                {{ t('settings.model.warnAtDesc', { pct: prefs['budget.warnAt'] }) }}
              </div>
            </div>
            <Slider
              :model-value="prefs['budget.warnAt']"
              :min="0"
              :max="100"
              @change="(v) => set('budget.warnAt', v)"
            />
          </div>
          <div class="grid min-h-[58px] gap-4 px-4 py-3 md:grid-cols-[1fr_auto] md:items-center">
            <div>
              <div class="font-semibold text-text-main">{{ t('settings.model.onExceed') }}</div>
              <div class="mt-1 text-sm text-text-sub">{{ t('settings.model.onExceedDesc') }}</div>
            </div>
            <Select
              :model-value="prefs['budget.onExceed']"
              :options="ON_EXCEED"
              @update:model-value="(v) => set('budget.onExceed', v as Prefs['budget.onExceed'])"
            />
          </div>
        </div>
      </section>

      <section class="ds-glass rounded-panel p-5">
        <h2 class="text-md font-semibold text-text-main">{{ t('settings.model.offlineTitle') }}</h2>
        <p class="mt-2 text-base text-text-sub">{{ t('settings.model.offlineDesc') }}</p>
        <div class="mt-4 divide-y divide-glass-border rounded-card border border-glass-border">
          <div class="grid min-h-[58px] gap-4 px-4 py-3 md:grid-cols-[1fr_auto] md:items-center">
            <div>
              <div class="font-semibold text-text-main">{{ t('settings.model.fallbackWhen') }}</div>
              <div class="mt-1 text-sm text-text-sub">{{ t('settings.model.fallbackWhenDesc') }}</div>
            </div>
            <Select
              :model-value="prefs['offline.fallbackMode']"
              :options="FALLBACK"
              @update:model-value="
                (v) => set('offline.fallbackMode', v as Prefs['offline.fallbackMode'])
              "
            />
          </div>
          <div class="grid min-h-[58px] gap-4 px-4 py-3 md:grid-cols-[1fr_auto] md:items-center">
            <div>
              <div class="font-semibold text-text-main">{{ t('settings.model.ollamaBackup') }}</div>
              <div class="mt-1 text-sm text-text-sub">{{ t('settings.model.ollamaBackupDesc') }}</div>
            </div>
            <Select
              :model-value="prefs['offline.ollamaModel']"
              :options="ollamaOptions"
              @update:model-value="(v) => set('offline.ollamaModel', v)"
            />
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
