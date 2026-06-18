<!-- components/KeyInput.vue — §7.3 API Key 输入（遮罩 + 点眼睛显示 5s，5s 后自动遮回） -->
<script setup lang="ts">
import { ref, reactive } from 'vue';
import { Eye, EyeOff } from 'lucide-vue-next';
import { KeyReveal } from '../settings/key-reveal';

const props = defineProps<{ hasKey: boolean }>();
const emit = defineEmits<{ save: [key: string]; clear: [] }>();
const draft = ref('');
// reactive 包裹类实例：reveal/hideNow 改 this.revealed 经 Proxy 触发模板重渲染。
const reveal = reactive(new KeyReveal());

function onSave(): void {
  if (!draft.value) return;
  emit('save', draft.value);
  draft.value = '';
}
</script>

<template>
  <div class="ds-glass flex items-center gap-2 rounded-btn px-3 py-2">
    <input
      v-model="draft"
      class="min-w-0 flex-1 bg-transparent text-base text-text-main outline-none"
      :type="reveal.revealed ? 'text' : 'password'"
      :placeholder="props.hasKey ? '已配置（重新输入以替换）' : 'sk-...'"
    />
    <button
      class="shrink-0 text-text-sub"
      title="显示/隐藏"
      @click="reveal.revealed ? reveal.hideNow() : reveal.reveal()"
    >
      <component :is="reveal.revealed ? EyeOff : Eye" :size="16" :stroke-width="1.5" />
    </button>
    <button
      class="shrink-0 rounded-btn px-3 py-1 text-sm text-white disabled:opacity-40"
      style="background: linear-gradient(90deg, var(--ds-brand-from), var(--ds-brand-to))"
      :disabled="!draft"
      @click="onSave"
    >
      保存
    </button>
    <button
      v-if="props.hasKey"
      class="shrink-0 rounded-btn px-2 py-1 text-sm text-text-sub"
      @click="emit('clear')"
    >
      清除
    </button>
  </div>
</template>
