<!-- components/provider/ProviderModelsPanel.vue — 模型面板（照 AstrBot ProviderModelsPanel）：
     工具条 = 「模型」+ 可用模型计数 / 搜索 / 「获取模型列表」（源有未保存改动时变「保存并获取模型」）/ 「自定义模型」；
     「已配置的模型」= 显示 ID + 模型名 + 能力徽标（图像/音频/工具/推理）+ 上下文 chip，行操作 = 启用开关 · 测试 · 配置 · 删除
     （openpet 额外：★ 设为该能力默认——AstrBot 在别处选默认，桌宠需要在此指定）；
     「可用模型」= 等宽模型名 + ＋。本组件只渲染/转发，逻辑在 provider-workbench.ts。 -->
<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  Brain,
  Download,
  Image,
  Music,
  Package,
  PencilLine,
  Plug,
  Plus,
  Search,
  SearchX,
  Settings,
  Star,
  Trash2,
  Wrench,
} from 'lucide-vue-next';
import type { ModelEntry } from '@openpet/protocol';
import Switch from '../Switch.vue';
import { capBadges, formatContextLimit, workbenchEntries } from '../../settings/provider-workbench';

const { t } = useI18n();
const props = defineProps<{
  models: ModelEntry[];
  available: string[];
  query: string;
  defaultModelId: string;
  loading: boolean;
  isSourceModified: boolean;
  /** 模型 id → null 测试中 / true 通过 / false 失败。 */
  testing: Record<string, boolean | null>;
  saving: string[];
}>();
const emit = defineEmits<{
  'update:query': [string];
  fetchModels: [];
  openManual: [];
  edit: [entry: ModelEntry];
  toggle: [payload: { id: string; enabled: boolean }];
  test: [entry: ModelEntry];
  delete: [entry: ModelEntry];
  add: [model: string];
  setDefault: [id: string];
}>();

const entries = computed(() => workbenchEntries(props.models, props.available, props.query));
const configured = computed(() =>
  entries.value.flatMap((e) => (e.type === 'configured' ? [e.entry] : [])),
);
const availableEntries = computed(() =>
  entries.value.flatMap((e) => (e.type === 'available' ? [e.model] : [])),
);
const ICONS = { vision: Image, audio: Music, tool: Wrench, reasoning: Brain } as const;
const LABEL_KEYS = {
  vision: 'settings.providerUi.capImage',
  audio: 'settings.providerUi.capAudio',
  tool: 'settings.providerUi.capTool',
  reasoning: 'settings.providerUi.capReasoning',
} as const;
const isSaving = (id: string): boolean => props.saving.includes(id);
</script>

