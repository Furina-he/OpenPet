<!-- apps/desktop/src/renderer/overlay/components/Bubble.vue — B2 单条气泡（ui-design §6.2 + J3 §14.3）
     状态：思考三点 / 长文折叠 / 错误红左条+分级台词+操作；情绪 chip（双轨）经 emotion prop。 -->
<script setup lang="ts">
import { ref, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ChatMessage } from '../chat-view';
import { isEmptyReply } from '../chat-view';
import { isThinking, shouldFold } from '../bubble-view';
import { errorCopy, type ErrorAction } from '../error-copy';
import EmotionChip from './EmotionChip.vue';

const props = defineProps<{ message: ChatMessage; streaming: boolean; emotion?: string }>();
const { t } = useI18n();
const emit = defineEmits<{ action: [ErrorAction] }>();

const expanded = ref(false);
const thinking = computed(() => isThinking(props.message, props.streaming));
const isError = computed(() => props.message.finishReason === 'error');
const copy = computed(() => errorCopy(props.message.errorKind));
const folded = computed(
  () =>
    props.message.role === 'assistant' &&
    !isError.value &&
    shouldFold(props.message.text) &&
    !expanded.value,
);
const ACTION_LABEL = computed<Record<ErrorAction, string>>(() => ({
  retry: t('overlay.actionRetry'),
  switchModel: t('overlay.actionSwitchModel'),
  changeKey: t('overlay.actionChangeKey'),
}));
</script>

<template>
  <!-- 错误态：玻璃 + 红左条 + 分级台词 + 操作 -->
  <div
    v-if="isError"
    class="ds-glass max-w-[86%] self-start rounded-bubble px-3.5 py-2.5 text-base text-text-main"
    style="border-left: 3px solid var(--ds-danger)"
  >
    <div>{{ t(copy.line) }}</div>
    <div class="mt-2 flex gap-2">
      <button
        v-for="a in copy.actions"
        :key="a"
        class="rounded-btn border border-glass-border px-3 py-1 text-sm text-text-sub hover:text-text-main"
        @click="emit('action', a)"
      >
        {{ ACTION_LABEL[a] }}
      </button>
    </div>
  </div>

  <!-- 思考态：三点呼吸 -->
  <div
    v-else-if="thinking"
    class="ds-glass max-w-[86%] self-start rounded-bubble px-3.5 py-3 text-text-sub"
    style="border-left: 3px solid var(--ds-brand-from)"
  >
    <span class="inline-flex gap-1">
      <span class="h-1.5 w-1.5 animate-pulse rounded-full" style="background: var(--ds-text-sub)" />
      <span
        class="h-1.5 w-1.5 animate-pulse rounded-full [animation-delay:150ms]"
        style="background: var(--ds-text-sub)"
      />
      <span
        class="h-1.5 w-1.5 animate-pulse rounded-full [animation-delay:300ms]"
        style="background: var(--ds-text-sub)"
      />
    </span>
  </div>

  <!-- 常态气泡 -->
  <div
    v-else
    class="max-w-[86%] whitespace-pre-wrap break-words rounded-bubble px-3.5 py-2.5 text-base leading-relaxed"
    :class="message.role === 'user' ? 'self-end text-white' : 'ds-glass self-start text-text-main'"
    :style="
      message.role === 'user'
        ? 'background: linear-gradient(90deg, var(--ds-brand-from), var(--ds-brand-to))'
        : 'border-left: 3px solid var(--ds-brand-from)'
    "
  >
    <EmotionChip v-if="emotion" :label="emotion" class="mb-1 mr-1" />
    <span v-if="isEmptyReply(message)" class="italic text-text-sub">{{ t('overlay.emptyReply') }}</span>
    <span v-else :class="folded ? 'line-clamp-3' : ''">{{ message.text }}</span>
    <span
      v-if="message.role === 'assistant' && message.finishReason === null && streaming"
      class="ml-0.5 inline-block h-[1.1em] w-[7px] translate-y-[2px] animate-pulse"
      style="background: var(--ds-brand-to)"
    />
    <button
      v-if="message.role === 'assistant' && shouldFold(message.text)"
      class="mt-1 block text-sm text-text-sub hover:text-text-main"
      @click="expanded = !expanded"
    >
      {{ expanded ? t('overlay.foldUp') : t('overlay.expand') }}
    </button>
    <span
      v-if="message.finishReason === 'cancel'"
      class="ml-2 rounded-full bg-glass-border px-2 py-0.5 text-sm text-text-sub"
    >
      {{ t('overlay.cancelled') }}
    </span>
  </div>
</template>
