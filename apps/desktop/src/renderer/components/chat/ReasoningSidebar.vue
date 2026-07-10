<!-- apps/desktop/src/renderer/components/chat/ReasoningSidebar.vue
     Hub 推理侧栏（C′ §3b，照 AstrBot ReasoningSidebar/ReasoningTimeline）。
     消费 chat.reasoning 流（即发即弃，不进气泡），暖色系（推理=思考温度），可折叠。 -->
<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { ChevronRight, Sparkles } from 'lucide-vue-next';

const props = withDefaults(
  defineProps<{
    items: { sessionId: string; text: string }[];
    collapsed?: boolean;
    streaming?: boolean;
  }>(),
  { collapsed: false, streaming: false },
);

const { t } = useI18n();
const emit = defineEmits<{ toggle: [] }>();

const text = computed(() => props.items.map((i) => i.text).join(''));
const hasContent = computed(() => text.value.length > 0);
</script>

<template>
  <!-- 折叠态：窄轨，仅图标 + 提示 -->
  <button
    v-if="collapsed"
    class="ds-icon-button flex h-full w-10 shrink-0 flex-col items-center gap-2 rounded-panel border border-glass-border py-3"
    :title="t('settings.reasoning.expand')"
    :aria-label="t('settings.reasoning.expand')"
    @click="emit('toggle')"
  >
    <Sparkles :size="16" :stroke-width="1.5" style="color: var(--ds-brand-to)" />
    <span
      v-if="streaming"
      class="h-1.5 w-1.5 animate-pulse rounded-full"
      style="background: var(--ds-brand-to)"
    />
  </button>

  <!-- 展开态：暖色推理流 -->
  <aside
    v-else
    class="flex h-full w-[300px] shrink-0 flex-col overflow-hidden rounded-panel border border-glass-border"
    style="background: var(--ds-warm-soft)"
  >
    <header class="flex items-center gap-2 px-3 py-2.5">
      <Sparkles :size="15" :stroke-width="1.5" style="color: var(--ds-brand-to)" />
      <span class="flex-1 text-sm font-semibold text-text-main">{{ t('settings.reasoning.title') }}</span>
      <span
        v-if="streaming"
        class="h-1.5 w-1.5 animate-pulse rounded-full"
        style="background: var(--ds-brand-to)"
      />
      <button class="ds-icon-button min-h-7 min-w-7" :title="t('settings.reasoning.collapse')" :aria-label="t('settings.reasoning.collapse')" @click="emit('toggle')">
        <ChevronRight :size="15" :stroke-width="1.5" />
      </button>
    </header>
    <div class="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
      <p
        v-if="hasContent"
        class="whitespace-pre-wrap break-words text-sm leading-relaxed text-text-sub"
      >
        {{ text }}
      </p>
      <p v-else class="mt-6 text-center text-sm text-text-sub">
        {{ streaming ? t('settings.reasoning.thinking') : t('settings.reasoning.empty') }}
      </p>
    </div>
  </aside>
</template>
