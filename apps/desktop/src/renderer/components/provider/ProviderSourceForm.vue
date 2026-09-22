<!-- components/provider/ProviderSourceForm.vue — 供应商源配置表单（照 AstrBot 右栏「设置」+「高级配置...」）。
     对话源：ID / API Key / API Base URL + 高级（超时/代理/headers/ollama）。
     非对话源：另含 启用 + 类型专属字段（嵌入维度带「自动检测」/ 音色 / 后缀 …）+ 超时/代理。
     受控组件：任何改动 emit 完整新 source（父侧据此判脏，保存前不落盘）。 -->
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { Eye, EyeOff, ChevronDown, ChevronRight } from 'lucide-vue-next';
import { providerConfigMeta, type ConfigItemMeta, type ProviderSource } from '@openpet/protocol';
import Input from '../Input.vue';
import Switch from '../Switch.vue';
import Button from '../Button.vue';
import ConfigItemRenderer from '../config/ConfigItemRenderer.vue';

const { t } = useI18n();
const props = defineProps<{
  modelValue: ProviderSource;
  detecting?: boolean;
  detectMsg?: string;
  detectedDim?: number;
  /** 改名校验：其他已存在的源 id + 本源原 id。 */
  takenIds?: string[];
  originalId?: string;
}>();
const emit = defineEmits<{
  'update:modelValue': [source: ProviderSource];
  autodetect: [source: ProviderSource];
}>();

const isChat = computed(() => props.modelValue.capability === 'chat');
/** ID 校验（改名时）：非空、无斜杠（模型 id = 源ID/模型名）、不与其他源撞。 */
const idError = computed(() => {
  const id = props.modelValue.id.trim();
  if (!id) return t('settings.providerUi.idRequired');
  if (id.includes('/')) return t('settings.providerUi.idNoSlash');
  if (props.takenIds?.some((x) => x === id && x !== props.originalId))
    return t('settings.providerUi.idTaken');
  return '';
});
const typeFields = computed<ConfigItemMeta[]>(() =>
  providerConfigMeta(props.modelValue.capability),
);
const showKey = ref(false);
const advancedOpen = ref(false);

function patch(p: Partial<ProviderSource>): void {
  emit('update:modelValue', { ...props.modelValue, ...p });
}
function setCfg(k: string, v: unknown): void {
  patch({ config: { ...(props.modelValue.config ?? {}), [k]: v } });
}
function cfgStr(k: string): string {
  const v = props.modelValue.config?.[k];
  return v === undefined || v === null ? '' : String(v);
}
// 父自动检测完成 → 回填维度。
watch(
  () => props.detectedDim,
  (v) => {
    if (typeof v === 'number' && v > 0) setCfg('dimensions', v);
  },
);

/** 高级配置平铺（照 AstrBot advancedSourceConfig 一次展开，不再套第二层折叠）：超时(秒)/代理/请求头/ollama。 */
const HEADERS_META: ConfigItemMeta = {
  key: 'headers',
  type: 'dict',
  advanced: false,
  readonly: false,
};
function setHeaders(v: unknown): void {
  const next = { ...props.modelValue };
  if (v && typeof v === 'object' && Object.keys(v as object).length)
    next.headers = v as Record<string, string>;
  else delete next.headers;
  emit('update:modelValue', next);
}
function setOllamaThinking(v: boolean): void {
  emit('update:modelValue', { ...props.modelValue, ollamaDisableThinking: v });
}
const timeoutSec = computed(() =>
  props.modelValue.timeoutMs !== undefined
    ? String(Math.round(props.modelValue.timeoutMs / 1000))
    : '',
);
function setTimeoutSec(v: string): void {
  const n = Number(v);
  const next = { ...props.modelValue };
  if (v === '' || !Number.isFinite(n) || n <= 0) delete next.timeoutMs;
  else next.timeoutMs = Math.round(n * 1000);
  emit('update:modelValue', next);
}
function setProxy(v: string): void {
  const next = { ...props.modelValue };
  if (v.trim()) next.proxy = v.trim();
  else delete next.proxy;
  emit('update:modelValue', next);
}
</script>

