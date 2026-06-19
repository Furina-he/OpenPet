<!-- settings/pages/ModelApiPage.vue — D3 模型 API（ui-design §7.3；参照 36b542fb + §2 token）
     provider-config 主体抽到 ProviderConfigPanel（C2 复用）。
     存而不接（渲染+持久，无 live 行为）：预算告警卡、离线兜底卡。 -->
<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import type { Prefs, PrefKey } from '@desksoul/protocol';
import { DEFAULT_PREFS } from '@desksoul/protocol';
import SettingSection from '../../components/SettingSection.vue';
import SettingCard from '../../components/SettingCard.vue';
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
  <div class="max-w-[840px]">
    <ProviderConfigPanel class="mb-4" @saved="emit('saved')" @ollama-detected="onOllama" />

    <SettingSection title="预算与告警">
      <SettingCard label="启用预算告警">
        <Switch
          :model-value="prefs['budget.enabled']"
          @update:model-value="(v) => set('budget.enabled', v)"
        />
      </SettingCard>
      <SettingCard label="本月预算上限" description="¥ / 月">
        <Input
          :model-value="String(prefs['budget.monthlyCap'])"
          @update:model-value="(v) => set('budget.monthlyCap', Math.max(0, Number(v) || 0))"
        />
      </SettingCard>
      <SettingCard label="已使用" description="本期暂无用量计量源">
        <span class="text-base text-text-sub">¥0.00 / —</span>
      </SettingCard>
      <SettingCard label="告警阈值" :description="`达到 ${prefs['budget.warnAt']}% 时提醒`">
        <Slider
          :model-value="prefs['budget.warnAt']"
          :min="0"
          :max="100"
          min-label="0%"
          max-label="100%"
          @update:model-value="(v) => set('budget.warnAt', v)"
        />
      </SettingCard>
      <SettingCard label="达到上限时">
        <Select
          :model-value="prefs['budget.onExceed']"
          :options="EXCEED"
          @update:model-value="(v) => set('budget.onExceed', v as Prefs['budget.onExceed'])"
        />
      </SettingCard>
    </SettingSection>

    <SettingSection title="离线兜底">
      <SettingCard label="当所有 Provider 不可用时">
        <Select
          :model-value="prefs['offline.fallbackMode']"
          :options="FALLBACK"
          @update:model-value="
            (v) => set('offline.fallbackMode', v as Prefs['offline.fallbackMode'])
          "
        />
      </SettingCard>
      <SettingCard label="Ollama 备用模型" indent>
        <Select
          :model-value="prefs['offline.ollamaModel']"
          :options="ollamaOptions"
          @update:model-value="(v) => set('offline.ollamaModel', v)"
        />
      </SettingCard>
    </SettingSection>
  </div>
</template>
