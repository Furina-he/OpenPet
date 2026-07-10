<!-- apps/desktop/src/renderer/components/ProviderConfigPanel.vue
     C2 首启引导用的精简 Provider 配置（两层 Source+Model）：
       建 1 个 chat source（adapter 模板）→ 填 Key/Base URL → 拉模型 → 选 1 个模型设为 chat 默认。
     逻辑复用 provider-config-view（D1）+ provider.* RPC（与 D4 工作台同源）。 -->
<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { computed, onMounted, ref } from 'vue';
import {
  generateUniqueSourceId,
  modelEntryId,
  type AdapterTemplate,
  type ModelEntry,
  type ProviderSource,
} from '@openpet/protocol';
import { mergedModelEntries } from '../settings/provider-config-view';
import KeyInput from './KeyInput.vue';
import Input from './Input.vue';

const { t } = useI18n();
const emit = defineEmits<{ saved: [] }>();

const sources = ref<ProviderSource[]>([]);
const models = ref<ModelEntry[]>([]);
const templates = ref<AdapterTemplate[]>([]);
const activeId = ref('');
const available = ref<string[]>([]);
const baseUrlDraft = ref('');
const defaultChatModelId = ref('');
const picking = ref(false);
const msg = ref('');

const chatTemplates = computed(() => templates.value.filter((t) => t.capability === 'chat'));
const chatSources = computed(() => sources.value.filter((s) => s.capability === 'chat'));
const activeSource = computed(
  () => chatSources.value.find((s) => s.id === activeId.value) ?? chatSources.value[0],
);
const configuredModels = computed(() => {
  const s = activeSource.value;
  return s ? models.value.filter((m) => m.sourceId === s.id) : [];
});
const merged = computed(() => mergedModelEntries(configuredModels.value, available.value));
const showPicker = computed(() => picking.value || !activeSource.value);

async function reload(): Promise<void> {
  const cfg = await window.openpet.rpc('provider.getConfig', {});
  sources.value = cfg.sources;
  models.value = cfg.models;
  templates.value = cfg.templates;
  if (!chatSources.value.some((s) => s.id === activeId.value)) {
    activeId.value = chatSources.value[0]?.id ?? '';
  }
  if (activeSource.value) baseUrlDraft.value = activeSource.value.apiBase;
}
async function reloadPrefs(): Promise<void> {
  const prefs = await window.openpet.rpc('app.prefs.getAll', {});
  defaultChatModelId.value = prefs['model.defaultChatModelId'];
}

onMounted(async () => {
  await reload();
  await reloadPrefs();
});

async function createSource(tpl: AdapterTemplate): Promise<void> {
  const id = generateUniqueSourceId(
    tpl.adapter,
    sources.value.map((s) => s.id),
  );
  await window.openpet.rpc('provider.upsertSource', {
    source: {
      id,
      adapter: tpl.adapter,
      capability: 'chat',
      apiBase: tpl.defaultApiBase,
      key: '',
      enabled: true,
      name: tpl.label,
      icon: tpl.adapter, // 4 内置格式键命中 providerIconUrl
    },
  });
  picking.value = false;
  available.value = [];
  msg.value = '';
  await reload();
  activeId.value = id;
  baseUrlDraft.value = tpl.defaultApiBase;
  emit('saved');
}
async function applyBaseUrl(): Promise<void> {
  const s = activeSource.value;
  if (!s) return;
  await window.openpet.rpc('provider.upsertSource', {
    source: { ...s, apiBase: baseUrlDraft.value },
  });
  await reload();
  emit('saved');
}
async function saveKey(k: string): Promise<void> {
  const s = activeSource.value;
  if (!s) return;
  await window.openpet.rpc('provider.upsertSource', { source: { ...s, key: k } });
  await reload();
  emit('saved');
}
async function clearKey(): Promise<void> {
  await saveKey('');
}
async function fetchModels(): Promise<void> {
  const s = activeSource.value;
  if (!s) return;
  msg.value = t('settings.providerUi.fetching');
  try {
    const r = await window.openpet.rpc('provider.fetchModels', { sourceId: s.id });
    available.value = r.models;
    msg.value = r.models.length ? t('settings.model.fetchCount', { count: r.models.length }) : t('settings.providerUi.noModelsFound');
  } catch (e) {
    msg.value = t('settings.model.fetchFail', { detail: e instanceof Error ? e.message : String(e) });
  }
}
async function pickModel(model: string): Promise<void> {
  const s = activeSource.value;
  if (!s) return;
  const id = modelEntryId(s.id, model);
  if (!configuredModels.value.some((m) => m.id === id)) {
    await window.openpet.rpc('provider.addModel', {
      entry: { id, sourceId: s.id, model, enabled: true, caps: {} },
    });
  }
  await window.openpet.rpc('provider.setDefault', { capability: 'chat', modelId: id });
  await reload();
  await reloadPrefs();
  emit('saved');
}
</script>

