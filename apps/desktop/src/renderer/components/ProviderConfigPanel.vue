<!-- apps/desktop/src/renderer/components/ProviderConfigPanel.vue
     D3/C2 共用：按 demo 的 provider source 单下拉结构呈现。
     保留现有 provider.* RPC：保存 Key、测试连接、拉取模型、Ollama 检测。 -->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import {
  Box,
  ChevronDown,
  Download,
  Plus,
  Save,
  Search,
  SearchX,
  SlidersHorizontal,
  Trash2,
} from 'lucide-vue-next';
import type { PrefKey, Prefs } from '@desksoul/protocol';
import {
  DEFAULT_PREFS,
  getProviderBaseUrl,
  normalizeProviderBaseUrl,
  providerBaseUrlPrefKey,
} from '@desksoul/protocol';
import KeyInput from './KeyInput.vue';
import type { ProviderRow } from '../settings/provider-config-view';

const emit = defineEmits<{ saved: []; 'ollama-detected': [models: string[]] }>();

const prefs = ref<Prefs>({ ...DEFAULT_PREFS });
const providers = ref<ProviderRow[]>([]);
const testOk = ref<Record<string, boolean | null>>({});
const ollamaModels = ref<string[]>([]);
const loadedModels = ref<Record<string, string[]>>({});
const testMsg = ref('');
const sourceOpen = ref(false);
const addOpen = ref(false);
const modelSearch = ref('');
const modelsLoading = ref(false);
const baseUrlDraft = ref('');

const PROVIDER_META: Record<string, { label: string; icon: string }> = {
  openai: { label: 'OpenAI Compatible', icon: '◎' },
  gemini: { label: 'Google Gemini', icon: '◆' },
  claude: { label: 'Anthropic', icon: 'AI' },
  deepseek: { label: 'DeepSeek', icon: '◒' },
  qwen: { label: '通义千问', icon: 'Q' },
  ollama: { label: 'Ollama', icon: 'O' },
};
const PROVIDER_ORDER = ['openai', 'gemini', 'claude', 'deepseek', 'qwen', 'ollama'];
const SOURCE_IDS: Record<string, string> = {
  openai: 'openai_2',
  gemini: 'gemini_1',
  claude: 'anthropic_1',
  deepseek: 'deepseek_1',
  qwen: 'qwen_1',
  ollama: 'ollama_1',
};

const activeId = computed(() => prefs.value['model.activeProvider']);
const activeP = computed(() => providers.value.find((p) => p.id === activeId.value));
const activeBaseUrl = computed(() => (activeId.value ? getProviderBaseUrl(activeId.value, prefs.value) : ''));
const sortedProviders = computed(() =>
  [...providers.value].sort((a, b) => {
    const ai = PROVIDER_ORDER.indexOf(a.id);
    const bi = PROVIDER_ORDER.indexOf(b.id);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  }),
);
const sourceRows = computed(() =>
  sortedProviders.value.map((p) => ({
    ...p,
    label: providerLabel(p),
    icon: providerIcon(p),
    sourceId: providerSourceId(p),
    model:
      p.id === activeId.value && prefs.value['model.activeModel']
        ? prefs.value['model.activeModel']
        : (availableModels(p.id)[0] ?? ''),
    lastTestOk: testOk.value[p.id] ?? null,
  })),
);
const activeModels = computed(() => availableModels(activeId.value));
const filteredModels = computed(() => {
  const keyword = modelSearch.value.trim().toLowerCase();
  if (!keyword) return activeModels.value;
  return activeModels.value.filter((model) => model.toLowerCase().includes(keyword));
});
const configuredModel = computed(() => prefs.value['model.activeModel']);

function providerLabel(provider: Pick<ProviderRow, 'id' | 'name'>): string {
  return PROVIDER_META[provider.id]?.label ?? provider.name;
}
function providerIcon(provider: Pick<ProviderRow, 'id' | 'name'>): string {
  return PROVIDER_META[provider.id]?.icon ?? provider.name.slice(0, 2).toUpperCase();
}
function providerSourceId(provider: Pick<ProviderRow, 'id'>): string {
  return SOURCE_IDS[provider.id] ?? provider.id;
}
function availableModels(id: string): string[] {
  if (!id) return [];
  if (loadedModels.value[id]) return loadedModels.value[id]!;
  if (id === 'ollama' && ollamaModels.value.length) return ollamaModels.value;
  return [];
}
function syncBaseUrlDraft(id = activeId.value): void {
  baseUrlDraft.value = id ? (getProviderBaseUrl(id, prefs.value) ?? '') : '';
}

