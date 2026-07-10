<!-- config/widgets/DictEditor.vue — 键值对编辑（= AstrBot ObjectEditor），用 glass Input。 -->
<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { ref, watch } from 'vue';
import { Plus, Trash2 } from 'lucide-vue-next';
import Input from '../../Input.vue';

const { t } = useI18n();
const props = defineProps<{ modelValue: Record<string, string> }>();
const emit = defineEmits<{ 'update:modelValue': [Record<string, string>] }>();

function toRows(o?: Record<string, string>): { k: string; v: string }[] {
  return Object.entries(o ?? {}).map(([k, v]) => ({ k, v }));
}
const rows = ref(toRows(props.modelValue));

function currentObj(): Record<string, string> {
  const obj: Record<string, string> = {};
  for (const r of rows.value) if (r.k) obj[r.k] = r.v;
  return obj;
}
// 外部值与本地非空行不一致时才 resync（避免打断正在输入的空行）。
watch(
  () => props.modelValue,
  (val) => {
    if (JSON.stringify(currentObj()) !== JSON.stringify(val ?? {})) rows.value = toRows(val);
  },
  { deep: true },
);

function push(): void {
  emit('update:modelValue', currentObj());
}
function setKey(i: number, k: string): void {
  const r = rows.value[i];
  if (r) r.k = k;
  push();
}
function setVal(i: number, v: string): void {
  const r = rows.value[i];
  if (r) r.v = v;
  push();
}
function add(): void {
  rows.value.push({ k: '', v: '' });
}
function remove(i: number): void {
  rows.value.splice(i, 1);
  push();
}
</script>
<template>
  <div class="grid gap-2">
    <div v-for="(row, i) in rows" :key="i" class="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
      <Input :model-value="row.k" :placeholder="t('settings.config.key')" @update:model-value="(v) => setKey(i, v)" />
      <Input :model-value="row.v" :placeholder="t('settings.config.value')" @update:model-value="(v) => setVal(i, v)" />
      <button class="text-danger" :title="t('common.delete')" :aria-label="t('common.delete')" @click="remove(i)">
        <Trash2 :size="18" :stroke-width="1.6" />
      </button>
    </div>
    <button
      class="inline-flex w-fit items-center gap-1 text-sm"
      style="color: var(--ds-cool)"
      @click="add"
    >
      <Plus :size="16" :stroke-width="2" /> {{ t('common.add') }}
    </button>
  </div>
</template>
