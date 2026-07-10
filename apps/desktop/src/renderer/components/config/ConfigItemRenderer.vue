<!-- config/ConfigItemRenderer.vue — metadata→glass 控件分发（照 AstrBot ConfigItemRenderer，控件换 openpet glass）。 -->
<script setup lang="ts">
import { computed } from 'vue';
import { pickWidget, type ConfigItemMeta } from '@openpet/protocol';
import Input from '../Input.vue';
import Select from '../Select.vue';
import Switch from '../Switch.vue';
import Slider from '../Slider.vue';
import DictEditor from './widgets/DictEditor.vue';
import SelectProviderWidget from './widgets/SelectProviderWidget.vue';

const props = defineProps<{ meta: ConfigItemMeta; modelValue: unknown }>();
const emit = defineEmits<{ 'update:modelValue': [unknown] }>();

const kind = computed(() => pickWidget(props.meta));
const up = (v: unknown): void => emit('update:modelValue', v);

const selectOptions = computed(() =>
  (props.meta.options ?? []).map((v, i) => ({
    value: String(v),
    label: props.meta.labels?.[i] ?? String(v),
  })),
);
const arrayValue = computed<string[]>(() =>
  Array.isArray(props.modelValue) ? (props.modelValue as unknown[]).map(String) : [],
);
function toggleMulti(v: string): void {
  const cur = new Set(arrayValue.value);
  if (cur.has(v)) cur.delete(v);
  else cur.add(v);
  up([...cur]);
}
</script>
<template>
  <SelectProviderWidget
    v-if="kind === 'selectProvider'"
    :model-value="(modelValue as string) ?? ''"
    @update:model-value="up"
  />
  <div
    v-else-if="kind === 'selectPersona' || kind === 'selectKnowledgeBase'"
    class="text-sm text-text-sub"
  >
    （暂未接入，留 §5/§6）
  </div>
  <Select
    v-else-if="kind === 'select'"
    :model-value="String(modelValue ?? '')"
    :options="selectOptions"
    @update:model-value="up"
  />
  <div
    v-else-if="kind === 'checkbox-group' || kind === 'multi-select'"
    class="flex flex-wrap gap-2"
  >
    <button
      v-for="o in selectOptions"
      :key="o.value"
      class="rounded-full px-3 py-1 text-sm transition"
      :class="
        arrayValue.includes(o.value) ? 'text-white' : 'border border-glass-border text-text-sub'
      "
      :style="
        arrayValue.includes(o.value)
          ? 'background: linear-gradient(135deg, var(--ds-brand-from), var(--ds-brand-to))'
          : ''
      "
      @click="toggleMulti(o.value)"
    >
      {{ o.label }}
    </button>
  </div>
  <Slider
    v-else-if="kind === 'slider'"
    :model-value="Number(modelValue) || meta.slider!.min"
    :min="meta.slider!.min"
    :max="meta.slider!.max"
    :step="meta.slider!.step ?? 1"
    @update:model-value="up"
  />
  <Input
    v-else-if="kind === 'number'"
    :model-value="modelValue === undefined || modelValue === null ? '' : String(modelValue)"
    :placeholder="meta.hint"
    @update:model-value="(v) => up(v === '' ? undefined : Number(v))"
  />
  <textarea
    v-else-if="kind === 'text'"
    class="ds-control w-full rounded-input px-3 py-2 text-base text-text-main"
    rows="3"
    :value="String(modelValue ?? '')"
    @input="up(($event.target as HTMLTextAreaElement).value)"
  ></textarea>
  <Switch v-else-if="kind === 'bool'" :model-value="Boolean(modelValue)" @update:model-value="up" />
  <DictEditor
    v-else-if="kind === 'dict'"
    :model-value="(modelValue as Record<string, string>) ?? {}"
    @update:model-value="up"
  />
  <Input
    v-else
    :model-value="String(modelValue ?? '')"
    :placeholder="meta.hint"
    @update:model-value="up"
  />
</template>