async function refreshProviders(): Promise<void> {
  const res = (await window.desksoul.rpc('provider.listProviders', {})) as {
    providers: ProviderRow[];
  };
  providers.value = res.providers;
}

onMounted(async () => {
  prefs.value = (await window.desksoul.rpc('app.prefs.getAll', {})) as Prefs;
  await refreshProviders();
  syncBaseUrlDraft();
  if (providers.value.some((p) => p.id === 'ollama')) {
    const det = (await window.desksoul.rpc('provider.ollamaDetect', {})) as {
      available: boolean;
      models: string[];
    };
    ollamaModels.value = det.models;
    emit('ollama-detected', det.models);
  }
});

watch(activeId, () => syncBaseUrlDraft());

async function setPref(
  key: 'model.activeProvider' | 'model.activeModel',
  value: string,
): Promise<void> {
  prefs.value = { ...prefs.value, [key]: value };
  await window.desksoul.rpc('app.prefs.set', { key, value });
  emit('saved');
}
async function setStringPref(key: PrefKey, value: string): Promise<void> {
  prefs.value = { ...prefs.value, [key]: value } as Prefs;
  await window.desksoul.rpc('app.prefs.set', { key, value });
  emit('saved');
}
async function onSelect(id: string): Promise<void> {
  testMsg.value = '';
  sourceOpen.value = false;
  addOpen.value = false;
  modelSearch.value = '';
  await setPref('model.activeProvider', id);
  syncBaseUrlDraft(id);
}
async function clearProviderSource(): Promise<void> {
  testMsg.value = '';
  sourceOpen.value = false;
  addOpen.value = false;
  modelSearch.value = '';
  await setPref('model.activeProvider', '');
  if (prefs.value['model.activeModel']) await setPref('model.activeModel', '');
  syncBaseUrlDraft('');
}
async function saveBaseUrl(): Promise<boolean> {
  const id = activeId.value;
  if (!id) return false;
  const key = providerBaseUrlPrefKey(id);
  if (!key) return true;
  let next = '';
  try {
    next = normalizeProviderBaseUrl(baseUrlDraft.value);
    new URL(next);
  } catch {
    testMsg.value = '请输入有效的 API Base URL';
    return false;
  }
  await setStringPref(key, next);
  baseUrlDraft.value = next;
  return true;
}
async function saveKey(id: string, key: string): Promise<void> {
  await window.desksoul.rpc('provider.saveKey', { providerId: id, key });
  testOk.value = { ...testOk.value, [id]: null };
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
  if (!(await saveBaseUrl())) return;
  testMsg.value = '测试中...';
  const res = (await window.desksoul.rpc('provider.testConnection', { providerId: id })) as {
    ok: boolean;
    errorKind?: string;
    detail?: string;
  };
  testOk.value = { ...testOk.value, [id]: res.ok };
  testMsg.value = res.ok ? '连接成功，配置已保存' : `连接失败（${res.errorKind ?? 'error'}）`;
}
async function fetchModels(): Promise<void> {
  const id = activeId.value;
  if (!id) return;
  if (!(await saveBaseUrl())) return;
  modelsLoading.value = true;
  try {
    const res = (await window.desksoul.rpc('provider.listModels', { providerId: id })) as {
      models: string[];
    };
    loadedModels.value = { ...loadedModels.value, [id]: res.models };
    testMsg.value = res.models.length ? `已获取 ${res.models.length} 个模型` : '未找到可用模型';
    emit('saved');
  } catch (error) {
    testMsg.value = `获取模型失败：${error instanceof Error ? error.message : String(error)}`;
  } finally {
    modelsLoading.value = false;
  }
}
</script>

