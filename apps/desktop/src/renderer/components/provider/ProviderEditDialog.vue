<!-- components/provider/ProviderEditDialog.vue — 非对话 provider 的编辑/新增弹窗
     **照 AstrBot AstrBotConfig 编辑弹窗**（截图 1）：ID/启用/API Key/API Base URL + 类型专属字段
     （嵌入模型/维度+自动检测 / 音色 / 后缀…）+ 超时/代理，平铺带标签与提示。取消/保存。 -->
<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { computed, ref, watch } from 'vue';
import { providerConfigMeta, type ProviderSource, type ConfigItemMeta } from '@openpet/protocol';
import Input from '../Input.vue';
import Switch from '../Switch.vue';
import Button from '../Button.vue';

const { t } = useI18n();
const props = defineProps<{
  open: boolean;
  source: ProviderSource | null;
  mode: 'add' | 'edit';
  /** 嵌入维度自动检测中。 */
  detecting?: boolean;
  /** 自动检测回填的维度（父检测完成后传入）。 */
  detectedDim?: number;
  /** 自动检测的错误/状态提示。 */
  detectMsg?: string;
  /** 测试连接中 / 结果。 */
  testing?: boolean;
  testMsg?: string;
}>();
const emit = defineEmits<{
  save: [source: ProviderSource];
  autodetect: [source: ProviderSource];
  test: [source: ProviderSource];
  cancel: [];
}>();

// 本地表单（config 平铺）
const enabled = ref(true);
const key = ref('');
const apiBase = ref('');
const timeoutSec = ref<number | ''>('');
const proxy = ref('');
const cfg = ref<Record<string, unknown>>({});

const typeFields = computed<ConfigItemMeta[]>(() =>
  props.source ? providerConfigMeta(props.source.capability) : [],
);
const title = computed(() =>
  props.source
    ? t('settings.providerUi.editDialogTitle', { action: props.mode === 'add' ? t('settings.providerUi.actionAdd') : t('common.edit'), name: props.source.name || props.source.id })
    : '',
);

watch(
  () => [props.open, props.source?.id] as const,
  () => {
    const s = props.source;
    if (!props.open || !s) return;
    enabled.value = s.enabled;
    key.value = s.key;
    apiBase.value = s.apiBase;
    timeoutSec.value = s.timeoutMs !== undefined ? Math.round(s.timeoutMs / 1000) : '';
    proxy.value = s.proxy ?? '';
    cfg.value = { ...(s.config ?? {}) };
  },
  { immediate: true },
);

function setField(k: string, v: unknown): void {
  cfg.value = { ...cfg.value, [k]: v };
}
// 父自动检测完成 → 回填维度。
watch(
  () => props.detectedDim,
  (v) => {
    if (typeof v === 'number' && v > 0) setField('dimensions', v);
  },
);
function fieldStr(k: string): string {
  const v = cfg.value[k];
  return v === undefined || v === null ? '' : String(v);
}

function collect(): ProviderSource | null {
  const s = props.source;
  if (!s) return null;
  const t = typeof timeoutSec.value === 'number' ? timeoutSec.value : Number(timeoutSec.value);
  return {
    id: s.id,
    adapter: s.adapter,
    capability: s.capability,
    apiBase: apiBase.value.trim(),
    key: key.value,
    enabled: enabled.value,
    ...(s.name ? { name: s.name } : {}),
    ...(s.icon ? { icon: s.icon } : {}),
    ...(Object.keys(cfg.value).length ? { config: cfg.value } : {}),
    ...(Number.isFinite(t) && t > 0 ? { timeoutMs: Math.round(t * 1000) } : {}),
    ...(proxy.value.trim() ? { proxy: proxy.value.trim() } : {}),
  };
}
function save(): void {
  const s = collect();
  if (s) emit('save', s);
}
function autodetect(): void {
  const s = collect();
  if (s) emit('autodetect', s);
}
function test(): void {
  const s = collect();
  if (s) emit('test', s);
}
</script>

