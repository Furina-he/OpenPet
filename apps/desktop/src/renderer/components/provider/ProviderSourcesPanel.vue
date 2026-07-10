<!-- components/provider/ProviderSourcesPanel.vue — Provider 工作台左栏：source 列表
     props.sources 已由父按能力 tab 过滤。对齐 AstrBot ProviderSourcesPanel + §2 glass token。
     显示厂商图标 + 具名（建源时从模板带入；旧源回退 id）+ Base/adapter 副行。 -->
<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { ref } from 'vue';
import { providerIconUrl, type ProviderSource } from '@openpet/protocol';

defineProps<{ sources: ProviderSource[]; activeSourceId: string }>();
const { t } = useI18n();
const emit = defineEmits<{ select: [id: string]; add: []; remove: [id: string] }>();

const failed = ref<Set<string>>(new Set());
function iconOf(s: ProviderSource): string {
  return s.icon && !failed.value.has(s.icon) ? providerIconUrl(s.icon) : '';
}
function onImgError(icon?: string): void {
  if (icon) failed.value = new Set(failed.value).add(icon);
}
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="flex-1 space-y-1 overflow-auto">
      <div
        v-for="s in sources"
        :key="s.id"
        class="group flex w-full cursor-pointer items-center gap-2 rounded-card px-3 py-2 transition"
        :class="
          s.id === activeSourceId
            ? 'ds-glass border border-brand-to'
            : 'border border-transparent hover:border-glass-border'
        "
        @click="emit('select', s.id)"
      >
        <span
          class="h-2 w-2 shrink-0 rounded-full"
          :style="{ background: s.enabled ? 'var(--ds-success)' : 'var(--ds-text-sub)' }"
        />
        <span class="grid h-6 w-6 shrink-0 place-items-center">
          <img
            v-if="iconOf(s)"
            :src="iconOf(s)"
            class="h-5 w-5 object-contain opacity-80"
            alt=""
            @error="onImgError(s.icon)"
          />
          <span
            v-else
            class="grid h-5 w-5 place-items-center rounded-full text-[10px] font-bold text-white opacity-70"
            style="background: linear-gradient(135deg, var(--ds-brand-from), var(--ds-brand-to))"
          >
            {{ (s.name || s.id)[0]?.toUpperCase() }}
          </span>
        </span>
        <span class="min-w-0 flex-1">
          <span class="block truncate font-semibold text-text-main">{{ s.name || s.id }}</span>
          <span class="block truncate text-sm text-text-sub">{{ s.apiBase || s.adapter }}</span>
        </span>
        <button
          class="hidden text-sm text-text-sub group-hover:inline"
          :title="t('settings.providerUi.removeSource')"
          @click.stop="emit('remove', s.id)"
        >
          {{ t('settings.providerUi.remove') }}
        </button>
      </div>
      <div v-if="!sources.length" class="px-3 py-6 text-center text-sm text-text-sub">
        {{ t('settings.providerUi.noSources') }}
      </div>
    </div>
    <button
      class="mt-2 rounded-btn border border-glass-border px-3 py-2 text-base text-text-main transition hover:border-brand-to"
      @click="emit('add')"
    >
      {{ t('settings.providerUi.addSourceBtn') }}
    </button>
  </div>
</template>