<template>
  <section
    class="ds-glass grid min-h-[520px] max-h-[720px] grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-panel"
  >
    <header
      class="grid min-h-[88px] grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-4 border-b border-glass-border px-5 py-4"
    >
      <div class="relative min-w-0">
        <button
          class="flex min-h-[50px] w-full items-center justify-between rounded-panel px-5 text-left text-base transition ease-ds"
          :class="activeP ? 'text-text-main' : 'text-text-sub'"
          :style="
            activeP
              ? 'background: var(--ds-surface-strong); border: 1px solid rgba(255, 180, 84, 0.45)'
              : 'background: rgba(23, 24, 33, 0.05); border: 1px solid transparent'
          "
          @click="
            sourceOpen = !sourceOpen;
            addOpen = false;
          "
        >
          <span class="min-w-0 truncate">
            {{ activeP ? providerSourceId(activeP) : '请选择一个提供商源' }}
          </span>
          <ChevronDown :size="17" :stroke-width="1.5" />
        </button>

        <div
          v-if="sourceOpen"
          class="absolute right-[-70px] top-[58px] z-20 grid max-h-[360px] w-[360px] gap-1 overflow-auto rounded-card border border-glass-border bg-white/95 p-2 shadow-[0_18px_42px_rgba(0,0,0,0.14)]"
        >
          <button
            v-for="r in sourceRows"
            :key="r.id"
            class="grid min-h-[50px] grid-cols-[32px_minmax(0,1fr)] items-center gap-3 rounded-btn px-3 text-left text-base text-text-main transition ease-ds hover:bg-black/5"
            :style="r.id === activeId ? 'background: var(--ds-warm-soft)' : ''"
            @click="onSelect(r.id)"
          >
            <span class="grid h-8 w-8 place-items-center text-base font-semibold">
              {{ r.icon }}
            </span>
            <span class="min-w-0 truncate">{{ r.label }}</span>
          </button>
        </div>
      </div>

      <button
        class="inline-flex min-h-10 min-w-10 items-center justify-center text-danger transition ease-ds disabled:opacity-0"
        title="移除当前提供商源"
        :disabled="!activeP"
        @click="clearProviderSource"
      >
        <Trash2 :size="24" :stroke-width="1.6" />
      </button>

      <div class="relative">
        <button
          class="inline-flex min-h-10 items-center gap-2 px-2 text-base font-semibold"
          style="color: var(--ds-cool)"
          @click="
            addOpen = !addOpen;
            sourceOpen = false;
          "
        >
          <Plus :size="18" :stroke-width="2" />
          新增
        </button>
        <div
          v-if="addOpen"
          class="absolute right-0 top-[48px] z-20 grid max-h-[360px] w-[300px] gap-1 overflow-auto rounded-card border border-glass-border bg-white/95 p-2 shadow-[0_18px_42px_rgba(0,0,0,0.14)]"
        >
          <button
            v-for="r in sourceRows"
            :key="r.id"
            class="grid min-h-[50px] grid-cols-[32px_minmax(0,1fr)] items-center gap-3 rounded-btn px-3 text-left text-base text-text-main transition ease-ds hover:bg-black/5"
            @click="onSelect(r.id)"
          >
            <span class="grid h-7 w-7 place-items-center font-semibold">{{ r.icon }}</span>
            <span class="truncate">{{ r.label }}</span>
          </button>
        </div>
      </div>
    </header>

    <div v-if="!activeP" class="grid min-h-[430px] place-items-center p-6 text-center text-text-sub">
      <div>
        <div class="mx-auto mb-3 grid h-14 w-14 place-items-center">
          <SlidersHorizontal :size="32" :stroke-width="1.4" />
        </div>
        <p class="text-base">请选择一个提供商源</p>
      </div>
    </div>

    <div v-else class="min-h-0 overflow-auto overscroll-contain">
      <div class="border-b border-glass-border px-5 py-5">
        <h2 class="truncate text-xl font-semibold leading-tight text-text-main">
          {{ providerSourceId(activeP) }}
        </h2>
        <p class="mt-2 truncate text-base leading-tight text-text-sub">
          {{ activeBaseUrl }}
        </p>
        <button
          class="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-panel text-base"
          style="background: rgba(22, 119, 200, 0.11); color: var(--ds-cool)"
          @click="testConnection"
        >
          <Save :size="19" :stroke-width="1.5" />
          保存配置
        </button>
        <p v-if="testMsg" class="mt-3 text-base text-text-sub">{{ testMsg }}</p>
      </div>

      <div class="grid gap-6 px-5 py-5">
        <section class="grid gap-3">
          <h2 class="text-md font-semibold leading-tight text-text-main">设置</h2>
          <div class="divide-y divide-glass-border border-y border-glass-border">
            <div
              class="grid min-h-[58px] gap-4 px-4 py-3 md:grid-cols-[minmax(170px,0.45fr)_minmax(280px,1fr)] md:items-center"
            >
              <div>
                <div class="font-semibold text-text-main">ID</div>
                <div class="mt-1 text-sm leading-relaxed text-text-sub">
                  提供商源唯一 ID（不是提供商 ID）
                </div>
              </div>
              <div class="ds-control rounded-input px-3 py-2 text-base text-text-sub">
                {{ providerSourceId(activeP) }}
              </div>
            </div>

            <div
              class="grid min-h-[58px] gap-4 px-4 py-3 md:grid-cols-[minmax(170px,0.45fr)_minmax(280px,1fr)] md:items-center"
            >
              <div>
                <div class="font-semibold text-text-main">API Key</div>
                <div class="mt-1 text-sm leading-relaxed text-text-sub">API 密钥</div>
              </div>
              <KeyInput
                :key="activeId"
                :has-key="activeP.hasKey"
                @save="(key: string) => saveKey(activeId, key)"
                @clear="clearKey(activeId)"
              />
            </div>

            <div
              class="grid min-h-[58px] gap-4 px-4 py-3 md:grid-cols-[minmax(170px,0.45fr)_minmax(280px,1fr)] md:items-center"
            >
              <div>
                <div class="font-semibold text-text-main">API Base URL</div>
                <div class="mt-1 text-sm leading-relaxed text-text-sub">自定义 API 端点 URL</div>
              </div>
              <div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                <input
                  v-model="baseUrlDraft"
                  class="ds-control min-w-0 rounded-input px-3 py-2 text-base text-text-main outline-none"
                  placeholder="https://api.example.com/v1"
                />
                <button
                  class="inline-flex min-h-9 items-center justify-center rounded-btn px-4 text-sm"
                  style="background: rgba(22, 119, 200, 0.11); color: var(--ds-cool)"
                  @click="saveBaseUrl"
                >
                  应用
                </button>
              </div>
            </div>
          </div>
        </section>

        <section class="grid gap-3">
          <h2 class="text-md font-semibold leading-tight text-text-main">高级配置...</h2>
          <div class="divide-y divide-glass-border border-y border-glass-border">
            <div
              class="grid min-h-[58px] gap-4 px-4 py-3 md:grid-cols-[minmax(170px,0.45fr)_minmax(280px,1fr)] md:items-center"
            >
              <div>
                <div class="font-semibold text-text-main">超时时间</div>
                <div class="mt-1 text-sm leading-relaxed text-text-sub">超时时间，单位为秒。</div>
              </div>
              <div class="ds-control rounded-input px-3 py-2 text-base text-text-main">120</div>
            </div>

            <div
              class="grid min-h-[58px] gap-4 px-4 py-3 md:grid-cols-[minmax(170px,0.45fr)_minmax(280px,1fr)] md:items-center"
            >
              <div>
                <div class="font-semibold text-text-main">代理地址</div>
                <div class="mt-1 text-sm leading-relaxed text-text-sub">
                  HTTP/HTTPS 代理地址，格式如 http://127.0.0.1:7890。
                </div>
              </div>
              <div class="ds-control rounded-input px-3 py-2 text-base text-text-sub">
                暂未配置
              </div>
            </div>

            <div
              class="grid min-h-[58px] gap-4 px-4 py-3 md:grid-cols-[minmax(170px,0.45fr)_minmax(280px,1fr)] md:items-center"
            >
              <div>
                <div class="font-semibold text-text-main">自定义请求头</div>
                <div class="mt-1 text-sm leading-relaxed text-text-sub">
                  会合并到 OpenAI SDK 的 default_headers 中。
                </div>
              </div>
              <div class="grid grid-cols-[1fr_auto] items-center gap-3">
                <span class="text-base text-text-sub">暂无项目</span>
                <button
                  class="inline-flex min-h-[36px] cursor-not-allowed items-center justify-center rounded-btn px-4 text-sm opacity-50"
                  style="background: rgba(22, 119, 200, 0.11); color: var(--ds-cool)"
                  disabled
                >
                  修改
                </button>
              </div>
            </div>
          </div>
        </section>

        <section class="grid gap-5">
          <div class="flex flex-wrap items-center justify-end gap-3">
            <div class="relative w-[255px] max-w-full">
              <Search
                class="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-text-sub"
                :size="17"
                :stroke-width="1.5"
              />
              <input
                v-model="modelSearch"
                class="ds-control h-10 w-full rounded-panel border-0 bg-black/[0.04] py-2 pl-10 pr-4 text-base text-text-main outline-none"
                placeholder="搜索模型或 ID"
              />
            </div>
            <button
              class="inline-flex min-h-10 items-center gap-2 rounded-btn px-4 text-base"
              style="background: rgba(22, 119, 200, 0.11); color: var(--ds-cool)"
              @click="fetchModels"
            >
              <Download :size="18" :stroke-width="1.5" />
              {{ modelsLoading ? '获取中...' : '保存并获取模型' }}
            </button>
            <button
              class="ds-control inline-flex min-h-10 cursor-not-allowed items-center gap-2 rounded-btn px-4 text-base text-text-main opacity-70"
              disabled
            >
              <Plus :size="18" :stroke-width="1.5" />
              自定义模型
            </button>
          </div>

          <div>
            <h2 class="text-md font-semibold leading-tight text-text-main">模型</h2>
            <p class="mt-2 text-base text-text-sub">可用模型 {{ filteredModels.length }}</p>
          </div>

          <div class="flex items-center justify-between">
            <strong class="text-base text-text-main">已配置的模型</strong>
            <span class="rounded-full bg-glass-border px-3 py-1 text-sm text-text-sub">
              {{ configuredModel ? 1 : 0 }}
            </span>
          </div>
          <div class="grid min-h-[128px] place-items-center text-center text-text-sub">
            <div v-if="configuredModel" class="w-full">
              <div class="rounded-card border border-glass-border px-4 py-3 text-left text-base text-text-main">
                {{ configuredModel }}
              </div>
            </div>
            <div v-else>
              <div class="mx-auto mb-3 grid h-12 w-12 place-items-center text-text-sub">
                <Box :size="34" :stroke-width="1.4" />
              </div>
              <p class="text-base">暂无已配置的模型，点击上方的“获取模型列表”添加</p>
            </div>
          </div>

          <div class="border-t border-glass-border"></div>

          <div class="flex items-center justify-between">
            <strong class="text-base text-text-main">可用模型</strong>
            <span class="rounded-full bg-glass-border px-3 py-1 text-sm text-text-sub">
              {{ filteredModels.length }}
            </span>
          </div>
          <div class="grid min-h-[150px] place-items-center text-center text-text-sub">
            <div v-if="filteredModels.length" class="flex w-full flex-wrap gap-2">
              <button
                v-for="model in filteredModels"
                :key="model"
                class="rounded-full border px-3 py-1.5 text-base transition ease-ds"
                :class="model === configuredModel ? 'text-text-main' : 'text-text-sub'"
                :style="
                  model === configuredModel
                    ? 'border-color: rgba(255, 180, 84, 0.5); background: var(--ds-warm-soft)'
                    : 'border-color: var(--ds-glass-border); background: rgba(255,255,255,0.32)'
                "
                @click="setPref('model.activeModel', model)"
              >
                {{ model }}
              </button>
            </div>
            <div v-else>
              <div class="mx-auto mb-3 grid h-12 w-12 place-items-center text-text-sub">
                <SearchX :size="34" :stroke-width="1.4" />
              </div>
              <p class="text-base">未找到可用模型</p>
            </div>
          </div>
        </section>
      </div>
    </div>
  </section>
</template>