<template>
  <div
    v-if="open && source"
    class="fixed inset-0 z-[60] flex items-center justify-center"
    style="background: rgba(0, 0, 0, 0.32)"
    @click.self="emit('cancel')"
  >
    <div class="ds-glass max-h-[90vh] w-[680px] overflow-y-auto rounded-panel p-6">
      <h2 class="text-lg font-semibold text-text-main">{{ title }}</h2>

      <div class="mt-5 divide-y divide-glass-border">
        <!-- ID（只读） -->
        <div class="grid grid-cols-[200px_1fr] items-center gap-4 py-3">
          <div class="font-semibold text-text-main">ID</div>
          <Input :model-value="source.id" class="w-full" @update:model-value="() => {}" />
        </div>
        <!-- 启用 -->
        <div class="grid grid-cols-[200px_1fr] items-center gap-4 py-3">
          <div class="font-semibold text-text-main">{{ t('common.enabledShort') }}</div>
          <div><Switch :model-value="enabled" @update:model-value="(v) => (enabled = v)" /></div>
        </div>
        <!-- API Key -->
        <div class="grid grid-cols-[200px_1fr] items-center gap-4 py-3">
          <div class="font-semibold text-text-main">API Key</div>
          <Input v-model="key" class="w-full" placeholder="sk-…" />
        </div>
        <!-- API Base URL -->
        <div class="grid grid-cols-[200px_1fr] items-start gap-4 py-3">
          <div>
            <div class="font-semibold text-text-main">API Base URL</div>
            <div class="mt-1 text-sm text-text-sub">
              {{ t('settings.providerUi.baseUrlHint') }}
            </div>
          </div>
          <Input v-model="apiBase" class="w-full" placeholder="https://api.openai.com/v1" />
        </div>

        <!-- 类型专属字段（embedding 维度带「自动检测」） -->
        <div
          v-for="f in typeFields"
          :key="f.key"
          class="grid grid-cols-[200px_1fr] items-start gap-4 py-3"
        >
          <div>
            <div class="font-semibold text-text-main">{{ f.label || f.key }}</div>
            <div v-if="f.hint" class="mt-1 text-sm text-text-sub">{{ f.hint }}</div>
          </div>
          <div>
            <div v-if="f.type === 'bool'">
              <Switch
                :model-value="cfg[f.key] === true"
                @update:model-value="(v) => setField(f.key, v)"
              />
            </div>
            <div v-else-if="f.key === 'dimensions'">
              <div class="flex gap-2">
                <div class="flex-1">
                  <Input
                    :model-value="fieldStr(f.key)"
                    placeholder="1024"
                    @update:model-value="(v) => setField(f.key, v === '' ? undefined : Number(v))"
                  />
                </div>
                <Button variant="secondary" :disabled="detecting" @click="autodetect">
                  {{ detecting ? t('settings.providerUi.testing') : t('settings.providerUi.autodetect') }}
                </Button>
              </div>
              <p v-if="detectMsg" class="mt-1 text-sm" :style="{ color: 'var(--ds-danger)' }">
                {{ detectMsg }}
              </p>
            </div>
            <Input
              v-else
              :model-value="fieldStr(f.key)"
              class="w-full"
              @update:model-value="(v) => setField(f.key, v)"
            />
          </div>
        </div>

        <!-- 超时时间 -->
        <div class="grid grid-cols-[200px_1fr] items-start gap-4 py-3">
          <div>
            <div class="font-semibold text-text-main">{{ t('settings.providerUi.timeout') }}</div>
            <div class="mt-1 text-sm text-text-sub">{{ t('settings.providerUi.timeoutDesc') }}</div>
          </div>
          <Input
            :model-value="String(timeoutSec)"
            class="w-full"
            placeholder="20"
            @update:model-value="(v) => (timeoutSec = v === '' ? '' : Number(v))"
          />
        </div>
        <!-- 代理地址 -->
        <div class="grid grid-cols-[200px_1fr] items-start gap-4 py-3">
          <div>
            <div class="font-semibold text-text-main">{{ t('settings.providerUi.proxy') }}</div>
            <div class="mt-1 text-sm text-text-sub">
              {{ t('settings.providerUi.proxyDesc') }}
            </div>
          </div>
          <Input v-model="proxy" class="w-full" placeholder="http://127.0.0.1:7890" />
        </div>
      </div>

      <div class="mt-6 flex items-center justify-between gap-3">
        <div class="flex min-w-0 items-center gap-2">
          <Button variant="secondary" :disabled="testing" @click="test">
            {{ testing ? t('settings.providerUi.testing') : t('settings.providerUi.testConnection') }}
          </Button>
          <span
            v-if="testMsg"
            class="truncate text-sm"
            :style="{ color: testMsg.startsWith('✓') ? 'var(--ds-success)' : 'var(--ds-danger)' }"
          >
            {{ testMsg }}
          </span>
        </div>
        <div class="flex shrink-0 gap-2">
          <Button variant="ghost" @click="emit('cancel')">{{ t('common.cancel') }}</Button>
          <Button variant="primary" @click="save">{{ t('common.save') }}</Button>
        </div>
      </div>
    </div>
  </div>
</template>
