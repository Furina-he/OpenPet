<!-- apps/desktop/src/renderer/components/chat/ChatInput.vue
     Hub 会话输入行（C′ §3b，照 AstrBot ChatInput）：文本 + 发送/停止 +
     语音输入（F-VC：点击开录→点击停止→转写追加输入框，Esc 取消；照 AstrBot 点击切换式）。
     附件留后（§3c）。v-model 草稿，emit send/cancel。 -->
<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { Loader2, Mic, Paperclip, Send, Square } from 'lucide-vue-next';
import { createVoiceRecorder } from './use-voice-record';

const props = withDefaults(
  defineProps<{
    modelValue: string;
    disabled?: boolean;
    streaming?: boolean;
  }>(),
  { disabled: false, streaming: false },
);

const { t } = useI18n();
const emit = defineEmits<{
  'update:modelValue': [value: string];
  send: [];
  cancel: [];
}>();

function onInput(e: Event): void {
  emit('update:modelValue', (e.target as HTMLTextAreaElement).value);
}

const {
  state: voiceState,
  micError,
  elapsedMs,
  toggle: toggleRecord,
} = createVoiceRecorder({
  enabled: () => !props.disabled,
  onText: (text) => emit('update:modelValue', props.modelValue + text),
});

const recordLabel = computed(() => {
  const s = Math.floor(elapsedMs.value / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
});
const placeholder = computed(() =>
  voiceState.value === 'recording'
    ? t('settings.chatInput.listening')
    : voiceState.value === 'transcribing'
      ? t('settings.chatInput.transcribing')
      : t('settings.chatInput.placeholder'),
);
</script>

<template>
  <div class="ds-control flex items-end gap-2 rounded-panel px-3 py-2">
    <button class="ds-icon-button mb-0.5 min-h-8 min-w-8" :title="t('settings.chatInput.attachSoon')" :aria-label="t('settings.chatInput.attachSoon')" disabled>
      <Paperclip :size="17" :stroke-width="1.5" />
    </button>
    <textarea
      :value="modelValue"
      class="max-h-32 min-h-[2rem] min-w-0 flex-1 resize-none bg-transparent px-1 py-1 text-base leading-relaxed outline-none placeholder:text-text-sub"
      rows="1"
      :placeholder="placeholder"
      :disabled="disabled"
      @input="onInput"
      @keydown.enter.exact.prevent="emit('send')"
    />
    <span
      v-if="voiceState === 'recording'"
      class="mb-1.5 flex shrink-0 items-center gap-1 font-mono text-xs text-danger"
    >
      <span class="h-2 w-2 animate-pulse rounded-full bg-danger" />
      {{ recordLabel }}
    </span>
    <button
      class="ds-icon-button mb-0.5 min-h-8 min-w-8 select-none"
      :class="voiceState === 'recording' || micError ? 'text-danger' : ''"
      :title="
        voiceState === 'recording'
          ? t('settings.chatInput.stopAndTranscribe')
          : voiceState === 'transcribing'
            ? t('settings.chatInput.transcribing')
            : t('settings.chatInput.voiceInput')
      "
      :aria-label="
        voiceState === 'recording'
          ? t('settings.chatInput.stopAndTranscribe')
          : voiceState === 'transcribing'
            ? t('settings.chatInput.transcribing')
            : t('settings.chatInput.voiceInput')
      "
      :disabled="disabled || voiceState === 'transcribing'"
      @click="toggleRecord"
    >
      <Square v-if="voiceState === 'recording'" :size="14" fill="currentColor" />
      <Loader2 v-else-if="voiceState === 'transcribing'" :size="17" class="animate-spin" />
      <Mic v-else :size="17" :stroke-width="1.5" />
    </button>
    <button
      v-if="!streaming"
      class="mb-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white transition ease-ds active:scale-[0.97] disabled:opacity-40"
      style="background: linear-gradient(135deg, var(--ds-brand-from), var(--ds-brand-to))"
      :disabled="disabled || !modelValue.trim()"
      :title="t('settings.chatInput.send')"
      :aria-label="t('settings.chatInput.send')"
      @click="emit('send')"
    >
      <Send :size="17" :stroke-width="1.5" />
    </button>
    <button
      v-else
      class="mb-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-glass-border text-text-sub transition ease-ds active:scale-[0.97]"
      :title="t('settings.chatInput.stop')"
      :aria-label="t('settings.chatInput.stop')"
      @click="emit('cancel')"
    >
      <Square :size="15" :stroke-width="1.5" />
    </button>
  </div>
</template>
