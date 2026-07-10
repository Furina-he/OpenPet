<!-- components/provider/ProviderCard.vue — 非对话 provider 卡片（照 AstrBot item-card，截图 2）：
     名 + 启用开关 + 厂商 logo 水印 + 删除/编辑/复制/测试。 -->
<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { ref } from 'vue';
import { providerIconUrl, type ProviderSource } from '@openpet/protocol';

const { t } = useI18n();
const props = defineProps<{ source: ProviderSource; testMsg?: string; testing?: boolean }>();
const emit = defineEmits<{
  toggle: [boolean];
  edit: [];
  copy: [];
  remove: [];
  test: [];
}>();

const failed = ref(false);
const icon = (): string =>
  props.source.icon && !failed.value ? providerIconUrl(props.source.icon) : '';
</script>

<template>
  <div class="ds-glass relative overflow-hidden rounded-panel p-5">
    <!-- 厂商 logo 水印 -->
    <img
      v-if="icon()"
      :src="icon()"
      class="pointer-events-none absolute -right-2 top-1/2 h-28 w-28 -translate-y-1/2 object-contain opacity-10"
      alt=""
      @error="failed = true"
    />

    <div class="relative flex items-start justify-between">
      <div class="min-w-0 flex-1">
        <div class="truncate text-md font-bold text-text-main">{{ source.name || source.id }}</div>
        <div class="mt-0.5 truncate text-sm text-text-sub">{{ source.id }}</div>
      </div>
      <button
        role="switch"
        :aria-checked="source.enabled"
        class="relative h-7 w-12 shrink-0 rounded-full transition ease-ds"
        :style="
          source.enabled
            ? 'background: linear-gradient(90deg, var(--ds-brand-from), var(--ds-brand-to))'
            : 'background: rgba(23,24,33,0.12)'
        "
        @click="emit('toggle', !source.enabled)"
      >
        <span
          class="absolute top-0.5 h-6 w-6 rounded-full bg-white transition ease-ds"
          :style="source.enabled ? 'left: 22px' : 'left: 2px'"
        />
      </button>
    </div>

    <p
      v-if="testMsg"
      class="relative mt-3 text-sm"
      :style="{ color: testMsg.startsWith('✓') ? 'var(--ds-success)' : 'var(--ds-danger)' }"
    >
      {{ testMsg }}
    </p>

    <div class="relative mt-8 flex flex-wrap items-center gap-2">
      <button
        class="rounded-full border px-3 py-1 text-sm transition"
        style="color: var(--ds-danger); border-color: var(--ds-danger)"
        @click="emit('remove')"
      >
        {{ t('common.delete') }}
      </button>
      <button
        class="rounded-full border border-glass-border px-3 py-1 text-sm text-text-main transition hover:border-brand-to"
        @click="emit('edit')"
      >
        {{ t('common.edit') }}
      </button>
      <button
        class="rounded-full border border-glass-border px-3 py-1 text-sm text-text-main transition hover:border-brand-to"
        @click="emit('copy')"
      >
        {{ t('settings.providerUi.copy') }}
      </button>
      <button
        class="rounded-full border border-glass-border px-3 py-1 text-sm transition hover:border-brand-to"
        :style="{ color: 'var(--ds-brand-to)' }"
        :disabled="testing"
        @click="emit('test')"
      >
        {{ testing ? t('settings.providerUi.testing') : t('settings.providerUi.test') }}
      </button>
    </div>
  </div>
</template>
