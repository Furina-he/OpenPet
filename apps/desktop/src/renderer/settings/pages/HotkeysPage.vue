<!-- apps/desktop/src/renderer/settings/pages/HotkeysPage.vue — D2→热键页（ui-design §14.2 总览） -->
<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import type { Prefs } from '@desksoul/protocol';
import { DEFAULT_PREFS, findConflict } from '@desksoul/protocol';
import SettingSection from '../../components/SettingSection.vue';
import SettingCard from '../../components/SettingCard.vue';
import KeyCap from '../../components/KeyCap.vue';

const emit = defineEmits<{ saved: [] }>();
const HOTKEYS: Array<{ key: keyof Prefs & `hotkeys.${string}`; label: string }> = [
  { key: 'hotkeys.chat', label: '跟小灵聊聊' },
  { key: 'hotkeys.toggleHide', label: '显示 / 隐藏角色' },
  { key: 'hotkeys.clickThrough', label: '鼠标穿透' },
  { key: 'hotkeys.dnd', label: '不打扰' },
  { key: 'hotkeys.openHub', label: '打开 Hub' },
];
const prefs = ref<Prefs>({ ...DEFAULT_PREFS });
const map = computed<Record<string, string>>(() =>
  Object.fromEntries(HOTKEYS.map((h) => [h.key, prefs.value[h.key] as string])),
);

onMounted(async () => {
  prefs.value = (await window.desksoul.rpc('app.prefs.getAll', {})) as Prefs;
});
function conflictOf(key: string, acc: string): string | null {
  const id = findConflict(map.value, key, acc);
  return id ? (HOTKEYS.find((h) => h.key === id)?.label ?? id) : null;
}
async function capture(key: keyof Prefs & `hotkeys.${string}`, acc: string): Promise<void> {
  prefs.value = { ...prefs.value, [key]: acc };
  await window.desksoul.rpc('app.prefs.set', { key, value: acc });
  emit('saved');
}
async function resetAll(): Promise<void> {
  for (const h of HOTKEYS) {
    const def = DEFAULT_PREFS[h.key] as string;
    prefs.value = { ...prefs.value, [h.key]: def };
    await window.desksoul.rpc('app.prefs.set', { key: h.key, value: def });
  }
  emit('saved');
}
</script>
<template>
  <div class="max-w-[720px]">
    <SettingSection title="全局热键">
      <SettingCard v-for="h in HOTKEYS" :key="h.key" :label="h.label">
        <div class="flex items-center gap-2">
          <span
            v-if="conflictOf(h.key, map[h.key]!)"
            class="text-sm"
            style="color: var(--ds-warning)"
          >
            已被「{{ conflictOf(h.key, map[h.key]!) }}」占用
          </span>
          <KeyCap :value="map[h.key]!" @capture="(acc) => capture(h.key, acc)" />
        </div>
      </SettingCard>
    </SettingSection>
    <button
      class="mt-3 rounded-btn border border-glass-border px-4 py-2 text-sm text-text-sub"
      @click="resetAll"
    >
      恢复默认热键
    </button>
  </div>
</template>
