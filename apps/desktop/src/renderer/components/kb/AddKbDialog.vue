<!-- components/kb/AddKbDialog.vue — 新建知识库（§5，照 AstrBot KB 表单 + §2 glass）。
     名 + emoji；嵌入模型用「模型 API」配的全局默认 embedding 模型（resolveEmbeddingTarget），
     未配则提示去配置（MVP 不做 per-KB 选模型，见 RESULTS follow-up）。 -->
<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { ref, watch } from 'vue';
import Input from '../Input.vue';
import Button from '../Button.vue';

const { t } = useI18n();
const props = defineProps<{ open: boolean; embeddingModelLabel: string | null }>();
const emit = defineEmits<{ create: [{ name: string; emoji: string }]; cancel: [] }>();

const name = ref('');
const emoji = ref('📚');

watch(
  () => props.open,
  (open) => {
    if (open) {
      name.value = '';
      emoji.value = '📚';
    }
  },
);

function save(): void {
  if (!name.value.trim()) return;
  emit('create', { name: name.value.trim(), emoji: emoji.value.trim() || '📚' });
}
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 z-[60] flex items-center justify-center"
    style="background: rgba(0, 0, 0, 0.32)"
    @click.self="emit('cancel')"
  >
    <div class="ds-glass w-[460px] rounded-panel p-5">
      <div class="text-md font-semibold text-text-main">{{ t('settings.kb.createTitle') }}</div>

      <div class="mt-4 space-y-3">
        <label class="block">
          <span class="mb-1 block text-sm text-text-sub">{{ t('settings.persona.name') }}</span>
          <Input v-model="name" :placeholder="t('settings.kb.namePlaceholder')" />
        </label>
        <label class="block">
          <span class="mb-1 block text-sm text-text-sub">{{ t('settings.kb.emojiLabel') }}</span>
          <Input v-model="emoji" placeholder="📚" />
        </label>

        <div class="rounded-card px-3 py-2 text-sm" style="background: var(--ds-warm-soft)">
          <template v-if="embeddingModelLabel">
            {{ t('settings.kb.embeddingModel') }}<span class="font-medium text-text-main">{{ embeddingModelLabel }}</span>
            {{ t('settings.kb.embeddingModelNote') }}
          </template>
          <template v-else>
            <span style="color: var(--ds-danger)">{{ t('settings.kb.noEmbedding') }}</span>{{ t('settings.kb.noEmbeddingHint') }}
          </template>
        </div>
      </div>

      <div class="mt-5 flex justify-end gap-2">
        <Button variant="ghost" @click="emit('cancel')">{{ t('common.cancel') }}</Button>
        <Button variant="primary" :disabled="!name.trim()" @click="save">{{ t('settings.kb.createLabel') }}</Button>
      </div>
    </div>
  </div>
</template>
