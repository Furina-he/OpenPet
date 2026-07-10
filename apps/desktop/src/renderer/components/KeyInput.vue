<!-- components/KeyInput.vue — §7.3 API Key 输入（遮罩 + 点眼睛显示 5s，5s 后自动遮回） -->
<script setup lang="ts">
import { ref, reactive } from 'vue';
import { useI18n } from 'vue-i18n';
import { Eye, EyeOff } from 'lucide-vue-next';
import { KeyReveal } from '../settings/key-reveal';

const props = defineProps<{ hasKey: boolean }>();
const { t } = useI18n();
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
  <div class="ds-control flex items-center gap-2 rounded-input px-3 py-2">
    <input
      v-model="draft"
      class="min-w-0 flex-1 bg-transparent text-base text-text-main outline-none"
      :type="reveal.revealed ? 'text' : 'password'"
      :placeholder="props.hasKey ? t('settings.keyInput.configured') : 'sk-...'"
    />
    <button
      class="ds-icon-button min-h-8 min-w-8 shrink-0"
      :title="t('settings.keyInput.toggleShow')"
      :aria-label="t('settings.keyInput.toggleShow')"
      @click="reveal.revealed ? reveal.hideNow() : reveal.reveal()"
    >
      <component :is="reveal.revealed ? EyeOff : Eye" :size="16" :stroke-width="1.5" />
    </button>
    <button
      class="shrink-0 rounded-btn px-3 py-1.5 text-sm text-white disabled:opacity-40"
      style="background: linear-gradient(90deg, var(--ds-brand-from), var(--ds-brand-to))"
      :disabled="!draft"
      @click="onSave"
    >
      {{ t('common.save') }}
    </button>
    <button
      v-if="props.hasKey"
      class="shrink-0 rounded-btn px-2 py-1.5 text-sm text-text-sub"
      @click="emit('clear')"
    >
      {{ t('settings.keyInput.clear') }}
    </button>
  </div>
</template>
