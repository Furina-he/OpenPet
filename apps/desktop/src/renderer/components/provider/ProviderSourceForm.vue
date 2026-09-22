<!-- components/provider/ProviderSourceForm.vue — 供应商源配置（照 AstrBot AstrBotConfig 行布局：
     每行 = 左「名称 + 提示」| 右控件，行间分隔线）。「设置」= ID / API Key / API Base URL；
     「高级配置...」（常开、平铺，= AstrBot advancedSourceConfig）= 超时时间 / 代理地址 / 自定义请求头（ObjectEditor）
     / 关闭思考模式（ollama）；非对话源另含 启用 + 类型专属字段（嵌入维度带「自动检测」等）。
     受控组件：任何改动 emit 完整新 source（父侧据此判脏，保存前不落盘）。 -->
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { Eye, EyeOff } from 'lucide-vue-next';
import { providerConfigMeta, type ConfigItemMeta, type ProviderSource } from '@openpet/protocol';
import Input from '../Input.vue';
import Switch from '../Switch.vue';
import Button from '../Button.vue';
import ObjectEditor from '../config/widgets/ObjectEditor.vue';

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
const typeFields = computed<ConfigItemMeta[]>(() =>
  providerConfigMeta(props.modelValue.capability),
);
const showKey = ref(false);
/** ID 校验（改名时）：非空、无斜杠（模型 id = 源ID/模型名）、不与其他源撞。 */
const idError = computed(() => {
  const id = props.modelValue.id.trim();
  if (!id) return t('settings.providerUi.idRequired');
  if (id.includes('/')) return t('settings.providerUi.idNoSlash');
  if (props.takenIds?.some((x) => x === id && x !== props.originalId))
    return t('settings.providerUi.idTaken');
  return '';
});

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
watch(
  () => props.detectedDim,
  (v) => {
    if (typeof v === 'number' && v > 0) setCfg('dimensions', v);
  },
);
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
function setHeaders(v: Record<string, string>): void {
  const next = { ...props.modelValue };
  if (Object.keys(v).length) next.headers = v;
  else delete next.headers;
  emit('update:modelValue', next);
}
</script>

