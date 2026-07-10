<!-- components/provider/ProviderModelsPanel.vue — Provider 工作台右栏：选中 source 的配置 + models 表
     逻辑全在 provider-config-view（D1）+ 父发 RPC；本组件只渲染/转发。视觉对照 hifi brief + §2 token。 -->
<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { ref, computed, watch } from 'vue';
import type { ModelCaps, ModelEntry, ProviderSource } from '@openpet/protocol';
import { sourceAdvancedMeta, providerConfigMeta } from '@openpet/protocol';
import { mergedModelEntries, capsBadges } from '../../settings/provider-config-view';
import Input from '../Input.vue';
import Switch from '../Switch.vue';
import KeyInput from '../KeyInput.vue';
import ConfigSectionRenderer from '../config/ConfigSectionRenderer.vue';

const { t } = useI18n();
const props = defineProps<{
  source: ProviderSource;
  models: ModelEntry[];
  available: string[];
  defaultModelId: string;
  testing: Record<string, boolean | null>;
  fetching: boolean;
  fetchMsg: string;
  sourceTesting?: boolean;
  sourceTestMsg?: string;
}>();
const emit = defineEmits<{
  saveSource: [source: ProviderSource];
  testSource: [source: ProviderSource];
  fetchModels: [source: ProviderSource];
  addModel: [model: string];
  deleteModel: [id: string];
  toggleModel: [payload: { id: string; enabled: boolean }];
  testModel: [id: string];
  setDefault: [id: string];
  updateCaps: [payload: { id: string; caps: ModelCaps }];
}>();

/** chat 走 models 表 + caps；非 chat 走类型专属字段（照 AstrBot 各 provider_type 配置不同）。 */
const isChat = computed(() => props.source.capability === 'chat');
const configMeta = computed(() => providerConfigMeta(props.source.capability));

const apiBase = ref(props.source.apiBase);
const config = ref<Record<string, unknown>>({ ...(props.source.config ?? {}) });
const manualModel = ref('');
function initAdvanced(): Record<string, unknown> {
  const s = props.source;
  return {
    ...(s.timeoutMs !== undefined ? { timeoutMs: s.timeoutMs } : {}),
    ...(s.proxy !== undefined ? { proxy: s.proxy } : {}),
    ...(s.headers !== undefined ? { headers: s.headers } : {}),
    ...(s.ollamaDisableThinking !== undefined
      ? { ollamaDisableThinking: s.ollamaDisableThinking }
      : {}),
  };
}
const advanced = ref<Record<string, unknown>>(initAdvanced());

// 父切换选中 source 时，重置本地可编辑字段。
watch(
  () => props.source.id,
  () => {
    apiBase.value = props.source.apiBase;
    advanced.value = initAdvanced();
    config.value = { ...(props.source.config ?? {}) };
    manualModel.value = '';
  },
);

const merged = computed(() => mergedModelEntries(props.models, props.available));

const CAP_KEYS: { key: keyof ModelCaps; label: string }[] = [
  { key: 'vision', label: 'vision' },
  { key: 'audio', label: 'audio' },
  { key: 'tool', label: 'tool' },
  { key: 'reasoning', label: 'reasoning' },
];

