<!-- settings/pages/ProviderPage.vue — D3「模型供应商」（照 AstrBot ProviderPage 逐屏对齐）：
     顶部能力 tab（对话 / Agent / 语音转文字 / 文字转语音 / 嵌入 / 重排序）→ 一张工作台卡：
     左栏 = 供应商源列表（+ 新增 → 搜索卡片弹窗，选中即生��**本地草稿**，保存前不落盘）；
     右栏 = 头部（名 · Base URL · 「保存配置」仅在有改动时可用；非对话另有「测试」）→ 「设置」表单
     → 「高级配置...」→（对话）模型面板：获取模型列表 / 自定义模型 / 已配置 · 可用两段。
     删除走二次确认；结果经顶部 snackbar 提示（照 AstrBot showMessage）。
     页面下方保留 openpet 自有：杂务模型 / 用量与预算 / 离线兜底。 -->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { MousePointerClick, Plug, Save } from 'lucide-vue-next';
import type {
  Capability,
  ModelEntry,
  PrefKey,
  Prefs,
  ProviderSource,
  ProviderTemplate,
} from '@openpet/protocol';
import { DEFAULT_PREFS, generateUniqueSourceId, modelEntryId } from '@openpet/protocol';
import Select from '../../components/Select.vue';
import Switch from '../../components/Switch.vue';
import Slider from '../../components/Slider.vue';
import Input from '../../components/Input.vue';
import ConfirmDialog from '../../components/ConfirmDialog.vue';
import ProviderSourcesPanel from '../../components/provider/ProviderSourcesPanel.vue';
import ProviderSourceDialog from '../../components/provider/ProviderSourceDialog.vue';
import ProviderSourceForm from '../../components/provider/ProviderSourceForm.vue';
import ProviderModelsPanel from '../../components/provider/ProviderModelsPanel.vue';
import ModelEditDialog from '../../components/provider/ModelEditDialog.vue';
import ManualModelDialog from '../../components/provider/ManualModelDialog.vue';
import {
  CAPABILITY_TABS,
  defaultPrefKeyFor,
  fetchOutcomeMessage,
  modelsForSource,
  sourcesForTab,
} from '../provider-config-view';
import { buildModelEntry, plain, sourceEquals } from '../provider-workbench';

const emit = defineEmits<{ saved: [] }>();
const { t } = useI18n();

// ===== 状态（照 useProviderSources）=====
const prefs = ref<Prefs>({ ...DEFAULT_PREFS });
const sources = ref<ProviderSource[]>([]);
/** 未保存草稿（AstrBot unsavedProviderSourceMarker）；保存成功后移入 sources。 */
const drafts = ref<ProviderSource[]>([]);
const models = ref<ModelEntry[]>([]);
const providerTemplates = ref<ProviderTemplate[]>([]);
const activeTab = ref<Capability>('chat');
const activeSourceId = ref('');
/** 右栏可编辑副本；与持久态不等 = 已修改。 */
const editable = ref<ProviderSource | null>(null);
const available = ref<string[]>([]);
const modelQuery = ref('');
const loadingModels = ref(false);
const savingSource = ref(false);
const testingSource = ref(false);
const testing = ref<Record<string, boolean | null>>({});
const savingModels = ref<string[]>([]);
const detecting = ref(false);
const detectMsg = ref('');
const detectedDim = ref<number | undefined>(undefined);
const addOpen = ref(false);
const manualOpen = ref(false);
const modelEdit = ref<{ open: boolean; entry: ModelEntry | null; mode: 'add' | 'edit' }>({
  open: false,
  entry: null,
  mode: 'edit',
});
const confirm = ref<{
  open: boolean;
  kind: 'source' | 'model';
  source?: ProviderSource;
  model?: ModelEntry;
}>({ open: false, kind: 'source' });
const snack = ref<{ text: string; kind: 'success' | 'error' | 'info' } | null>(null);
let snackTimer: ReturnType<typeof setTimeout> | undefined;