<template>
  <div>
    <!-- 设置 -->
    <section class="px-6 py-4">
      <div class="mb-1 text-base font-semibold text-text-main">
        {{ t('settings.providerUi.settings') }}
      </div>
      <div class="divide-y divide-glass-border">
        <div class="grid grid-cols-1 items-center gap-3 py-3 sm:grid-cols-2">
          <div class="min-w-0">
            <div class="text-sm font-medium text-text-main">ID</div>
            <div
              class="mt-0.5 text-xs"
              :class="idError ? '' : 'text-text-sub'"
              :style="idError ? { color: 'var(--ds-danger)' } : {}"
            >
              {{ idError || t('settings.providerUi.hintId') }}
            </div>
          </div>
          <Input :model-value="modelValue.id" @update:model-value="(v) => patch({ id: v })" />
        </div>
        <div v-if="!isChat" class="grid grid-cols-1 items-center gap-3 py-3 sm:grid-cols-2">
          <div class="min-w-0">
            <div class="text-sm font-medium text-text-main">{{ t('common.enabledShort') }}</div>
          </div>
          <div>
            <Switch
              :model-value="modelValue.enabled"
              @update:model-value="(v) => patch({ enabled: v })"
            />
          </div>
        </div>
        <div class="grid grid-cols-1 items-center gap-3 py-3 sm:grid-cols-2">
          <div class="min-w-0">
            <div class="text-sm font-medium text-text-main">API Key</div>
            <div class="mt-0.5 text-xs text-text-sub">{{ t('settings.providerUi.hintKey') }}</div>
          </div>
          <div class="ds-control flex items-center gap-2 rounded-input px-3 py-2">
            <input
              :value="modelValue.key"
              :type="showKey ? 'text' : 'password'"
              class="min-w-0 flex-1 bg-transparent text-base text-text-main outline-none"
              autocomplete="new-password"
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
        </div>
        <div class="grid grid-cols-1 items-center gap-3 py-3 sm:grid-cols-2">
          <div class="min-w-0">
            <div class="text-sm font-medium text-text-main">API Base URL</div>
            <div class="mt-0.5 text-xs text-text-sub">
              {{ t('settings.providerUi.hintApiBase') }}
            </div>
          </div>
          <Input
            :model-value="modelValue.apiBase"
            @update:model-value="(v) => patch({ apiBase: v })"
          />
        </div>
        <!-- 类型专属字段（非对话；embedding 维度带自动检测） -->
        <div
          v-for="f in typeFields"
          :key="f.key"
          class="grid grid-cols-1 items-center gap-3 py-3 sm:grid-cols-2"
        >
          <div class="min-w-0">
            <div class="text-sm font-medium text-text-main">{{ f.label || f.key }}</div>
            <div
              v-if="f.key === 'dimensions' && detectMsg"
              class="mt-0.5 text-xs"
              style="color: var(--ds-danger)"
            >
              {{ detectMsg }}
            </div>
            <div v-else-if="f.hint" class="mt-0.5 text-xs text-text-sub">{{ f.hint }}</div>
          </div>
          <div v-if="f.type === 'bool'">
            <Switch
              :model-value="modelValue.config?.[f.key] === true"
              @update:model-value="(v) => setCfg(f.key, v)"
            />
          </div>
          <div v-else-if="f.key === 'dimensions'" class="flex items-center gap-2">
            <div class="flex-1">
              <Input
                :model-value="cfgStr(f.key)"
                type="number"
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
            @update:model-value="(v) => setCfg(f.key, v)"
          />
        </div>
      </div>
    </section>

    <div class="border-t border-glass-border" />

    <!-- 高级配置...（照 AstrBot 常开平铺） -->
    <section class="px-6 py-4">
      <div class="mb-1 text-base font-semibold text-text-main">
        {{ t('settings.providerUi.advancedConfig') }}
      </div>
      <div class="divide-y divide-glass-border">
        <div class="grid grid-cols-1 items-center gap-3 py-3 sm:grid-cols-2">
          <div class="min-w-0">
            <div class="text-sm font-medium text-text-main">
              {{ t('settings.providerUi.timeout') }}
            </div>
            <div class="mt-0.5 text-xs text-text-sub">
              {{ t('settings.providerUi.timeoutDesc') }}
            </div>
          </div>
          <Input
            :model-value="timeoutSec"
            type="number"
            placeholder="120"
            @update:model-value="setTimeoutSec"
          />
        </div>
        <div class="grid grid-cols-1 items-center gap-3 py-3 sm:grid-cols-2">
          <div class="min-w-0">
            <div class="text-sm font-medium text-text-main">
              {{ t('settings.providerUi.proxy') }}
            </div>
            <div class="mt-0.5 text-xs text-text-sub">{{ t('settings.providerUi.proxyDesc') }}</div>
          </div>
          <Input :model-value="modelValue.proxy ?? ''" @update:model-value="setProxy" />
        </div>
        <div v-if="isChat" class="grid grid-cols-1 items-center gap-3 py-3 sm:grid-cols-2">
          <div class="min-w-0">
            <div class="text-sm font-medium text-text-main">
              {{ t('settings.providerUi.headers') }}
            </div>
            <div class="mt-0.5 text-xs text-text-sub">
              {{ t('settings.providerUi.headersDesc') }}
            </div>
          </div>
          <ObjectEditor
            :model-value="modelValue.headers ?? {}"
            :title="t('settings.providerUi.headers')"
            @update:model-value="setHeaders"
          />
        </div>
        <div
          v-if="isChat && modelValue.adapter === 'ollama'"
          class="grid grid-cols-1 items-center gap-3 py-3 sm:grid-cols-2"
        >
          <div class="min-w-0">
            <div class="text-sm font-medium text-text-main">
              {{ t('settings.providerUi.ollamaDisableThinking') }}
            </div>
            <div class="mt-0.5 text-xs text-text-sub">
              {{ t('settings.providerUi.ollamaDisableThinkingDesc') }}
            </div>
          </div>
          <div>
            <Switch
              :model-value="modelValue.ollamaDisableThinking === true"
              @update:model-value="(v) => patch({ ollamaDisableThinking: v })"
            />
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
