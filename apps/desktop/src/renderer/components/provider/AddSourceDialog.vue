<!-- components/provider/AddSourceDialog.vue — Provider 工作台「新增提供商源」弹窗
     对齐 AstrBot AddNewProvider + §2 glass token。逻辑：选模板 → 用 generateUniqueSourceId
     合成 ProviderSource（key 空、apiBase=模板默认）→ emit create。父用 v-if 控制可见。 -->
<script setup lang="ts">
import { computed } from 'vue';
import {
  generateUniqueSourceId,
  type AdapterTemplate,
  type Capability,
  type ProviderSource,
} from '@desksoul/protocol';

const props = defineProps<{
  templates: AdapterTemplate[];
  existingIds: string[];
  capability: Capability;
}>();
const emit = defineEmits<{ create: [source: ProviderSource]; close: [] }>();

const choices = computed(() => props.templates.filter((t) => t.capability === props.capability));

function pick(t: AdapterTemplate): void {
  const id = generateUniqueSourceId(t.adapter, props.existingIds);
  emit('create', {
    id,
    adapter: t.adapter,
    capability: props.capability,
    apiBase: t.defaultApiBase,
    key: '',
    enabled: true,
  });
  emit('close');
}
</script>

<template>
  <div
    class="fixed inset-0 z-[60] flex items-center justify-center"
    style="background: rgba(0, 0, 0, 0.32)"
    @click.self="emit('close')"
  >
    <div class="ds-glass w-[460px] rounded-panel p-5">
      <div class="text-md font-semibold text-text-main">新增提供商源</div>
      <div class="mt-1 text-sm text-text-sub">选择一个适配器模板，稍后填写 API Key 与模型。</div>
      <div class="mt-4 grid grid-cols-2 gap-3">
        <button
          v-for="t in choices"
          :key="t.adapter"
          class="ds-glass rounded-card border border-glass-border p-3 text-left transition hover:border-brand-to"
          @click="pick(t)"
        >
          <div class="font-semibold text-text-main">{{ t.label }}</div>
          <div class="mt-1 truncate text-sm text-text-sub">{{ t.defaultApiBase }}</div>
        </button>
        <div
          v-if="!choices.length"
          class="col-span-2 rounded-card border border-glass-border p-4 text-center text-sm text-text-sub"
        >
          该能力暂无可用适配器模板
        </div>
      </div>
      <div class="mt-5 flex justify-end">
        <button class="rounded-btn px-4 py-2 text-base text-text-sub" @click="emit('close')">
          取消
        </button>
      </div>
    </div>
  </div>
</template>