const isChat = computed(() => activeTab.value === 'chat');
const persistedForTab = computed(() => sourcesForTab(sources.value, activeTab.value));
const displayed = computed(() => [
  ...persistedForTab.value,
  ...drafts.value.filter((d) => d.capability === activeTab.value),
]);
const selected = computed(() => displayed.value.find((s) => s.id === activeSourceId.value) ?? null);
const isDraft = computed(() =>
  Boolean(selected.value && drafts.value.some((d) => d.id === selected.value!.id)),
);
const isModified = computed(() => {
  if (!editable.value || !selected.value) return false;
  if (isDraft.value) return true;
  return !sourceEquals(editable.value, selected.value);
});
const activeModels = computed(() =>
  selected.value ? modelsForSource(models.value, selected.value.id) : [],
);
const defaultModelId = computed(() => prefs.value[defaultPrefKeyFor(activeTab.value)] as string);
const templatesForTab = computed(() =>
  providerTemplates.value.filter((x) => x.capability === activeTab.value),
);

function showMessage(text: string, kind: 'success' | 'error' | 'info' = 'success'): void {
  snack.value = { text, kind };
  if (snackTimer) clearTimeout(snackTimer);
  snackTimer = setTimeout(() => (snack.value = null), 3000);
}
const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// ===== 加载 =====
async function reloadConfig(): Promise<void> {
  const cfg = await window.openpet.rpc('provider.getConfig', {});
  sources.value = cfg.sources;
  models.value = cfg.models;
  providerTemplates.value = cfg.providerTemplates;
}
async function reloadPrefs(): Promise<void> {
  prefs.value = await window.openpet.rpc('app.prefs.getAll', {});
}
onMounted(async () => {
  await reloadPrefs();
  await reloadConfig();
  void detectOllama();
});
watch(activeTab, () => {
  activeSourceId.value = '';
  editable.value = null;
  available.value = [];
  modelQuery.value = '';
});

