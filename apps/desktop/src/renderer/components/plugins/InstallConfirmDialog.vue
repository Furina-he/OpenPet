<!-- components/plugins/InstallConfirmDialog.vue — 安装权限确认（F-PL-04 第一步：安装时知情）。
     硬要求：安装前必须出现 manifest.permissions 清单（spec §4）；警示条 = 本机运行提醒。 -->
<script setup lang="ts">
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { ShieldAlert } from 'lucide-vue-next';
import type { DesktopPluginManifest } from '@openpet/protocol';

const props = defineProps<{ open: boolean; manifest: DesktopPluginManifest | null }>();
const emit = defineEmits<{ confirm: []; cancel: [] }>();
const { t } = useI18n();
const cancelBtn = ref<HTMLButtonElement | null>(null);
watch(
  () => props.open,
  (v) => {
    if (v) requestAnimationFrame(() => cancelBtn.value?.focus()); // 默认焦点落安全侧
  },
);
</script>
<template>
  <div
    v-if="open && manifest"
    role="dialog"
    aria-modal="true"
    :aria-label="t('settings.plugins.installConfirmTitle')"
    class="fixed inset-0 z-[60] flex items-center justify-center"
    style="background: rgba(0, 0, 0, 0.32)"
    @keydown.esc.stop="emit('cancel')"
  >
    <div
      class="ds-glass w-[460px] rounded-panel border-2 p-5"
      style="border-color: var(--ds-warning)"
    >
      <div class="text-md font-semibold text-text-main">
        {{ t('settings.plugins.installConfirmTitle') }}
      </div>
      <div class="mt-1 text-sm text-text-sub">
        {{ manifest.name }} v{{ manifest.version }}
        <span v-if="manifest.author">· {{ manifest.author }}</span>
      </div>

      <div class="mt-3 text-sm text-text-main">{{ t('settings.plugins.permissionsTitle') }}</div>
      <ul v-if="manifest.permissions.length" class="mt-1 space-y-1">
        <li
          v-for="p in manifest.permissions"
          :key="p"
          class="flex items-center gap-2 rounded-btn border border-glass-border px-3 py-1.5 text-sm text-text-main"
        >
          <span class="h-1.5 w-1.5 rounded-full" style="background: var(--ds-warning)" />
          {{ t(`settings.plugins.perm.${p}`) }}
        </li>
      </ul>
      <div v-else class="mt-1 text-sm text-text-sub">
        {{ t('settings.plugins.noPermissions') }}
      </div>

      <div
        class="mt-3 flex items-start gap-2 rounded-btn border border-glass-border px-3 py-2 text-sm"
        style="color: var(--ds-warning)"
      >
        <ShieldAlert class="mt-0.5 shrink-0" :size="15" :stroke-width="1.5" />
        {{ t('settings.plugins.trustWarning') }}
      </div>

      <div class="mt-5 flex justify-end gap-2">
        <button
          ref="cancelBtn"
          class="ds-focus rounded-btn px-4 py-2 text-base text-text-sub"
          @click="emit('cancel')"
        >
          {{ t('common.cancel') }}
        </button>
        <button
          class="ds-focus rounded-btn px-4 py-2 text-base text-white"
          style="background: linear-gradient(90deg, var(--ds-brand-from), var(--ds-brand-to))"
          @click="emit('confirm')"
        >
          {{ t('settings.plugins.installConfirmAction') }}
        </button>
      </div>
    </div>
  </div>
</template>
