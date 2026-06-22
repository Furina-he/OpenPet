<!-- components/provider/ProviderModelsPanel.vue — Provider 工作台右栏：选中 source 的配置 + models 表
     逻辑全在 provider-config-view（D1）+ 父发 RPC；本组件只渲染/转发。视觉对照 hifi brief + §2 token。 -->
<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import type { ModelCaps, ModelEntry, ProviderSource } from '@desksoul/protocol';
import { mergedModelEntries, capsBadges } from '../../settings/provider-config-view';
import Input from '../Input.vue';
import Switch from '../Switch.vue';
import KeyInput from '../KeyInput.vue';

const props = defineProps<{
  source: ProviderSource;
  models: ModelEntry[];
  available: string[];
  defaultModelId: string;
  testing: Record<string, boolean | null>;
  fetching: boolean;
  fetchMsg: string;
}>();
const emit = defineEmits<{
  saveSource: [source: ProviderSource];
  fetchModels: [source: ProviderSource];
  addModel: [model: string];
  deleteModel: [id: string];
  toggleModel: [payload: { id: string; enabled: boolean }];
  testModel: [id: string];
  setDefault: [id: string];
  updateCaps: [payload: { id: string; caps: ModelCaps }];
}>();

const apiBase = ref(props.source.apiBase);
const timeoutMs = ref(props.source.timeoutMs?.toString() ?? '');
const proxy = ref(props.source.proxy ?? '');
const showAdvanced = ref(false);

// 父切换选中 source 时，重置本地可编辑字段。
watch(
  () => props.source.id,
  () => {
    apiBase.value = props.source.apiBase;
    timeoutMs.value = props.source.timeoutMs?.toString() ?? '';
    proxy.value = props.source.proxy ?? '';
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
  return {
    id: props.source.id,
    adapter: props.source.adapter,
    capability: props.source.capability,
    apiBase: apiBase.value,
    key: keyOverride ?? props.source.key,
    enabled: props.source.enabled,
    ...(timeoutMs.value ? { timeoutMs: Number(timeoutMs.value) } : {}),
    ...(proxy.value ? { proxy: proxy.value } : {}),
    ...(props.source.headers ? { headers: props.source.headers } : {}),
    ...(props.source.ollamaDisableThinking !== undefined
      ? { ollamaDisableThinking: props.source.ollamaDisableThinking }
      : {}),
  };
}

function toggleCap(entry: ModelEntry, cap: keyof ModelCaps): void {
  emit('updateCaps', { id: entry.id, caps: { ...entry.caps, [cap]: !entry.caps[cap] } });
}

function testLabel(id: string): string {
  const t = props.testing[id];
  if (t === null) return '测试中…';
  if (t === true) return '✓ 可用';
  if (t === false) return '✗ 失败';
  return '测试';
}
</script>

<template>
  <div class="flex h-full flex-col gap-4">
    <!-- source 基础配置 -->
    <section class="rounded-card border border-glass-border p-4">
      <div class="flex items-center justify-between">
        <div>
          <div class="font-semibold text-text-main">{{ source.id }}</div>
          <div class="text-sm text-text-sub">{{ source.adapter }} · {{ source.capability }}</div>
        </div>
        <button
          class="rounded-btn px-4 py-2 text-base text-white"
          style="background: linear-gradient(135deg, var(--ds-brand-from), var(--ds-brand-to))"
          @click="emit('saveSource', buildSource())"
        >
          保存配置
        </button>
      </div>
      <div class="mt-3 space-y-3">
        <label class="block">
          <span class="text-sm text-text-sub">API Base URL</span>
          <Input v-model="apiBase" class="mt-1" placeholder="https://api.openai.com/v1" />
        </label>
        <label class="block">
          <span class="text-sm text-text-sub">API Key（明文随此源保存）</span>
          <KeyInput
            class="mt-1"
            :has-key="source.key !== ''"
            @save="(k) => emit('saveSource', buildSource(k))"
            @clear="() => emit('saveSource', buildSource(''))"
          />
        </label>
        <button class="text-sm text-text-sub underline" @click="showAdvanced = !showAdvanced">
          {{ showAdvanced ? '收起高级' : '高级选项（超时 / 代理）' }}
        </button>
        <div v-if="showAdvanced" class="grid grid-cols-2 gap-3">
          <label class="block">
            <span class="text-sm text-text-sub">超时 (ms)</span>
            <Input v-model="timeoutMs" class="mt-1" placeholder="30000" />
          </label>
          <label class="block">
            <span class="text-sm text-text-sub">代理</span>
            <Input v-model="proxy" class="mt-1" placeholder="http://127.0.0.1:7890" />
          </label>
        </div>
      </div>
    </section>

    <!-- models 表 -->
    <section class="flex min-h-0 flex-1 flex-col rounded-card border border-glass-border p-4">
      <div class="flex items-center justify-between">
        <h3 class="font-semibold text-text-main">Models</h3>
        <button
          class="rounded-btn border border-glass-border px-3 py-1.5 text-sm text-text-main transition hover:border-brand-to disabled:opacity-50"
          :disabled="fetching"
          @click="emit('fetchModels', buildSource())"
        >
          {{ fetching ? '拉取中…' : '拉取模型列表' }}
        </button>
      </div>
      <p v-if="fetchMsg" class="mt-1 text-sm text-text-sub">{{ fetchMsg }}</p>

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
              title="设为该能力默认"
              @change="emit('setDefault', e.entry.id)"
            />
            <div class="min-w-0 flex-1">
              <div class="truncate font-semibold text-text-main">{{ e.model }}</div>
              <div class="mt-1 flex flex-wrap gap-1">
                <button
                  v-for="c in CAP_KEYS"
                  :key="c.key"
                  class="rounded-full px-2 py-0.5 text-xs transition"
                  :class="
                    e.entry.caps[c.key]
                      ? 'text-white'
                      : 'border border-glass-border text-text-sub'
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
              title="删除该模型"
              @click="emit('deleteModel', e.entry.id)"
            >
              删除
            </button>
          </template>

          <!-- 上游可用、未配置 -->
          <template v-else>
            <div class="min-w-0 flex-1 truncate text-text-sub">{{ e.model }}</div>
            <button
              class="rounded-btn border border-glass-border px-3 py-1 text-sm text-text-main transition hover:border-brand-to"
              @click="emit('addModel', e.model)"
            >
              添加
            </button>
          </template>
        </div>

        <div v-if="!merged.length" class="px-3 py-6 text-center text-sm text-text-sub">
          还没有模型，点「拉取模型列表」或手动添加
        </div>
      </div>
    </section>
  </div>
</template>