// ===== 源：选择 / 新增草稿 / 保存 / 删除 =====
function selectSource(id: string): void {
  const s = displayed.value.find((x) => x.id === id);
  if (!s) return;
  activeSourceId.value = id;
  editable.value = plain(s);
  available.value = [];
  modelQuery.value = '';
  detectMsg.value = '';
  detectedDim.value = undefined;
}
function addSource(tpl: ProviderTemplate): void {
  addOpen.value = false;
  const id = generateUniqueSourceId(
    tpl.id,
    [...sources.value, ...drafts.value].map((s) => s.id),
  );
  const draft: ProviderSource = {
    id,
    adapter: tpl.adapter,
    capability: tpl.capability,
    apiBase: tpl.apiBase,
    key: '',
    enabled: true,
    name: tpl.name,
    icon: tpl.provider,
  };
  drafts.value = [...drafts.value, draft];
  selectSource(id);
}
const idInvalid = computed(() => {
  const e = editable.value;
  if (!e) return true;
  const id = e.id.trim();
  if (!id || id.includes('/')) return true;
  return [...sources.value, ...drafts.value].some(
    (s) => s.id === id && s.id !== selected.value?.id,
  );
});
async function saveSource(): Promise<boolean> {
  const e = editable.value;
  const sel = selected.value;
  if (!e || !sel || idInvalid.value) return false;
  savingSource.value = true;
  try {
    const nextId = e.id.trim();
    if (nextId !== sel.id) {
      // 改名：草稿直接改 id；已持久化的源走 renameSource 迁移模型/默认指针，再 upsert 其余字段。
      if (isDraft.value)
        drafts.value = drafts.value.map((d) => (d.id === sel.id ? { ...d, id: nextId } : d));
      else await window.openpet.rpc('provider.renameSource', { from: sel.id, to: nextId });
      activeSourceId.value = nextId;
    }
    await window.openpet.rpc('provider.upsertSource', { source: plain({ ...e, id: nextId }) });
    if (!isChat.value) await syncSingleModel(e);
    drafts.value = drafts.value.filter((d) => d.id !== e.id);
    await reloadConfig();
    await reloadPrefs();
    const persisted = sources.value.find((s) => s.id === e.id);
    if (persisted) editable.value = plain(persisted);
    showMessage(t('settings.providerUi.saveSuccess'));
    emit('saved');
    return true;
  } catch (err) {
    showMessage(errText(err) || t('settings.providerUi.saveError'), 'error');
    return false;
  } finally {
    savingSource.value = false;
  }
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
function askDeleteSource(s: ProviderSource): void {
  confirm.value = { open: true, kind: 'source', source: s };
}
function askDeleteModel(m: ModelEntry): void {
  confirm.value = { open: true, kind: 'model', model: m };
}
async function onConfirm(): Promise<void> {
  const c = confirm.value;
  confirm.value = { open: false, kind: 'source' };
  if (c.kind === 'source' && c.source) await deleteSource(c.source);
  if (c.kind === 'model' && c.model) await deleteModel(c.model);
}
async function deleteSource(s: ProviderSource): Promise<void> {
  const wasActive = activeSourceId.value === s.id;
  if (drafts.value.some((d) => d.id === s.id)) {
    drafts.value = drafts.value.filter((d) => d.id !== s.id);
  } else {
    try {
      await window.openpet.rpc('provider.deleteSource', { id: s.id });
      await reloadConfig();
      emit('saved');
    } catch (err) {
      showMessage(errText(err) || t('settings.providerUi.deleteError'), 'error');
      return;
    }
  }
  if (wasActive) {
    activeSourceId.value = '';
    editable.value = null;
    available.value = [];
  }
  showMessage(t('settings.providerUi.deleteSuccess'));
}

// ===== 测试 / 检测（非对话头部「测试」+ 嵌入维度自动检测）=====
async function probeSource(s: ProviderSource): Promise<string> {
  if (s.capability === 'embedding') {
    const model =
      (typeof s.config?.model === 'string' && s.config.model.trim()) ||
      models.value.find((m) => m.sourceId === s.id)?.model ||
      '';
    if (!model) throw new Error(t('settings.model.needEmbeddingModel'));
    const r = await window.openpet.rpc('provider.detectEmbeddingDim', { sourceId: s.id, model });
    if (!r.ok) throw new Error(r.error ?? t('settings.model.failed'));
    return (
      t('settings.model.connectOkDim', { dim: r.dimensions ?? 0 }) +
      (r.latencyMs !== undefined ? ` ${r.latencyMs}ms` : '')
    );
  }
  const r = await window.openpet.rpc('provider.testSource', { id: s.id });
  if (!r.ok) throw new Error(r.error ?? r.errorKind ?? t('settings.model.failed'));
  return t('settings.model.connectOk') + (r.latencyMs !== undefined ? ` (${r.latencyMs}ms)` : '');
}
async function testSource(): Promise<void> {
  const s = selected.value;
  if (!s || isDraft.value) return;
  if (isModified.value && !(await saveSource())) return;
  testingSource.value = true;
  try {
    showMessage(await probeSource(s));
  } catch (err) {
    showMessage(t('settings.model.connectFail', { detail: errText(err) }), 'error');
  } finally {
    testingSource.value = false;
  }
}
async function autodetectDim(source: ProviderSource): Promise<void> {
  const m = typeof source.config?.model === 'string' ? source.config.model.trim() : '';
  if (!m) {
    detectMsg.value = t('settings.model.needEmbeddingModel');
    return;
  }
  editable.value = plain(source);
  if (!(await saveSource())) return;
  detecting.value = true;
  detectMsg.value = '';
  try {
    const r = await window.openpet.rpc('provider.detectEmbeddingDim', {
      sourceId: source.id,
      model: m,
    });
    if (r.ok && r.dimensions) detectedDim.value = r.dimensions;
    else
      detectMsg.value = t('settings.model.detectFail', {
        detail: r.error ?? t('settings.model.unknownError'),
      });
  } catch (err) {
    detectMsg.value = t('settings.model.detectFail', { detail: errText(err) });
  } finally {
    detecting.value = false;
  }
}

// ===== 模型（对话工作台）=====
async function fetchModels(): Promise<void> {
  const s = selected.value;
  if (!s) return;
  if (isModified.value && !(await saveSource())) return;
  loadingModels.value = true;
  try {
    const r = await window.openpet.rpc('provider.fetchModels', { sourceId: s.id });
    available.value = r.models;
    if (r.models.length === 0) showMessage(t('settings.providerUi.noModelsFound'), 'info');
  } catch (err) {
    available.value = [];
    const bad = fetchOutcomeMessage({ error: err });
    showMessage(t(bad.key, bad.params), 'error');
  } finally {
    loadingModels.value = false;
  }
}
function openModelAdd(model: string): void {
  const s = selected.value;
  if (!s) return;
  if (activeModels.value.some((m) => m.model === model)) {
    showMessage(t('settings.providerUi.manualModelExists'), 'error');
    return;
  }
  modelEdit.value = { open: true, entry: buildModelEntry(s.id, model), mode: 'add' };
}
function onManualConfirm(modelId: string): void {
  manualOpen.value = false;
  openModelAdd(modelId);
}
function openModelEdit(entry: ModelEntry): void {
  modelEdit.value = { open: true, entry: plain(entry), mode: 'edit' };
}
async function saveModel(entry: ModelEntry): Promise<void> {
  const mode = modelEdit.value.mode;
  savingModels.value = [...savingModels.value, entry.id];
  try {
    if (mode === 'add') {
      await window.openpet.rpc('provider.addModel', { entry: plain(entry) });
      if (!defaultModelId.value)
        await window.openpet.rpc('provider.setDefault', {
          capability: activeTab.value,
          modelId: entry.id,
        });
      showMessage(t('settings.providerUi.addSuccess', { model: entry.model }));
    } else {
      await window.openpet.rpc('provider.updateModel', { entry: plain(entry) });
      showMessage(t('settings.providerUi.saveSuccess'));
    }
    modelEdit.value = { open: false, entry: null, mode: 'edit' };
    await reloadConfig();
    await reloadPrefs();
    emit('saved');
  } catch (err) {
    showMessage(errText(err) || t('settings.providerUi.saveError'), 'error');
  } finally {
    savingModels.value = savingModels.value.filter((id) => id !== entry.id);
  }
}
async function deleteModel(m: ModelEntry): Promise<void> {
  try {
    await window.openpet.rpc('provider.deleteModel', { id: m.id });
    await reloadConfig();
    await reloadPrefs();
    showMessage(t('settings.providerUi.modelDeleteSuccess'));
    emit('saved');
  } catch (err) {
    showMessage(errText(err) || t('settings.providerUi.modelDeleteError'), 'error');
  }
}
async function toggleModel(p: { id: string; enabled: boolean }): Promise<void> {
  savingModels.value = [...savingModels.value, p.id];
  try {
    await window.openpet.rpc('provider.setModelEnabled', p);
    await reloadConfig();
    showMessage(t('settings.providerUi.statusUpdated'));
    emit('saved');
  } catch (err) {
    showMessage(errText(err), 'error');
  } finally {
    savingModels.value = savingModels.value.filter((id) => id !== p.id);
  }
}
async function testModel(m: ModelEntry): Promise<void> {
  testing.value = { ...testing.value, [m.id]: null };
  try {
    const r = await window.openpet.rpc('provider.testModel', { id: m.id });
    testing.value = { ...testing.value, [m.id]: r.ok };
    if (r.ok)
      showMessage(
        t('settings.providerUi.testSuccessWithLatency', { id: m.id, latency: r.latencyMs ?? 0 }),
      );
    else
      showMessage(
        t('settings.providerUi.testFailed', {
          id: m.id,
          error: r.errorKind ?? t('settings.model.unknownError'),
        }),
        'error',
      );
  } catch (err) {
    testing.value = { ...testing.value, [m.id]: false };
    showMessage(t('settings.providerUi.testFailed', { id: m.id, error: errText(err) }), 'error');
  }
}
async function setDefault(id: string): Promise<void> {
  await window.openpet.rpc('provider.setDefault', { capability: activeTab.value, modelId: id });
  await reloadPrefs();
  showMessage(t('settings.providerUi.defaultSet', { id }));
  emit('saved');
}

// ===== 页面下方 openpet 自有卡片（杂务模型 / 预算 / 离线）=====
const ollamaModels = ref<string[]>([]);
async function detectOllama(): Promise<void> {
  const r = await window.openpet.rpc('provider.ollamaDetect', {});
  ollamaModels.value = r.models;
}
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
const usage = ref<{
  sinceTs: number;
  tokensIn: number;
  tokensOut: number;
  messages: number;
} | null>(null);
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
const utilityOptions = computed(() => {
  const chatSourceIds = new Set(
    sources.value.filter((s) => s.capability === 'chat' && s.enabled).map((s) => s.id),
  );
  return [
    { value: '', label: t('settings.model.utilityFollow') },
    ...models.value
      .filter((m) => chatSourceIds.has(m.sourceId) && m.enabled)
      .map((m) => ({ value: m.id, label: m.model })),
  ];
});
</script>

<template>
  <div class="w-full max-w-[1200px]">
    <!-- 顶部 snackbar（照 AstrBot v-snackbar location=top） -->
    <div
      v-if="snack"
      class="ds-glass fixed left-1/2 top-4 z-[70] -translate-x-1/2 rounded-panel px-4 py-2 text-sm shadow-lg"
      :style="{
        color:
          snack.kind === 'error'
            ? 'var(--ds-danger)'
            : snack.kind === 'success'
              ? 'var(--ds-success)'
              : 'var(--ds-text-main)',
      }"
      role="status"
    >
      {{ snack.text }}
    </div>

    <!-- 能力 tab（AstrBot provider-tabs） -->
    <div
      class="mb-3 flex flex-wrap gap-0.5 px-1"
      role="tablist"
      :aria-label="t('settings.providerUi.providerType')"
    >
      <button
        v-for="tab in CAPABILITY_TABS"
        :key="tab.value"
        role="tab"
        :aria-selected="activeTab === tab.value"
        class="h-[34px] rounded-btn px-3 text-[13px] font-medium transition"
        :class="
          activeTab === tab.value
            ? 'bg-glass-border text-text-main'
            : 'text-text-sub hover:bg-glass-border/50 hover:text-text-main'
        "
        @click="activeTab = tab.value"
      >
        {{ t(tab.label) }}
      </button>
    </div>

    <!-- 工作台（AstrBot provider-workbench：左 320 / 分隔线 / 右） -->
    <section
      class="ds-glass mb-4 grid min-h-[560px] overflow-hidden rounded-panel lg:grid-cols-[minmax(280px,320px)_1px_minmax(0,1fr)]"
    >
      <div class="min-h-0 min-w-0">
        <ProviderSourcesPanel
          :sources="displayed"
          :active-id="activeSourceId"
          :title="
            isChat ? t('settings.providerUi.sourcesTitle') : t('settings.providerUi.providersTitle')
          "
          :empty-text="
            isChat
              ? t('settings.providerUi.sourcesEmpty')
              : t('settings.providerUi.providersEmptyTyped', {
                  type: t(CAPABILITY_TABS.find((x) => x.value === activeTab)!.label),
                })
          "
          :delete-label="
            isChat ? t('settings.providerUi.deleteSource') : t('settings.providerUi.deleteProvider')
          "
          :can-add="templatesForTab.length > 0"
          @add="addOpen = true"
          @select="selectSource"
          @remove="askDeleteSource"
        />
      </div>
      <div class="bg-glass-border" />
      <div class="flex min-h-0 min-w-0">
        <div v-if="selected && editable" class="flex min-h-0 flex-1 flex-col">
          <!-- 头部 -->
          <div class="flex items-start justify-between gap-4 px-6 pb-3.5 pt-[18px]">
            <div class="min-w-0">
              <div
                class="break-all text-[21px] font-bold leading-tight tracking-tight text-text-main"
              >
                {{ selected.id }}
              </div>
              <div class="mt-1.5 break-all text-[13px] text-text-sub">
                {{ editable.apiBase || 'N/A' }}
              </div>
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <button
                v-if="!isChat && !isDraft"
                class="flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition hover:bg-glass-border/60 disabled:opacity-50"
                :style="{ color: 'var(--ds-brand-to)' }"
                :disabled="testingSource || !editable.enabled"
                @click="testSource"
              >
                <Plug :size="15" :stroke-width="1.75" />
                {{
                  testingSource ? t('settings.providerUi.testing') : t('settings.providerUi.test')
                }}
              </button>
              <button
                class="flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium text-white transition disabled:opacity-40"
                style="
                  background: linear-gradient(135deg, var(--ds-brand-from), var(--ds-brand-to));
                "
                :disabled="!isModified || savingSource || idInvalid"
                @click="saveSource"
              >
                <Save :size="15" :stroke-width="1.75" />
                {{
                  savingSource
                    ? t('settings.providerUi.saving')
                    : t('settings.providerUi.saveConfig')
                }}
              </button>
            </div>
          </div>
          <div class="border-t border-glass-border" />
          <div class="min-h-0 flex-1 overflow-y-auto">
            <ProviderSourceForm
              :key="selected.id"
              :model-value="editable"
              :taken-ids="[...sources, ...drafts].map((s) => s.id)"
              :original-id="selected.id"
              :detecting="detecting"
              :detect-msg="detectMsg"
              :detected-dim="detectedDim"
              @update:model-value="(v) => (editable = v)"
              @autodetect="autodetectDim"
            />
            <template v-if="isChat">
              <div class="border-t border-glass-border" />
              <div class="px-6 pb-6 pt-4">
                <ProviderModelsPanel
                  :models="activeModels"
                  :available="available"
                  :query="modelQuery"
                  :default-model-id="defaultModelId"
                  :loading="loadingModels"
                  :is-source-modified="isModified"
                  :testing="testing"
                  :saving="savingModels"
                  @update:query="(v) => (modelQuery = v)"
                  @fetch-models="fetchModels"
                  @open-manual="manualOpen = true"
                  @edit="openModelEdit"
                  @toggle="toggleModel"
                  @test="testModel"
                  @delete="askDeleteModel"
                  @add="openModelAdd"
                  @set-default="setDefault"
                />
              </div>
            </template>
          </div>
        </div>
        <div
          v-else
          class="flex min-h-[420px] flex-1 flex-col items-center justify-center text-text-sub"
        >
          <MousePointerClick :size="48" :stroke-width="1.25" class="opacity-50" />
          <p class="mt-2 text-sm">
            {{
              isChat
                ? t('settings.providerUi.selectSourceHint')
                : t('settings.providerUi.selectProviderHint')
            }}
          </p>
        </div>
      </div>
    </section>

    <ProviderSourceDialog
      v-if="addOpen"
      :templates="providerTemplates"
      :capability="activeTab"
      @select="addSource"
      @close="addOpen = false"
    />
    <ManualModelDialog
      :open="manualOpen"
      :source-id="selected?.id ?? ''"
      :existing="activeModels.map((m) => m.model)"
      @confirm="onManualConfirm"
      @cancel="manualOpen = false"
    />
    <ModelEditDialog
      :open="modelEdit.open"
      :entry="modelEdit.entry"
      :mode="modelEdit.mode"
      :saving="modelEdit.entry ? savingModels.includes(modelEdit.entry.id) : false"
      @save="saveModel"
      @cancel="modelEdit = { open: false, entry: null, mode: 'edit' }"
    />
    <ConfirmDialog
      :open="confirm.open"
      :title="
        confirm.kind === 'source'
          ? t('settings.providerUi.deleteSourceConfirm', {
              id: confirm.source?.id ?? '',
            })
          : t('settings.providerUi.deleteModelConfirm', { id: confirm.model?.id ?? '' })
      "
      :confirm-label="t('common.delete')"
      @confirm="onConfirm"
      @cancel="confirm = { open: false, kind: 'source' }"
    />

    <div class="grid gap-4">
      <!-- ⑮ 杂务模型 -->
      <section class="ds-glass rounded-panel p-5">
        <h2 class="text-md font-semibold text-text-main">{{ t('settings.model.utilityTitle') }}</h2>
        <p class="mt-2 text-base text-text-sub">{{ t('settings.model.utilityDesc') }}</p>
        <div class="mt-4 rounded-card border border-glass-border">
          <div class="grid min-h-[58px] gap-4 px-4 py-3 md:grid-cols-[1fr_auto] md:items-center">
            <div>
              <div class="font-semibold text-text-main">{{ t('settings.model.utilityModel') }}</div>
              <div class="mt-1 text-sm text-text-sub">
                {{ t('settings.model.utilityModelDesc') }}
              </div>
            </div>
            <Select
              :model-value="prefs['model.utilityModelId']"
              :options="utilityOptions"
              @update:model-value="(v) => set('model.utilityModelId', v)"
            />
          </div>
        </div>
      </section>

      <!-- 批次⑥ F-AI-08：用量与预算 -->
      <section class="ds-glass rounded-panel p-5">
        <h2 class="text-md font-semibold text-text-main">{{ t('settings.model.budgetTitle') }}</h2>
        <p class="mt-2 text-base text-text-sub">
          {{ t('settings.model.usedThisMonth') }}
          <span class="font-semibold text-text-main">{{ fmtTokens(usedTokens) }}</span> tokens
          <template v-if="usage">
            {{
              t('settings.model.usageDetail', {
                tin: fmtTokens(usage.tokensIn),
                tout: fmtTokens(usage.tokensOut),
                n: usage.messages,
              })
            }}
          </template>
          <span v-if="nearBudget" class="ml-2 font-medium" style="color: var(--ds-danger)">{{
            t('settings.model.nearBudget')
          }}</span>
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
              <div class="mt-1 text-sm text-text-sub">
                {{ t('settings.model.budgetEnableDesc') }}
              </div>
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
              <div class="mt-1 text-sm text-text-sub">
                {{ t('settings.model.fallbackWhenDesc') }}
              </div>
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
              <div class="mt-1 text-sm text-text-sub">
                {{ t('settings.model.ollamaBackupDesc') }}
              </div>
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
