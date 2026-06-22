<!-- settings/pages/ModelApiPage.vue — D3 模型 API → Provider 工作台（AstrBot 对齐两层 Source+Model）
     能力 tab + 左 source 列表 + 右 source 配置/models 表 + 新增弹窗；全部经 provider.* RPC。
     存而不接（渲染+持久，无 live 行为）：预算告警卡、离线兜底卡。视觉对照 hifi brief + §2 token。 -->
<script setup lang="ts">
import { onMounted, ref, computed, watch } from 'vue';
import type {
  Prefs,
  PrefKey,
  Capability,
  ProviderSource,
  ModelEntry,
  AdapterTemplate,
  ModelCaps,
} from '@desksoul/protocol';
import { DEFAULT_PREFS, modelEntryId } from '@desksoul/protocol';
import Switch from '../../components/Switch.vue';
import Select from '../../components/Select.vue';
import Slider from '../../components/Slider.vue';
import Input from '../../components/Input.vue';
import ProviderSourcesPanel from '../../components/provider/ProviderSourcesPanel.vue';
import ProviderModelsPanel from '../../components/provider/ProviderModelsPanel.vue';
import AddSourceDialog from '../../components/provider/AddSourceDialog.vue';
import {
  CAPABILITY_TABS,
  sourcesForTab,
  modelsForSource,
  defaultPrefKeyFor,
} from '../provider-config-view';

const emit = defineEmits<{ saved: [] }>();

const prefs = ref<Prefs>({ ...DEFAULT_PREFS });
const sources = ref<ProviderSource[]>([]);
const models = ref<ModelEntry[]>([]);
const templates = ref<AdapterTemplate[]>([]);
const activeTab = ref<Capability>('chat');
const activeSourceId = ref('');
const available = ref<string[]>([]);
const testing = ref<Record<string, boolean | null>>({});
const adding = ref(false);
const ollamaModels = ref<string[]>([]);

const tabSources = computed(() => sourcesForTab(sources.value, activeTab.value));
const activeSource = computed(
  () => tabSources.value.find((s) => s.id === activeSourceId.value) ?? tabSources.value[0],
);
const activeModels = computed(() =>
  activeSource.value ? modelsForSource(models.value, activeSource.value.id) : [],
);
const defaultModelId = computed(() => prefs.value[defaultPrefKeyFor(activeTab.value)] as string);

async function reloadConfig(): Promise<void> {
  const cfg = await window.desksoul.rpc('provider.getConfig', {});
  sources.value = cfg.sources;
  models.value = cfg.models;
  templates.value = cfg.templates;
  if (!tabSources.value.some((s) => s.id === activeSourceId.value)) {
    activeSourceId.value = tabSources.value[0]?.id ?? '';
  }
}
async function reloadPrefs(): Promise<void> {
  prefs.value = await window.desksoul.rpc('app.prefs.getAll', {});
}

onMounted(async () => {
  await reloadPrefs();
  await reloadConfig();
  void detectOllama();
});

watch(activeTab, () => {
  activeSourceId.value = tabSources.value[0]?.id ?? '';
  available.value = [];
});
function selectSource(id: string): void {
  activeSourceId.value = id;
  available.value = [];
}

async function detectOllama(): Promise<void> {
  const r = await window.desksoul.rpc('provider.ollamaDetect', {});
  ollamaModels.value = r.models;
}

async function addSource(source: ProviderSource): Promise<void> {
  await window.desksoul.rpc('provider.upsertSource', { source });
  await reloadConfig();
  activeSourceId.value = source.id;
  emit('saved');
}
async function removeSource(id: string): Promise<void> {
  await window.desksoul.rpc('provider.deleteSource', { id });
  await reloadConfig();
  emit('saved');
}
async function saveSource(source: ProviderSource): Promise<void> {
  await window.desksoul.rpc('provider.upsertSource', { source });
  await reloadConfig();
  emit('saved');
}
async function fetchModels(): Promise<void> {
  if (!activeSource.value) return;
  const r = await window.desksoul.rpc('provider.fetchModels', { sourceId: activeSource.value.id });
  available.value = r.models;
}
async function addModel(model: string): Promise<void> {
  if (!activeSource.value) return;
  const sid = activeSource.value.id;
  await window.desksoul.rpc('provider.addModel', {
    entry: { id: modelEntryId(sid, model), sourceId: sid, model, enabled: true, caps: {} },
  });
  await reloadConfig();
  emit('saved');
}
async function deleteModel(id: string): Promise<void> {
  await window.desksoul.rpc('provider.deleteModel', { id });
  await reloadConfig();
  emit('saved');
}
async function toggleModel(p: { id: string; enabled: boolean }): Promise<void> {
  await window.desksoul.rpc('provider.setModelEnabled', p);
  await reloadConfig();
  emit('saved');
}
async function updateCaps(p: { id: string; caps: ModelCaps }): Promise<void> {
  await window.desksoul.rpc('provider.updateModelCaps', p);
  await reloadConfig();
  emit('saved');
}
async function testModel(id: string): Promise<void> {
  testing.value = { ...testing.value, [id]: null };
  const r = await window.desksoul.rpc('provider.testModel', { id });
  testing.value = { ...testing.value, [id]: r.ok };
}
async function setDefault(id: string): Promise<void> {
  await window.desksoul.rpc('provider.setDefault', { capability: activeTab.value, modelId: id });
  await reloadPrefs();
  emit('saved');
}

