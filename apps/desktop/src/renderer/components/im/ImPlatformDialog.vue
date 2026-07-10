<!-- components/im/ImPlatformDialog.vue — IM 平台新增/编辑（照 AstrBot AddNewPlatform）：
     ① 选择平台类型 = logo 模板卡（AddSourceDialog 同形制，编辑模式类型锁定）
     ② 连接信息字段组 + 「查看教程」外链。
     OneBot accessToken 留空保存 → AstrBot #2639 同款安全警告（继续保存 / 重新编辑）。 -->
<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { computed, ref, watch } from 'vue';
import { BookOpen } from 'lucide-vue-next';
import {
  ImPlatformSchema,
  validateImPlatform,
  type ImPlatform,
  type ImPlatformType,
} from '@openpet/protocol';
import Input from '../Input.vue';
import Button from '../Button.vue';
import { IM_PLATFORM_META } from './platform-meta';

const { t } = useI18n();
const props = defineProps<{ open: boolean; platform?: ImPlatform }>();
const emit = defineEmits<{ save: [ImPlatform]; cancel: [] }>();

const TEMPLATES = Object.values(IM_PLATFORM_META);

const id = ref('');
const type = ref<ImPlatformType | null>(null);
const name = ref('');
const enable = ref(true);
const wsUrl = ref('');
const accessToken = ref('');
const botToken = ref('');
const apiBase = ref('https://api.telegram.org');
const errMsg = ref('');
const warnOpen = ref(false);

// 打开时按 props.platform 回填（编辑）或重置（新增，类型待选）。
watch(
  () => [props.open, props.platform] as const,
  ([open]) => {
    if (!open) return;
    const p = props.platform;
    id.value = p?.id ?? crypto.randomUUID();
    type.value = p?.type ?? null;
    name.value = p?.name ?? '';
    enable.value = p?.enable ?? true;
    wsUrl.value = p?.wsUrl ?? '';
    accessToken.value = p?.accessToken ?? '';
    botToken.value = p?.botToken ?? '';
    apiBase.value = p?.apiBase ?? 'https://api.telegram.org';
    errMsg.value = '';
    warnOpen.value = false;
  },
  { immediate: true },
);

const meta = computed(() => (type.value ? IM_PLATFORM_META[type.value] : null));

function pickType(v: ImPlatformType): void {
  type.value = v;
  if (!name.value.trim()) name.value = IM_PLATFORM_META[v].label;
  errMsg.value = '';
}

function openTutorial(): void {
  if (meta.value) void window.openpet.rpc('app.openExternal', { url: meta.value.tutorial });
}

function collect(): ImPlatform | null {
  if (!type.value) return null;
  try {
    const platform = ImPlatformSchema.parse({
      id: id.value,
      type: type.value,
      name: name.value.trim() || IM_PLATFORM_META[type.value].label,
      enable: enable.value,
      wsUrl: wsUrl.value.trim(),
      accessToken: accessToken.value.trim(),
      botToken: botToken.value.trim(),
      apiBase: apiBase.value.trim() || 'https://api.telegram.org',
    });
    validateImPlatform(platform);
    return platform;
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    errMsg.value = m.includes('wsUrl')
      ? t('settings.im.errWsUrl')
      : m.includes('botToken')
        ? t('settings.im.errBotToken')
        : m;
    return null;
  }
}

function save(): void {
  const p = collect();
  if (!p) return;
  // AstrBot #2639：OneBot 正向 WS 无 access token —— 本机任意程序都能连上该端口。
  if (p.type === 'onebot-v11' && !p.accessToken.trim()) {
    warnOpen.value = true;
    return;
  }
  emit('save', p);
}

