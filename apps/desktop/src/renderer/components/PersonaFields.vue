<!-- components/PersonaFields.vue — persona 编辑字段组（⑩.7 从 PersonaPage 抽取复用）：
     模板 chips（可选）+ System Prompt 多行 + 开场白成对增删。双向 v-model 两字段。 -->
<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { PERSONA_TEMPLATES } from '@openpet/protocol';
import Button from './Button.vue';
import Input from './Input.vue';

const props = defineProps<{
  systemPrompt: string;
  beginDialogs: string[];
  showTemplates?: boolean;
  promptRows?: number;
}>();
const emit = defineEmits<{
  'update:systemPrompt': [v: string];
  'update:beginDialogs': [v: string[]];
}>();
const { t } = useI18n();

function applyTemplate(i: number): void {
  const tpl = PERSONA_TEMPLATES[i];
  if (tpl) emit('update:systemPrompt', tpl.systemPrompt);
}
function addDialogPair(): void {
  emit('update:beginDialogs', [...props.beginDialogs, '', '']);
}
function removeDialogPair(i: number): void {
  const next = [...props.beginDialogs];
  next.splice(i - (i % 2), 2);
  emit('update:beginDialogs', next);
}
function setDialog(i: number, v: string): void {
  const next = [...props.beginDialogs];
  next[i] = v;
  emit('update:beginDialogs', next);
}
</script>

<template>
  <div class="space-y-3">
    <div v-if="showTemplates">
      <span class="mb-1 block text-sm text-text-sub">{{ t('settings.persona.fromTemplate') }}</span>
      <div class="flex flex-wrap gap-2">
        <button
          v-for="(tpl, i) in PERSONA_TEMPLATES"
          :key="tpl.name"
          class="rounded-full border border-glass-border px-3 py-1 text-sm text-text-sub transition ease-ds hover:text-text-main"
          @click="applyTemplate(i)"
        >
          {{ tpl.name }}
        </button>
      </div>
    </div>

    <label class="block">
      <span class="mb-1 block text-sm text-text-sub">{{ t('settings.persona.prompt') }}</span>
      <textarea
        :value="systemPrompt"
        :rows="promptRows ?? 6"
        class="ds-control w-full rounded-input p-2 text-sm text-text-main"
        :placeholder="t('settings.persona.promptPlaceholder')"
        @input="emit('update:systemPrompt', ($event.target as HTMLTextAreaElement).value)"
      />
    </label>

    <div>
      <div class="mb-1 flex items-center justify-between">
        <span class="text-sm text-text-sub">{{ t('settings.persona.beginDialogs') }}</span>
        <Button variant="secondary" @click="addDialogPair">{{ t('settings.persona.addPair') }}</Button>
      </div>
      <div v-for="(_, i) in beginDialogs" :key="i" class="mb-2 flex items-center gap-2">
        <span class="w-10 shrink-0 text-xs text-text-sub">
          {{ i % 2 === 0 ? t('settings.persona.userRole') : t('settings.persona.charRole') }}
        </span>
        <Input
          :model-value="beginDialogs[i]!"
          :placeholder="i % 2 === 0 ? t('settings.persona.userSays') : t('settings.persona.charReplies')"
          @update:model-value="setDialog(i, $event)"
        />
        <button
          v-if="i % 2 === 1"
          class="shrink-0 text-sm text-text-sub hover:text-text-main"
          @click="removeDialogPair(i)"
        >
          {{ t('common.delete') }}
        </button>
      </div>
    </div>
  </div>
</template>
