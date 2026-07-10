<!-- settings/pages/MemoryPage.vue — Hub「记忆」页（F3，批次⑥ F-AI-06，照 UI/e53d5e72 F3 区简化）。
     长期记忆事实清单（钉住/删除/时间）+ 手动添加 + 清空全部（危险确认）。
     提炼由 Main 侧 memory-extractor 轮末自动做；开关在 隐私 → 长期记忆。 -->
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { MemoryFact } from '@openpet/protocol';
import Button from '../../components/Button.vue';
import Input from '../../components/Input.vue';
import ConfirmDialog from '../../components/ConfirmDialog.vue';

const { t } = useI18n();
const facts = ref<MemoryFact[]>([]);
const newText = ref('');
const clearing = ref(false); // ConfirmDialog

async function load(): Promise<void> {
  const r = (await window.openpet.rpc('memory.list', {})) as { facts: MemoryFact[] };
  facts.value = [...r.facts].sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt - a.createdAt,
  );
}
onMounted(load);

async function add(): Promise<void> {
  const text = newText.value.trim();
  if (!text) return;
  await window.openpet.rpc('memory.add', { text });
  newText.value = '';
  await load();
}
async function remove(id: number): Promise<void> {
  await window.openpet.rpc('memory.delete', { id });
  await load();
}
async function togglePin(f: MemoryFact): Promise<void> {
  await window.openpet.rpc('memory.setPinned', { id: f.id, pinned: !f.pinned });
  await load();
}
async function clearAll(): Promise<void> {
  await window.openpet.rpc('memory.clear', {});
  clearing.value = false;
  await load();
}
function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString();
}
</script>

<template>
  <div class="mx-auto max-w-[720px] space-y-4">
    <div class="flex items-end justify-between">
      <div>
        <h2 class="text-md font-semibold text-text-main">{{ t('settings.memory.title') }}</h2>
        <p class="mt-1 text-sm text-text-sub">
          {{ t('settings.memory.desc') }}
        </p>
      </div>
      <Button v-if="facts.length" variant="secondary" @click="clearing = true">{{ t('settings.memory.clearAll') }}</Button>
    </div>

    <!-- 手动添加 -->
    <div class="ds-glass flex gap-2 rounded-panel p-4">
      <div class="flex-1">
        <Input
          v-model="newText"
          :placeholder="t('settings.memory.addPlaceholder')"
          @keyup.enter="add"
        />
      </div>
      <Button variant="primary" :disabled="!newText.trim()" @click="add">{{ t('common.add') }}</Button>
    </div>

    <!-- 清单 -->
    <div
      v-if="!facts.length"
      class="ds-glass rounded-panel px-3 py-10 text-center text-sm text-text-sub"
    >
      {{ t('settings.memory.empty') }}
    </div>
    <div v-else class="ds-glass rounded-panel p-2">
      <div
        v-for="f in facts"
        :key="f.id"
        class="flex items-center gap-3 border-b border-glass-border px-3 py-3 last:border-0"
      >
        <button
          class="shrink-0 text-base transition ease-ds"
          :class="f.pinned ? '' : 'opacity-30 grayscale hover:opacity-70'"
          :title="f.pinned ? t('settings.memory.unpin') : t('settings.memory.pin')"
          :aria-label="f.pinned ? t('settings.memory.unpin') : t('settings.memory.pin')"
          @click="togglePin(f)"
        >
          📌
        </button>
        <div class="min-w-0 flex-1">
          <div class="text-base text-text-main">{{ f.text }}</div>
          <div class="mt-0.5 text-sm text-text-sub">
            {{ fmtTime(f.createdAt) }}<span v-if="f.pinned"> · {{ t('settings.memory.pinned') }}</span>
          </div>
        </div>
        <button
          class="shrink-0 text-sm text-text-sub hover:text-text-main"
          :title="t('settings.memory.deleteOne')"
          :aria-label="t('settings.memory.deleteOne')"
          @click="remove(f.id)"
        >
          🗑
        </button>
      </div>
    </div>

    <ConfirmDialog
      :open="clearing"
      :title="t('settings.memory.confirmClearTitle')"
      :detail="t('settings.memory.confirmClearDetail')"
      :confirm-label="t('settings.data.clearLabel')"
      @confirm="clearAll"
      @cancel="clearing = false"
    />
  </div>
</template>