function saveAnyway(): void {
  warnOpen.value = false;
  const p = collect();
  if (p) emit('save', p);
}
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 z-[60] flex items-center justify-center"
    style="background: rgba(0, 0, 0, 0.32)"
    @click.self="emit('cancel')"
  >
    <div class="ds-glass max-h-[88vh] w-[560px] overflow-y-auto rounded-panel p-5">
      <div class="text-md font-semibold text-text-main">
        {{
          props.platform
            ? t('settings.im.editPlatform', { name: props.platform.name })
            : t('settings.im.addPlatformTitle')
        }}
      </div>

      <!-- ① 选择平台类型 -->
      <div class="mt-4 flex items-start gap-3">
        <span
          class="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-xs font-bold text-white"
          style="background: linear-gradient(135deg, var(--ds-brand-from), var(--ds-brand-to))"
        >
          1
        </span>
        <div class="min-w-0 flex-1">
          <h3 class="text-base font-semibold text-text-main">{{ t('settings.im.pickType') }}</h3>
          <p class="mt-0.5 text-sm text-text-sub">{{ t('settings.im.pickTypeHint') }}</p>

          <div v-if="!props.platform" class="mt-3 grid grid-cols-2 gap-3">
            <button
              v-for="tpl in TEMPLATES"
              :key="tpl.type"
              class="ds-glass relative flex items-center gap-3 overflow-hidden rounded-card border p-3 text-left transition"
              :class="type === tpl.type ? 'border-brand-to' : 'border-glass-border hover:border-brand-to'"
              :style="type === tpl.type ? 'background: var(--ds-warm-soft)' : ''"
              @click="pickType(tpl.type)"
            >
              <span class="min-w-0 flex-1">
                <span class="block truncate font-semibold text-text-main">{{ tpl.label }}</span>
              </span>
              <img :src="tpl.logo" class="h-8 w-8 shrink-0 object-contain opacity-80" alt="" />
            </button>
          </div>
          <div
            v-else
            class="ds-control mt-3 flex items-center gap-2 rounded-input px-3 py-2 text-base text-text-sub opacity-70"
          >
            <img v-if="meta" :src="meta.logo" class="h-5 w-5 object-contain" alt="" />
            {{ meta?.label }}
          </div>
        </div>
      </div>

      <!-- ② 连接信息 -->
      <div v-if="type" class="mt-5 flex items-start gap-3">
        <span
          class="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-xs font-bold text-white"
          style="background: linear-gradient(135deg, var(--ds-brand-from), var(--ds-brand-to))"
        >
          2
        </span>
        <div class="min-w-0 flex-1">
          <div class="flex items-center justify-between gap-3">
            <h3 class="text-base font-semibold text-text-main">{{ t('settings.im.connInfo') }}</h3>
            <Button variant="secondary" @click="openTutorial">
              <span class="flex items-center gap-1.5">
                <BookOpen :size="14" :stroke-width="1.5" />
                {{ t('settings.im.viewTutorial') }}
              </span>
            </Button>
          </div>

          <div class="mt-3 space-y-3">
            <label class="block">
              <span class="mb-1 block text-sm text-text-sub">{{ t('settings.im.name') }}</span>
              <Input v-model="name" :placeholder="t('settings.im.namePlaceholder')" />
            </label>

            <template v-if="type === 'onebot-v11'">
              <label class="block">
                <span class="mb-1 block text-sm text-text-sub">{{ t('settings.im.wsUrl') }}</span>
                <Input v-model="wsUrl" placeholder="ws://127.0.0.1:3001" />
                <span class="mt-1 block text-sm text-text-sub">{{ t('settings.im.wsUrlHint') }}</span>
              </label>
              <label class="block">
                <span class="mb-1 block text-sm text-text-sub">{{ t('settings.im.accessToken') }}</span>
                <Input v-model="accessToken" />
              </label>
            </template>

            <template v-else>
              <label class="block">
                <span class="mb-1 block text-sm text-text-sub">{{ t('settings.im.botToken') }}</span>
                <Input v-model="botToken" :placeholder="t('settings.im.botTokenPlaceholder')" />
              </label>
              <label class="block">
                <span class="mb-1 block text-sm text-text-sub">{{ t('settings.im.apiBase') }}</span>
                <Input v-model="apiBase" placeholder="https://api.telegram.org" />
                <span class="mt-1 block text-sm text-text-sub">{{ t('settings.im.apiBaseHint') }}</span>
              </label>
            </template>
          </div>
        </div>
      </div>

      <div
        v-if="errMsg"
        class="mt-3 rounded-card px-3 py-2 text-sm"
        style="color: var(--ds-danger); background: var(--ds-warm-soft)"
      >
        {{ errMsg }}
      </div>

      <div class="mt-5 flex justify-end gap-2">
        <Button variant="ghost" @click="emit('cancel')">{{ t('common.cancel') }}</Button>
        <Button variant="primary" :disabled="!type" @click="save">{{ t('common.save') }}</Button>
      </div>
    </div>

    <!-- OneBot 空 token 安全警告（照 AstrBot #2639） -->
    <div
      v-if="warnOpen"
      class="fixed inset-0 z-[70] flex items-center justify-center"
      style="background: rgba(0, 0, 0, 0.32)"
    >
      <div class="ds-glass w-[460px] rounded-panel p-5">
        <div class="text-md font-semibold text-text-main">
          {{ t('settings.im.securityWarnTitle') }}
        </div>
        <p class="mt-2 text-sm leading-relaxed text-text-sub">
          {{ t('settings.im.securityWarnBody') }}
        </p>
        <div class="mt-4 flex justify-end gap-2">
          <button
            class="rounded-full border px-3 py-1.5 text-sm transition"
            style="color: var(--ds-danger); border-color: var(--ds-danger)"
            @click="saveAnyway"
          >
            {{ t('settings.im.warnContinue') }}
          </button>
          <Button variant="primary" @click="warnOpen = false">
            {{ t('settings.im.warnEditAgain') }}
          </Button>
        </div>
      </div>
    </div>
  </div>
</template>
