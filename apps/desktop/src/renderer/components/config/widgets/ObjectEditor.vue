<!-- config/widgets/ObjectEditor.vue — 键值对（照 AstrBot ObjectEditor）：行内只显示键名 chips（≤3 个，多余 +N，空时「暂无」）
     + 「编辑」按钮 → 弹窗逐行 键 / 值 / 删除 + 「添加」；关闭即回写。 -->
<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Plus, Trash2 } from 'lucide-vue-next';
import Input from '../../Input.vue';
import Button from '../../Button.vue';

const { t } = useI18n();
const props = defineProps<{ modelValue: Record<string, string>; title?: string }>();
const emit = defineEmits<{ 'update:modelValue': [Record<string, string>] }>();

const MAX_CHIPS = 3;
const keys = computed(() => Object.keys(props.modelValue ?? {}));
const shown = computed(() => keys.value.slice(0, MAX_CHIPS));

const open = ref(false);
const rows = ref<{ k: string; v: string }[]>([]);
function openDialog(): void {
  rows.value = Object.entries(props.modelValue ?? {}).map(([k, v]) => ({ k, v }));
  open.value = true;
}
function commit(): void {
  const obj: Record<string, string> = {};
  for (const r of rows.value) if (r.k.trim()) obj[r.k.trim()] = r.v;
  emit('update:modelValue', obj);
}
function close(): void {
  commit();
  open.value = false;
}
</script>

<template>
  <div class="flex items-center justify-between gap-3">
    <div class="min-w-0">
      <span v-if="!keys.length" class="text-sm text-text-sub">{{
        t('settings.config.noItems')
      }}</span>
      <div v-else class="flex flex-wrap gap-1.5">
        <span
          v-for="k in shown"
          :key="k"
          class="rounded bg-glass-border px-1.5 py-0.5 text-[11px] font-medium text-text-main"
        >
          {{ k.length > 20 ? k.slice(0, 20) + '…' : k }}
        </span>
        <span
          v-if="keys.length > MAX_CHIPS"
          class="rounded bg-glass-border/60 px-1.5 py-0.5 text-[11px] text-text-sub"
        >
          +{{ keys.length - MAX_CHIPS }}
        </span>
      </div>
    </div>
    <Button variant="secondary" class="shrink-0" @click="openDialog">{{ t('common.edit') }}</Button>
  </div>

  <div
    v-if="open"
    class="fixed inset-0 z-[70] flex items-center justify-center"
    style="background: rgba(0, 0, 0, 0.32)"
    role="dialog"
    aria-modal="true"
    @click.self="close"
    @keydown.esc="close"
  >
    <div class="ds-glass w-[600px] max-w-[92vw] rounded-panel p-5">
      <h2 class="text-md font-semibold text-text-main">
        {{ title || t('settings.config.editObject') }}
      </h2>
      <div class="mt-4 max-h-[400px] space-y-2 overflow-y-auto">
        <div
          v-for="(row, i) in rows"
          :key="i"
          class="grid grid-cols-[4fr_7fr_auto] items-center gap-2"
        >
          <Input v-model="row.k" :placeholder="t('settings.config.key')" />
          <Input v-model="row.v" :placeholder="t('settings.config.value')" />
          <button
            class="ds-icon-button min-h-8 min-w-8"
            style="color: var(--ds-danger)"
            :title="t('common.delete')"
            :aria-label="t('common.delete')"
            @click="rows.splice(i, 1)"
          >
            <Trash2 :size="16" :stroke-width="1.5" />
          </button>
        </div>
        <div v-if="!rows.length" class="py-4 text-center text-sm text-text-sub">
          {{ t('settings.config.noItems') }}
        </div>
      </div>
      <div class="mt-4 flex items-center justify-between">
        <button
          class="inline-flex items-center gap-1 text-sm"
          :style="{ color: 'var(--ds-brand-to)' }"
          @click="rows.push({ k: '', v: '' })"
        >
          <Plus :size="16" :stroke-width="2" /> {{ t('common.add') }}
        </button>
        <Button variant="primary" @click="close">{{ t('common.confirm') }}</Button>
      </div>
    </div>
  </div>
</template>
