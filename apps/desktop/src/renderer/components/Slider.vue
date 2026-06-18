<!-- apps/desktop/src/renderer/components/Slider.vue -->
<script setup lang="ts">
import { computed } from 'vue';
const props = defineProps<{ modelValue: number; min?: number; max?: number; step?: number }>();
// update:modelValue 逐拖动（@input）即时预览；change 仅松手/键盘提交一次（用于持久化）。
const emit = defineEmits<{ 'update:modelValue': [number]; change: [number] }>();
// 已填充比例 → CSS 变量，驱动轨道暖色填充（§2 品牌锚点，非冷色）。
const pct = computed(() => {
  const min = props.min ?? 0;
  const max = props.max ?? 100;
  return max === min ? 0 : Math.min(100, Math.max(0, ((props.modelValue - min) / (max - min)) * 100));
});
</script>
<template>
  <input
    type="range"
    class="ds-slider"
    :style="{ '--ds-pct': pct + '%' }"
    :min="min ?? 0"
    :max="max ?? 100"
    :step="step ?? 1"
    :value="modelValue"
    @input="emit('update:modelValue', Number(($event.target as HTMLInputElement).value))"
    @change="emit('change', Number(($event.target as HTMLInputElement).value))"
  />
</template>
<style scoped>
.ds-slider {
  -webkit-appearance: none;
  appearance: none;
  width: 11rem;
  height: 6px;
  border-radius: 9999px;
  /* 左侧品牌暖色渐变填充至 --ds-pct，右侧轨道用玻璃描边色。 */
  background: linear-gradient(
    90deg,
    var(--ds-brand-from) 0%,
    var(--ds-brand-to) var(--ds-pct),
    var(--ds-glass-border) var(--ds-pct),
    var(--ds-glass-border) 100%
  );
  outline: none;
  cursor: pointer;
}
.ds-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  border: 2px solid var(--ds-brand-to);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
  cursor: pointer;
}
.ds-slider::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  border: 2px solid var(--ds-brand-to);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
  cursor: pointer;
}
</style>