/** 从当前本地编辑态 + source 重建 ProviderSource（可覆盖 key）；省略空的可选字段以清除。 */
function buildSource(keyOverride?: string): ProviderSource {
  const a = advanced.value;
  const timeoutMs =
    typeof a.timeoutMs === 'number' ? a.timeoutMs : Number(a.timeoutMs) || undefined;
  const proxy = typeof a.proxy === 'string' && a.proxy ? a.proxy : undefined;
  const headers =
    a.headers && Object.keys(a.headers as object).length
      ? (a.headers as Record<string, string>)
      : undefined;
  return {
    id: props.source.id,
    adapter: props.source.adapter,
    capability: props.source.capability,
    apiBase: apiBase.value,
    key: keyOverride ?? props.source.key,
    enabled: props.source.enabled,
    name: props.source.name,
    icon: props.source.icon,
    ...(Object.keys(config.value).length ? { config: config.value } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(proxy !== undefined ? { proxy } : {}),
    ...(headers !== undefined ? { headers } : {}),
    ...(typeof a.ollamaDisableThinking === 'boolean'
      ? { ollamaDisableThinking: a.ollamaDisableThinking }
      : {}),
  };
}

function addManual(): void {
  const m = manualModel.value.trim();
  if (!m) return;
  emit('addModel', m);
  manualModel.value = '';
}

function toggleCap(entry: ModelEntry, cap: keyof ModelCaps): void {
  emit('updateCaps', { id: entry.id, caps: { ...entry.caps, [cap]: !entry.caps[cap] } });
}

function testLabel(id: string): string {
  const st = props.testing[id];
  if (st === null) return t('settings.providerUi.testing');
  if (st === true) return `✓ ${t('settings.providerUi.usable')}`;
  if (st === false) return `✗ ${t('settings.providerUi.failed')}`;
  return t('settings.providerUi.test');
}
</script>

<template>
  <div class="flex h-full flex-col gap-4">
    <!-- source 基础配置 -->
    <section class="rounded-card border border-glass-border p-4">
      <div class="flex items-center justify-between">
        <div>
          <div class="font-semibold text-text-main">{{ source.name || source.id }}</div>
          <div class="text-sm text-text-sub">{{ source.adapter }} · {{ source.capability }}</div>
        </div>
        <div class="flex items-center gap-2">
          <button
            class="rounded-btn border border-glass-border px-3 py-2 text-base text-text-main transition hover:border-brand-to disabled:opacity-50"
            :disabled="sourceTesting"
            @click="emit('testSource', buildSource())"
          >
            {{ sourceTesting ? t('settings.providerUi.testing') : t('settings.providerUi.testConnection') }}
          </button>
          <button
            class="rounded-btn px-4 py-2 text-base text-white"
            style="background: linear-gradient(135deg, var(--ds-brand-from), var(--ds-brand-to))"
            @click="emit('saveSource', buildSource())"
          >
            {{ t('settings.providerUi.saveConfig') }}
          </button>
        </div>
      </div>
      <p
        v-if="sourceTestMsg"
        class="mt-2 rounded-card px-3 py-1.5 text-sm"
        :style="{
          color: sourceTestMsg.startsWith('✓') ? 'var(--ds-success)' : 'var(--ds-danger)',
          background: 'var(--ds-warm-soft)',
        }"
      >
        {{ sourceTestMsg }}
      </p>
      <div class="mt-3 space-y-3">
        <label class="block">
          <span class="text-sm text-text-sub">API Base URL</span>
          <Input v-model="apiBase" class="mt-1" placeholder="https://api.openai.com/v1" />
        </label>
        <label class="block">
          <span class="text-sm text-text-sub">{{ t('settings.providerUi.apiKeyPlain') }}</span>
          <KeyInput
            class="mt-1"
            :has-key="source.key !== ''"
            @save="(k) => emit('saveSource', buildSource(k))"
            @clear="() => emit('saveSource', buildSource(''))"
          />
        </label>
        <!-- 类型专属配置（照 AstrBot 各 provider_type：embedding 维度 / tts 音色 / rerank 后缀 / agent 应用…） -->
        <ConfigSectionRenderer
          v-if="configMeta.length"
          :items="configMeta"
          :model-value="config"
          @update:model-value="(v) => (config = v)"
        />
        <!-- adapter 高级（timeout/proxy/headers）仅对话类有（非对话端点无此高级配置，照 AstrBot） -->
        <ConfigSectionRenderer
          v-if="isChat"
          :items="sourceAdvancedMeta(source.adapter)"
          :model-value="advanced"
          @update:model-value="(v) => (advanced = v)"
        />
      </div>
    </section>

    <!-- models 表 -->
    <section class="flex min-h-0 flex-1 flex-col rounded-card border border-glass-border p-4">
      <div class="flex items-center justify-between">
        <h3 class="font-semibold text-text-main">{{ isChat ? 'Models' : t('settings.providerUi.models') }}</h3>
        <button
          class="rounded-btn border border-glass-border px-3 py-1.5 text-sm text-text-main transition hover:border-brand-to disabled:opacity-50"
          :disabled="fetching"
          @click="emit('fetchModels', buildSource())"
        >
          {{ fetching ? t('settings.providerUi.fetching') : t('settings.providerUi.fetchModels') }}
        </button>
      </div>
      <p v-if="fetchMsg" class="mt-1 text-sm text-text-sub">{{ fetchMsg }}</p>

      <!-- 手动添加模型（非 chat 端点常不支持列模型，直接填名） -->
      <div class="mt-2 flex gap-2">
        <div class="flex-1">
          <Input
            v-model="manualModel"
            :placeholder="isChat ? t('settings.providerUi.addModelPlaceholder') : t('settings.providerUi.modelNamePlaceholder')"
            @keyup.enter="addManual"
          />
        </div>
        <button
          class="rounded-btn border border-glass-border px-3 text-sm text-text-main transition hover:border-brand-to"
          @click="addManual"
        >
          {{ t('common.add') }}
        </button>
      </div>

      <div class="mt-3 flex-1 space-y-1 overflow-auto">
        <div
          v-for="e in merged"
          :key="e.type === 'configured' ? e.entry.id : `avail:${e.model}`"
          class="flex items-center gap-3 rounded-card px-3 py-2"
          :class="e.type === 'configured' ? 'ds-glass' : 'border border-glass-border'"
        >
          <!-- 已配置模型 -->
          <template v-if="e.type === 'configured'">
            <input
              type="radio"
              name="default-model"
              :checked="e.entry.id === defaultModelId"
              :title="t('settings.providerUi.setDefault')"
              :aria-label="t('settings.providerUi.setDefault')"
              @change="emit('setDefault', e.entry.id)"
            />
            <div class="min-w-0 flex-1">
              <div class="truncate font-semibold text-text-main">{{ e.model }}</div>
              <div v-if="isChat" class="mt-1 flex flex-wrap gap-1">
                <button
                  v-for="c in CAP_KEYS"
                  :key="c.key"
                  class="rounded-full px-2 py-0.5 text-xs transition"
                  :class="
                    e.entry.caps[c.key] ? 'text-white' : 'border border-glass-border text-text-sub'
                  "
                  :style="
                    e.entry.caps[c.key]
                      ? 'background: linear-gradient(135deg, var(--ds-brand-from), var(--ds-brand-to))'
                      : ''
                  "
                  @click="toggleCap(e.entry, c.key)"
                >
                  {{ c.label }}
                </button>
                <span
                  v-for="b in capsBadges(e.entry.caps, e.entry.contextTokens).filter(
                    (x) => !CAP_KEYS.some((c) => c.label === x),
                  )"
                  :key="b"
                  class="rounded-full border border-glass-border px-2 py-0.5 text-xs text-text-sub"
                >
                  {{ b }}
                </span>
              </div>
            </div>
            <button
              class="rounded-btn px-2 py-1 text-sm"
              :style="{
                color:
                  testing[e.entry.id] === false
                    ? 'var(--ds-danger)'
                    : testing[e.entry.id] === true
                      ? 'var(--ds-success)'
                      : 'var(--ds-text-sub)',
              }"
              @click="emit('testModel', e.entry.id)"
            >
              {{ testLabel(e.entry.id) }}
            </button>
            <Switch
              :model-value="e.entry.enabled"
              @update:model-value="(v) => emit('toggleModel', { id: e.entry.id, enabled: v })"
            />
            <button
              class="text-sm text-text-sub"
              :title="t('settings.providerUi.deleteModel')"
              :aria-label="t('settings.providerUi.deleteModel')"
              @click="emit('deleteModel', e.entry.id)"
            >
              {{ t('common.delete') }}
            </button>
          </template>

          <!-- 上游可用、未配置 -->
          <template v-else>
            <div class="min-w-0 flex-1 truncate text-text-sub">{{ e.model }}</div>
            <button
              class="rounded-btn border border-glass-border px-3 py-1 text-sm text-text-main transition hover:border-brand-to"
              @click="emit('addModel', e.model)"
            >
              {{ t('common.add') }}
            </button>
          </template>
        </div>

        <div v-if="!merged.length" class="px-3 py-6 text-center text-sm text-text-sub">
          {{ t('settings.providerUi.noModels') }}
        </div>
      </div>
    </section>
  </div>
</template>
