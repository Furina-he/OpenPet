<!-- apps/desktop/src/renderer/settings/pages/HotkeysPage.vue — D2→热键页（ui-design §14.2 总览） -->
<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Prefs } from '@openpet/protocol';
import { DEFAULT_PREFS, findConflict } from '@openpet/protocol';
import SettingSection from '../../components/SettingSection.vue';
import SettingCard from '../../components/SettingCard.vue';
import KeyCap from '../../components/KeyCap.vue';

const emit = defineEmits<{ saved: [] }>();
const { t } = useI18n();
// label = i18n key。
const HOTKEYS: Array<{ key: keyof Prefs & `hotkeys.${string}`; label: string }> = [
  { key: 'hotkeys.chat', label: 'settings.hotkeys.chat' },
  { key: 'hotkeys.toggleHide', label: 'settings.hotkeys.toggleHide' },
  { key: 'hotkeys.clickThrough', label: 'settings.hotkeys.clickThrough' },
  { key: 'hotkeys.dnd', label: 'settings.hotkeys.dnd' },
  { key: 'hotkeys.openHub', label: 'settings.hotkeys.openHub' },
];
const prefs = ref<Prefs>({ ...DEFAULT_PREFS });
const map = computed<Record<string, string>>(() =>
  Object.fromEntries(HOTKEYS.map((h) => [h.key, prefs.value[h.key] as string])),
);

onMounted(async () => {
  prefs.value = (await window.openpet.rpc('app.prefs.getAll', {})) as Prefs;
});
function conflictOf(key: string, acc: string): string | null {
  const id = findConflict(map.value, key, acc);
  const labelKey = HOTKEYS.find((h) => h.key === id)?.label;
  return id ? (labelKey ? t(labelKey) : id) : null;
}
async function capture(key: keyof Prefs & `hotkeys.${string}`, acc: string): Promise<void> {
  prefs.value = { ...prefs.value, [key]: acc };
  await window.openpet.rpc('app.prefs.set', { key, value: acc });
  emit('saved');
}
async function resetAll(): Promise<void> {
  for (const h of HOTKEYS) {
    const def = DEFAULT_PREFS[h.key] as string;
    prefs.value = { ...prefs.value, [h.key]: def };
    await window.openpet.rpc('app.prefs.set', { key: h.key, value: def });
  }
  emit('saved');
}
</script>
<template>
  <div class="max-w-[720px]">
    <SettingSection :title="t('settings.hotkeys.secGlobal')">
      <SettingCard v-for="h in HOTKEYS" :key="h.key" :label="t(h.label)">
        <div class="flex items-center gap-2">
          <span
            v-if="conflictOf(h.key, map[h.key]!)"
            class="text-sm"
            style="color: var(--ds-warning)"
          >
            {{ t('settings.hotkeys.conflict', { name: conflictOf(h.key, map[h.key]!) }) }}
          </span>
          <KeyCap :value="map[h.key]!" @capture="(acc) => capture(h.key, acc)" />
        </div>
      </SettingCard>
    </SettingSection>
    <button
      class="mt-3 rounded-btn border border-glass-border px-4 py-2 text-sm text-text-sub"
      @click="resetAll"
    >
      {{ t('settings.hotkeys.resetAll') }}
    </button>
  </div>
</template>
