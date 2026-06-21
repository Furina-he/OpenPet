<!-- settings/pages/ModelApiPage.vue — D3 模型 API（ui-design §7.3；参照 36b542fb + §2 token）
     provider-config 主体抽到 ProviderConfigPanel（C2 复用）。
     存而不接（渲染+持久，无 live 行为）：预算告警卡、离线兜底卡。 -->
<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import type { Prefs, PrefKey } from '@desksoul/protocol';
import { DEFAULT_PREFS } from '@desksoul/protocol';
import Switch from '../../components/Switch.vue';
import Select from '../../components/Select.vue';
import Slider from '../../components/Slider.vue';
import Input from '../../components/Input.vue';
import ProviderConfigPanel from '../../components/ProviderConfigPanel.vue';

const emit = defineEmits<{ saved: [] }>();

const prefs = ref<Prefs>({ ...DEFAULT_PREFS });
const ollamaModels = ref<string[]>([]); // 由 ProviderConfigPanel 的 @ollama-detected 回传

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

onMounted(async () => {
  prefs.value = (await window.desksoul.rpc('app.prefs.getAll', {})) as Prefs;
});

async function set<K extends PrefKey>(key: K, value: Prefs[K]): Promise<void> {
  prefs.value = { ...prefs.value, [key]: value };
  await window.desksoul.rpc('app.prefs.set', { key, value });
  emit('saved');
}
function onOllama(models: string[]): void {
  ollamaModels.value = models;
}
</script>

<template>
  <div class="w-full max-w-[1180px]">
    <ProviderConfigPanel class="mb-4" @saved="emit('saved')" @ollama-detected="onOllama" />

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
