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

async function setPref(
  key: 'model.activeProvider' | 'model.activeModel',
  value: string,
): Promise<void> {
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