// 标量 pref（预算 / 离线卡）；两层数组键走 provider.* RPC。
async function set<K extends PrefKey>(key: K, value: Prefs[K]): Promise<void> {
  prefs.value = { ...prefs.value, [key]: value };
  await window.desksoul.rpc('app.prefs.set', { key, value: value as string | number | boolean });
  emit('saved');
}

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
</script>

<template>
  <div class="w-full max-w-[1180px]">
    <!-- Provider 工作台 -->
    <section class="ds-glass rounded-panel mb-4 p-5">
      <h2 class="text-md font-semibold text-text-main">模型 API · Provider 工作台</h2>
      <p class="mt-1 text-base text-text-sub">
        按能力建提供商源（同类型可并存），每个源挂多个模型，逐能力选默认。Key 明文随源保存。
      </p>

      <!-- 能力 tab -->
      <div class="mt-4 flex flex-wrap gap-1 border-b border-glass-border pb-2">
        <button
          v-for="t in CAPABILITY_TABS"
          :key="t.value"
          class="rounded-btn px-3 py-1.5 text-base transition"
          :class="
            activeTab === t.value
              ? 'ds-glass border border-brand-to text-text-main'
              : 'text-text-sub hover:text-text-main'
          "
          @click="activeTab = t.value"
        >
          {{ t.label }}
        </button>
      </div>

      <!-- 左 source 列表 + 右配置/models -->
      <div class="mt-4 grid gap-4 lg:grid-cols-[260px_1fr]">
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
            @save-source="saveSource"
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
            该能力下还没有提供商源，点左侧「＋ 新增提供商源」开始
          </div>
        </div>
      </div>
    </section>

    <AddSourceDialog
      v-if="adding"
      :templates="templates"
      :existing-ids="sources.map((s) => s.id)"
      :capability="activeTab"
      @create="addSource"
      @close="adding = false"
    />

    <div class="grid gap-4 xl:grid-cols-2">
      <section class="ds-glass rounded-panel p-5">
        <h2 class="text-md font-semibold text-text-main">DeskSoul 预算提醒</h2>
        <p class="mt-2 text-base text-text-sub">
          本月已使用 <strong style="color: var(--ds-danger)">¥0.00 / —</strong>
        </p>
        <div class="mt-4 divide-y divide-glass-border rounded-card border border-glass-border">
          <div class="grid min-h-[58px] grid-cols-[1fr_auto] items-center gap-4 px-4 py-3">
            <div>
              <div class="font-semibold text-text-main">启用预算告警</div>
              <div class="mt-1 text-sm text-text-sub">接近阈值时在聊天输入区和状态条提示</div>
            </div>
            <Switch
              :model-value="prefs['budget.enabled']"
              @update:model-value="(v) => set('budget.enabled', v)"
            />
          </div>
          <div class="grid min-h-[58px] gap-4 px-4 py-3 md:grid-cols-[1fr_auto] md:items-center">
            <div>
              <div class="font-semibold text-text-main">本月预算上限</div>
              <div class="mt-1 text-sm text-text-sub">¥ / 月</div>
            </div>
            <Input
              :model-value="String(prefs['budget.monthlyCap'])"
              @update:model-value="(v) => set('budget.monthlyCap', Math.max(0, Number(v) || 0))"
            />
          </div>
          <div class="grid min-h-[58px] gap-4 px-4 py-3 md:grid-cols-[1fr_auto] md:items-center">
            <div>
              <div class="font-semibold text-text-main">告警阈值</div>
              <div class="mt-1 text-sm text-text-sub">
                达到 {{ prefs['budget.warnAt'] }}% 时提醒
              </div>
            </div>
            <Slider
              :model-value="prefs['budget.warnAt']"
              :min="0"
              :max="100"
              min-label="0%"
              max-label="100%"
              @update:model-value="(v) => set('budget.warnAt', v)"
            />
          </div>
          <div class="grid min-h-[58px] gap-4 px-4 py-3 md:grid-cols-[1fr_auto] md:items-center">
            <div>
              <div class="font-semibold text-text-main">达到上限时</div>
              <div class="mt-1 text-sm text-text-sub">选择提醒或暂停策略</div>
            </div>
            <Select
              :model-value="prefs['budget.onExceed']"
              :options="EXCEED"
              @update:model-value="(v) => set('budget.onExceed', v as Prefs['budget.onExceed'])"
            />
          </div>
        </div>
      </section>

      <section class="ds-glass rounded-panel p-5">
        <h2 class="text-md font-semibold text-text-main">离线兜底</h2>
        <p class="mt-2 text-base text-text-sub">所有在线模型不可用时保持最小可回复体验。</p>
        <div class="mt-4 divide-y divide-glass-border rounded-card border border-glass-border">
          <div class="grid min-h-[58px] gap-4 px-4 py-3 md:grid-cols-[1fr_auto] md:items-center">
            <div>
              <div class="font-semibold text-text-main">当所有 Provider 不可用时</div>
              <div class="mt-1 text-sm text-text-sub">选择本地模型、演示模式或直接报错</div>
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
              <div class="font-semibold text-text-main">Ollama 备用模型</div>
              <div class="mt-1 text-sm text-text-sub">检测到本地模型后自动加入列表</div>
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