<template>
  <div class="grid gap-4">
    <!-- 工具条 -->
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="shrink-0">
        <h3 class="text-md font-semibold text-text-main">{{ t('settings.providerUi.models') }}</h3>
        <small class="mt-1 block text-xs text-text-sub">
          {{ t('settings.providerUi.available') }} {{ available.length }}
        </small>
      </div>
      <div class="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
        <label
          class="ds-control flex min-w-[180px] max-w-[260px] flex-1 items-center gap-2 rounded-input px-3 py-1.5"
        >
          <Search :size="15" :stroke-width="1.5" class="shrink-0 text-text-sub" />
          <input
            :value="query"
            class="min-w-0 flex-1 bg-transparent text-sm text-text-main outline-none"
            :placeholder="t('settings.providerUi.searchModels')"
            @input="emit('update:query', ($event.target as HTMLInputElement).value)"
          />
        </label>
        <button
          class="flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium text-white transition disabled:opacity-50"
          style="background: linear-gradient(135deg, var(--ds-brand-from), var(--ds-brand-to))"
          :disabled="loading"
          @click="emit('fetchModels')"
        >
          <Download :size="15" :stroke-width="1.75" />
          {{
            loading
              ? t('settings.providerUi.fetching')
              : isSourceModified
                ? t('settings.providerUi.saveAndFetchModels')
                : t('settings.providerUi.fetchModels')
          }}
        </button>
        <button
          class="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition hover:bg-glass-border/60"
          :style="{ color: 'var(--ds-brand-to)' }"
          @click="emit('openManual')"
        >
          <PencilLine :size="15" :stroke-width="1.75" />
          {{ t('settings.providerUi.manualAddButton') }}
        </button>
      </div>
    </div>

    <!-- 已配置的模型 -->
    <section>
      <div class="mb-3 flex items-center justify-between">
        <div class="text-sm font-semibold text-text-main">
          {{ t('settings.providerUi.configured') }}
        </div>
        <span
          class="rounded bg-glass-border px-1.5 py-0.5 text-[11px] tabular-nums text-text-sub"
          >{{ configured.length }}</span
        >
      </div>
      <div v-if="configured.length" class="flex flex-col">
        <div
          v-for="m in configured"
          :key="m.id"
          class="flex items-center justify-between gap-3 border-b border-glass-border py-3 last:border-0"
        >
          <button
            class="min-w-0 flex-1 text-left"
            :title="`${t('settings.providerUi.tipProviderId')}: ${m.id}`"
            @click="emit('edit', m)"
          >
            <div class="flex items-center gap-1.5">
              <span class="truncate text-sm font-semibold text-text-main">{{ m.id }}</span>
              <span
                v-if="m.id === defaultModelId"
                class="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium text-white"
                style="
                  background: linear-gradient(135deg, var(--ds-brand-from), var(--ds-brand-to));
                "
              >
                {{ t('settings.providerUi.defaultTag') }}
              </span>
            </div>
            <div class="mt-1 text-xs text-text-sub">{{ m.model }}</div>
            <div class="mt-2 flex flex-wrap items-center gap-1.5">
              <span
                v-for="b in capBadges(m.caps)"
                :key="b.key"
                class="grid h-6 w-6 place-items-center rounded-full"
                :class="
                  b.enabled
                    ? 'bg-glass-border text-text-main'
                    : 'bg-glass-border/40 text-text-sub opacity-50'
                "
                :title="
                  b.enabled
                    ? t('settings.providerUi.capEnabled', { capability: t(LABEL_KEYS[b.key]) })
                    : t('settings.providerUi.capDisabled', { capability: t(LABEL_KEYS[b.key]) })
                "
              >
                <component :is="ICONS[b.key]" :size="13" :stroke-width="1.75" />
              </span>
              <span
                v-if="formatContextLimit(m.contextTokens)"
                class="rounded-full bg-glass-border px-2 py-0.5 text-[11px] font-semibold text-text-main"
                :title="
                  t('settings.providerUi.contextTip', {
                    tokens: formatContextLimit(m.contextTokens),
                  })
                "
              >
                {{ formatContextLimit(m.contextTokens) }}
              </span>
            </div>
          </button>
          <div class="flex shrink-0 items-center gap-0.5">
            <Switch
              :model-value="m.enabled"
              :disabled="isSaving(m.id)"
              @update:model-value="(v) => emit('toggle', { id: m.id, enabled: v })"
            />
            <button
              class="ds-icon-button min-h-8 min-w-8"
              :class="m.id === defaultModelId ? '' : 'opacity-60'"
              :style="m.id === defaultModelId ? { color: 'var(--ds-brand-to)' } : {}"
              :title="t('settings.providerUi.setDefault')"
              :aria-label="t('settings.providerUi.setDefault')"
              :disabled="!m.enabled"
              @click="emit('setDefault', m.id)"
            >
              <Star
                :size="16"
                :stroke-width="1.5"
                :fill="m.id === defaultModelId ? 'currentColor' : 'none'"
              />
            </button>
            <button
              class="ds-icon-button min-h-8 min-w-8 disabled:opacity-40"
              :style="{
                color:
                  testing[m.id] === true
                    ? 'var(--ds-success)'
                    : testing[m.id] === false
                      ? 'var(--ds-danger)'
                      : '',
              }"
              :title="t('settings.providerUi.testButton')"
              :aria-label="t('settings.providerUi.testButton')"
              :disabled="!m.enabled || isSaving(m.id) || testing[m.id] === null"
              @click="emit('test', m)"
            >
              <Plug
                :size="16"
                :stroke-width="1.5"
                :class="testing[m.id] === null ? 'animate-pulse' : ''"
              />
            </button>
            <button
              class="ds-icon-button min-h-8 min-w-8"
              :title="t('settings.providerUi.configure')"
              :aria-label="t('settings.providerUi.configure')"
              @click="emit('edit', m)"
            >
              <Settings :size="16" :stroke-width="1.5" />
            </button>
            <button
              class="ds-icon-button min-h-8 min-w-8"
              :title="t('common.delete')"
              :aria-label="t('common.delete')"
              @click="emit('delete', m)"
            >
              <Trash2 :size="16" :stroke-width="1.5" />
            </button>
          </div>
        </div>
      </div>
      <div
        v-else
        class="flex min-h-[160px] flex-col items-center justify-center gap-3 text-center text-sm text-text-sub"
      >
        <Package :size="36" :stroke-width="1.25" class="opacity-60" />
        <p>{{ t('settings.providerUi.noConfigured') }}</p>
      </div>
    </section>

    <div class="border-t border-glass-border" />

    <!-- 可用模型 -->
    <section>
      <div class="mb-3 flex items-center justify-between">
        <div class="text-sm font-semibold text-text-main">
          {{ t('settings.providerUi.available') }}
        </div>
        <span
          class="rounded bg-glass-border px-1.5 py-0.5 text-[11px] tabular-nums text-text-sub"
          >{{ availableEntries.length }}</span
        >
      </div>
      <div
        v-if="availableEntries.length"
        class="flex max-h-[min(420px,52vh)] flex-col overflow-y-auto pr-1"
      >
        <div
          v-for="model in availableEntries"
          :key="model"
          class="flex items-center justify-between gap-3 border-b border-glass-border py-3 last:border-0"
        >
          <button
            class="min-w-0 flex-1 truncate text-left font-mono text-sm font-semibold text-text-main"
            :title="`${t('settings.providerUi.tipModelId')}: ${model}`"
            @click="emit('add', model)"
          >
            {{ model }}
          </button>
          <button
            class="ds-icon-button min-h-8 min-w-8 shrink-0"
            :style="{ color: 'var(--ds-brand-to)' }"
            :title="t('common.add')"
            :aria-label="t('common.add')"
            @click="emit('add', model)"
          >
            <Plus :size="16" :stroke-width="1.75" />
          </button>
        </div>
      </div>
      <div
        v-else
        class="flex min-h-[120px] flex-col items-center justify-center gap-3 text-center text-sm text-text-sub"
      >
        <SearchX :size="36" :stroke-width="1.25" class="opacity-60" />
        <p>{{ t('settings.providerUi.noModelsFound') }}</p>
      </div>
    </section>
  </div>
</template>