<template>
  <div>
    <!-- 设置 -->
    <section class="px-6 py-5">
      <div class="mb-3 text-base font-semibold text-text-main">
        {{ t('settings.providerUi.settings') }}
      </div>
      <div class="space-y-4">
        <label class="block">
          <span class="text-sm text-text-sub">ID</span>
          <Input
            :model-value="modelValue.id"
            class="mt-1 w-full"
            @update:model-value="(v) => patch({ id: v })"
          />
          <span
            class="mt-1 block text-xs"
            :class="idError ? '' : 'text-text-sub'"
            :style="idError ? { color: 'var(--ds-danger)' } : {}"
            >{{ idError || t('settings.providerUi.hintId') }}</span
          >
        </label>
        <div v-if="!isChat" class="flex items-center justify-between">
          <span class="text-sm text-text-sub">{{ t('common.enabledShort') }}</span>
          <Switch
            :model-value="modelValue.enabled"
            @update:model-value="(v) => patch({ enabled: v })"
          />
        </div>
        <label class="block">
          <span class="text-sm text-text-sub">API Key</span>
          <div class="ds-control mt-1 flex items-center gap-2 rounded-input px-3 py-2">
            <input
              :value="modelValue.key"
              :type="showKey ? 'text' : 'password'"
              class="min-w-0 flex-1 bg-transparent text-base text-text-main outline-none"
              placeholder="sk-..."
              autocomplete="off"
              spellcheck="false"
              @input="patch({ key: ($event.target as HTMLInputElement).value })"
            />
            <button
              class="ds-icon-button min-h-8 min-w-8 shrink-0"
              :title="t('settings.keyInput.toggleShow')"
              :aria-label="t('settings.keyInput.toggleShow')"
              @click="showKey = !showKey"
            >
              <component :is="showKey ? EyeOff : Eye" :size="16" :stroke-width="1.5" />
            </button>
          </div>
          <span class="mt-1 block text-xs text-text-sub">{{
            t('settings.providerUi.hintKey')
          }}</span>
        </label>
        <label class="block">
          <span class="text-sm text-text-sub">API Base URL</span>
          <Input
            :model-value="modelValue.apiBase"
            class="mt-1 w-full"
            placeholder="https://api.openai.com/v1"
            @update:model-value="(v) => patch({ apiBase: v })"
          />
          <span class="mt-1 block text-xs text-text-sub">{{
            t('settings.providerUi.hintApiBase')
          }}</span>
        </label>

        <!-- 类型专属字段（非对话；embedding 维度带自动检测） -->
        <div v-for="f in typeFields" :key="f.key" class="block">
          <span class="text-sm text-text-sub">{{ f.label || f.key }}</span>
          <div v-if="f.type === 'bool'" class="mt-1">
            <Switch
              :model-value="modelValue.config?.[f.key] === true"
              @update:model-value="(v) => setCfg(f.key, v)"
            />
          </div>
          <div v-else-if="f.key === 'dimensions'" class="mt-1 flex gap-2">
            <div class="flex-1">
              <Input
                :model-value="cfgStr(f.key)"
                placeholder="1024"
                @update:model-value="(v) => setCfg(f.key, v === '' ? undefined : Number(v))"
              />
            </div>
            <Button
              variant="secondary"
              :disabled="detecting"
              @click="emit('autodetect', modelValue)"
            >
              {{
                detecting ? t('settings.providerUi.testing') : t('settings.providerUi.autodetect')
              }}
            </Button>
          </div>
          <Input
            v-else
            :model-value="cfgStr(f.key)"
            class="mt-1 w-full"
            @update:model-value="(v) => setCfg(f.key, v)"
          />
          <span
            v-if="f.key === 'dimensions' && detectMsg"
            class="mt-1 block text-xs"
            style="color: var(--ds-danger)"
          >
            {{ detectMsg }}
          </span>
          <span v-else-if="f.hint" class="mt-1 block text-xs text-text-sub">{{ f.hint }}</span>
        </div>
      </div>
    </section>

    <div class="border-t border-glass-border" />

    <!-- 高级配置... -->
    <section class="px-6 py-4">
      <button
        class="flex items-center gap-1 text-base font-semibold text-text-main"
        :aria-expanded="advancedOpen"
        @click="advancedOpen = !advancedOpen"
      >
        <component
          :is="advancedOpen ? ChevronDown : ChevronRight"
          :size="16"
          :stroke-width="1.75"
        />
        {{ t('settings.providerUi.advancedConfig') }}
      </button>
      <div v-if="advancedOpen" class="mt-3 space-y-4">
        <label class="block">
          <span class="text-sm text-text-sub">{{ t('settings.providerUi.timeout') }}</span>
          <Input
            :model-value="timeoutSec"
            class="mt-1 w-full"
            placeholder="20"
            @update:model-value="setTimeoutSec"
          />
          <span class="mt-1 block text-xs text-text-sub">{{
            t('settings.providerUi.timeoutDesc')
          }}</span>
        </label>
        <label class="block">
          <span class="text-sm text-text-sub">{{ t('settings.providerUi.proxy') }}</span>
          <Input
            :model-value="modelValue.proxy ?? ''"
            class="mt-1 w-full"
            placeholder="http://127.0.0.1:7890"
            @update:model-value="setProxy"
          />
          <span class="mt-1 block text-xs text-text-sub">{{
            t('settings.providerUi.proxyDesc')
          }}</span>
        </label>
        <div v-if="isChat" class="block">
          <span class="text-sm text-text-sub">{{ t('settings.providerUi.headers') }}</span>
          <ConfigItemRenderer
            class="mt-1 block"
            :meta="HEADERS_META"
            :model-value="modelValue.headers ?? {}"
            @update:model-value="setHeaders"
          />
          <span class="mt-1 block text-xs text-text-sub">{{
            t('settings.providerUi.headersDesc')
          }}</span>
        </div>
        <div
          v-if="isChat && modelValue.adapter === 'ollama'"
          class="flex items-center justify-between"
        >
          <div>
            <div class="text-sm text-text-main">
              {{ t('settings.providerUi.ollamaDisableThinking') }}
            </div>
            <div class="mt-1 text-xs text-text-sub">
              {{ t('settings.providerUi.ollamaDisableThinkingDesc') }}
            </div>
          </div>
          <Switch
            :model-value="modelValue.ollamaDisableThinking === true"
            @update:model-value="setOllamaThinking"
          />
        </div>
      </div>
    </section>
  </div>
</template>
