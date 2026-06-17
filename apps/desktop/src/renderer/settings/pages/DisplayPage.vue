<!-- apps/desktop/src/renderer/settings/pages/DisplayPage.vue -->
<!-- walking skeleton：界面主题端到端（设置 → prefs.set → 落盘 → 广播 → 换肤 → ✓已保存）。 -->
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { ThemePref } from '@desksoul/protocol';
import GlassPanel from '../../components/GlassPanel.vue';
import SettingCard from '../../components/SettingCard.vue';
import Select from '../../components/Select.vue';

const emit = defineEmits<{ saved: [] }>();
const theme = ref<ThemePref>('system');
const OPTIONS = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
];

onMounted(async () => {
  const prefs = await window.desksoul.rpc('app.prefs.getAll', {});
  theme.value = prefs['display.theme'];
});

async function onChange(v: string): Promise<void> {
  theme.value = v as ThemePref;
  await window.desksoul.rpc('app.prefs.set', { key: 'display.theme', value: v });
  emit('saved'); // 触发顶栏 ✓ 已保存（换肤由 main.ts 的 changed 订阅完成）
}
</script>
<template>
  <GlassPanel size="l" class="max-w-[640px]">
    <SettingCard label="界面主题" description="跟随系统 / 浅色 / 深色">
      <Select :model-value="theme" :options="OPTIONS" @update:model-value="onChange" />
    </SettingCard>
  </GlassPanel>
</template>