<template>
  <section class="ds-glass rounded-panel p-5">
    <h2 class="text-md font-semibold text-text-main">{{ t('settings.providerUi.setupChatTitle') }}</h2>
    <p class="mt-1 text-sm text-text-sub">
      {{ t('settings.providerUi.setupChatDesc') }}
    </p>

    <!-- 选/换提供商源 -->
    <div v-if="showPicker" class="mt-4 grid grid-cols-2 gap-3">
      <button
        v-for="t in chatTemplates"
        :key="t.adapter"
        class="ds-glass rounded-card border border-glass-border p-3 text-left transition hover:border-brand-to"
        @click="createSource(t)"
      >
        <div class="font-semibold text-text-main">{{ t.label }}</div>
        <div class="mt-1 truncate text-sm text-text-sub">{{ t.defaultApiBase }}</div>
      </button>
    </div>

    <!-- 选中源的配置 -->
    <div v-else-if="activeSource" class="mt-4 space-y-3">
      <div class="flex items-center justify-between">
        <div>
          <div class="font-semibold text-text-main">{{ activeSource.name || activeSource.id }}</div>
          <div class="text-sm text-text-sub">{{ activeSource.adapter }}</div>
        </div>
        <button class="text-sm text-text-sub underline" @click="picking = true">{{ t('settings.providerUi.changeOne') }}</button>
      </div>

      <label class="block">
        <span class="text-sm text-text-sub">API Base URL</span>
        <div class="mt-1 grid grid-cols-[1fr_auto] gap-2">
          <Input v-model="baseUrlDraft" placeholder="https://api.openai.com/v1" />
          <button
            class="rounded-btn border border-glass-border px-3 text-sm text-text-main transition hover:border-brand-to"
            @click="applyBaseUrl"
          >
            {{ t('settings.providerUi.apply') }}
          </button>
        </div>
      </label>

      <label class="block">
        <span class="text-sm text-text-sub">{{ t('settings.providerUi.apiKeyPlain') }}</span>
        <KeyInput
          class="mt-1"
          :has-key="activeSource.key !== ''"
          @save="saveKey"
          @clear="clearKey"
        />
      </label>

      <button
        class="rounded-btn border border-glass-border px-3 py-2 text-base text-text-main transition hover:border-brand-to"
        @click="fetchModels"
      >
        {{ t('settings.providerUi.fetchModels') }}
      </button>
      <p v-if="msg" class="text-sm text-text-sub">{{ msg }}</p>

      <div v-if="merged.length" class="flex flex-wrap gap-2">
        <button
          v-for="e in merged"
          :key="e.type === 'configured' ? e.entry.id : `avail:${e.model}`"
          class="rounded-full border px-3 py-1.5 text-base transition"
          :class="
            (e.type === 'configured' ? e.entry.id : modelEntryId(activeSource.id, e.model)) ===
            defaultChatModelId
              ? 'border-brand-to text-text-main'
              : 'border-glass-border text-text-sub hover:text-text-main'
          "
          @click="pickModel(e.model)"
        >
          {{ e.model }}
        </button>
      </div>
    </div>
  </section>
</template>
