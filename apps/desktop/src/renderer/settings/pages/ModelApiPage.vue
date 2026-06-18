<!-- settings/pages/ModelApiPage.vue — D3 模型 API 双栏（ui-design §7.3；参照 1d7669e3 + §2 token）
     做实：provider 列表+状态点 / 选 provider→activeProvider / Key 配置 / 默认模型→activeModel /
           测试连接 / Ollama 检测（chat.send 动态解析见 chat-service）。
     存而不接（渲染+持久，无 live 行为）：Endpoint 只读、预算告警卡、离线兜底卡。 -->
<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import type { Prefs, PrefKey } from '@desksoul/protocol';
import { DEFAULT_PREFS, getDialect } from '@desksoul/protocol';
import SettingSection from '../../components/SettingSection.vue';
import SettingCard from '../../components/SettingCard.vue';
import Switch from '../../components/Switch.vue';
import Select from '../../components/Select.vue';
import Slider from '../../components/Slider.vue';
import Input from '../../components/Input.vue';
import ProviderList from '../../components/ProviderList.vue';
import KeyInput from '../../components/KeyInput.vue';

const emit = defineEmits<{ saved: [] }>();

interface ProviderRow {
  id: string;
  name: string;
  kind: 'chat' | 'embedding';
  hasKey: boolean;
  enabled: boolean;
  models: string[];
}

const prefs = ref<Prefs>({ ...DEFAULT_PREFS });
const providers = ref<ProviderRow[]>([]);
const testOk = ref<Record<string, boolean | null>>({}); // 会话内测试结果（不持久）
const ollamaModels = ref<string[]>([]); // ollamaDetect 结果
const testMsg = ref(''); // [测试连接] 文案

const FORMAT_LABEL: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Gemini',
  ollama: 'Ollama',
};
const EXCEED = [
  { value: 'warn', label: '提醒' },
  { value: 'pause', label: '提醒并暂停' },
];
const FALLBACK = [
  { value: 'ollama', label: '切换到本地模型 (Ollama)' },
  { value: 'demo', label: '使用预设台词（演示模式）' },
  { value: 'error', label: '直接报错让我手动处理' },
];

const activeId = computed(() => prefs.value['model.activeProvider'] || providers.value[0]?.id || '');
function modelsFor(id: string): string[] {
  if (id === 'ollama' && ollamaModels.value.length) return ollamaModels.value;
  return providers.value.find((p) => p.id === id)?.models ?? [];
}
// 左栏列表行（含状态点输入）。
const rows = computed(() =>
  providers.value.map((p) => ({
    id: p.id,
    name: p.name,
    model:
      p.id === activeId.value && prefs.value['model.activeModel']
        ? prefs.value['model.activeModel']
        : (modelsFor(p.id)[0] ?? ''),
    hasKey: p.hasKey,
    lastTestOk: testOk.value[p.id] ?? null,
  })),
);
const activeP = computed(() => providers.value.find((p) => p.id === activeId.value));
const activeDialect = computed(() => getDialect(activeId.value));
const activeFormatLabel = computed(() => {
  const f = activeDialect.value?.format;
  return f ? (FORMAT_LABEL[f] ?? f) : '';
});
const activeModels = computed(() => modelsFor(activeId.value));
const modelOptions = computed(() => activeModels.value.map((m) => ({ value: m, label: m })));
// 显示值：已选 activeModel 若属当前 provider 用它，否则回退首个（= worker 缺省 defaultModels[0]）。
const activeModelValue = computed(() => {
  const m = prefs.value['model.activeModel'];
  return m && activeModels.value.includes(m) ? m : (activeModels.value[0] ?? '');
});
const ollamaOptions = computed(() => {
  const names = new Set(ollamaModels.value);
  if (prefs.value['offline.ollamaModel']) names.add(prefs.value['offline.ollamaModel']);
  const arr = [...names];
  return arr.length
    ? arr.map((m) => ({ value: m, label: m }))
    : [{ value: '', label: '（未检测到本地模型）' }];
});

async function refreshProviders(): Promise<void> {
  const res = (await window.desksoul.rpc('provider.listProviders', {})) as {
    providers: ProviderRow[];
  };
  providers.value = res.providers;
}

onMounted(async () => {
  prefs.value = (await window.desksoul.rpc('app.prefs.getAll', {})) as Prefs;
  await refreshProviders();
  // Ollama：检测本地可用模型（默认模型选择 + 离线备用模型都用它）。
  if (providers.value.some((p) => p.id === 'ollama')) {
    const det = (await window.desksoul.rpc('provider.ollamaDetect', {})) as {
      available: boolean;
      models: string[];
    };
    ollamaModels.value = det.models;
  }
});

// 通用：写一个 pref → 乐观更新 + 持久 + 顶栏 toast。
async function set<K extends PrefKey>(key: K, value: Prefs[K]): Promise<void> {
  prefs.value = { ...prefs.value, [key]: value };
  await window.desksoul.rpc('app.prefs.set', { key, value });
  emit('saved');
}

function onSelect(id: string): void {
  testMsg.value = '';
  void set('model.activeProvider', id);
}

async function saveKey(id: string, key: string): Promise<void> {
  await window.desksoul.rpc('provider.saveKey', { providerId: id, key });
  testOk.value = { ...testOk.value, [id]: null }; // 新 Key → 旧测试结果作废
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
  <div class="max-w-[840px]">
    <div class="mb-4 flex gap-4">
      <!-- 左栏 Providers + 状态点 -->
      <section class="ds-glass w-[240px] shrink-0 rounded-card p-3">
        <header class="mb-2 px-1 text-sm text-text-sub">Providers</header>
        <ProviderList :rows="rows" :active-id="activeId" @select="onSelect" />
      </section>

      <!-- 右栏 详情 -->
      <section class="ds-glass min-w-0 flex-1 rounded-card p-4">
        <template v-if="activeP">
          <div class="text-md text-text-main">
            {{ activeP.name }}
            <span class="text-text-sub">· {{ activeFormatLabel }}</span>
          </div>
          <div class="my-3 border-t border-glass-border"></div>

          <div class="mb-1 text-sm text-text-sub">API Key</div>
          <KeyInput
            :key="activeId"
            :has-key="activeP.hasKey"
            @save="(k) => saveKey(activeId, k)"
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
            @update:model-value="(v) => set('model.activeModel', v)"
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

    <!-- 预算与告警（渲染+持久；"已使用" 无计量源 → 占位，真实计量留后续） -->
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

    <!-- 离线兜底（J4 联动；渲染+持久，真实降级行为留后续） -->
    <SettingSection title="离线兜底">
      <SettingCard label="当所有 Provider 不可用时">
        <Select
          :model-value="prefs['offline.fallbackMode']"
          :options="FALLBACK"
          @update:model-value="(v) => set('offline.fallbackMode', v as Prefs['offline.fallbackMode'])"
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
