<!-- config/widgets/SelectProviderWidget.vue — special:selectProvider，复用 provider.getConfig 的 models。 -->
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { ModelEntry } from '@openpet/protocol';
import Select from '../../Select.vue';

defineProps<{ modelValue: string }>();
const emit = defineEmits<{ 'update:modelValue': [string] }>();

const options = ref<{ value: string; label: string }[]>([]);
onMounted(async () => {
  try {
    const cfg = (await window.openpet.rpc('provider.getConfig', {})) as { models: ModelEntry[] };
    options.value = cfg.models.map((m) => ({ value: m.id, label: m.id }));
  } catch {
    options.value = [];
  }
});
</script>
<template>
  <Select
    :model-value="modelValue"
    :options="options"
    @update:model-value="(v) => emit('update:modelValue', v)"
  />
</template>
