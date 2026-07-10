<!-- apps/desktop/src/renderer/onboarding/steps/Step1Welcome.vue — C1 欢迎（ui-design §7.1；视觉 d63b4f97 C1 区） -->
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Prefs } from '@openpet/protocol';
import { DEFAULT_PREFS } from '@openpet/protocol';
import Select from '../../components/Select.vue';

const { t } = useI18n();
const emit = defineEmits<{ next: [] }>();
const language = ref<Prefs['general.language']>(DEFAULT_PREFS['general.language']);
const LANGS = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'en', label: 'English' },
];

onMounted(async () => {
  const prefs = (await window.openpet.rpc('app.prefs.getAll', {})) as Prefs;
  language.value = prefs['general.language'];
});

async function setLanguage(v: string): Promise<void> {
  language.value = v;
  await window.openpet.rpc('app.prefs.set', { key: 'general.language', value: v });
}
</script>
<template>
  <div class="flex h-full flex-col">
    <div class="flex-1">
      <div class="text-lg text-text-main">{{ t('onboarding.welcomeTitle') }}</div>
      <p class="mt-2 text-base text-text-sub">{{ t('onboarding.welcomeLead') }}</p>
      <ol class="mt-3 space-y-2 text-base text-text-main">
        <li>① {{ t('onboarding.welcomeStep1') }}</li>
        <li>② {{ t('onboarding.welcomeStep2') }}</li>
        <li>③ {{ t('onboarding.welcomeStep3') }}</li>
      </ol>
    </div>
    <div class="mt-6 flex items-center justify-between">
      <div class="w-[160px]">
        <Select :model-value="language" :options="LANGS" @update:model-value="setLanguage" />
      </div>
      <button
        class="rounded-btn px-5 py-2 text-base text-white"
        style="background: linear-gradient(90deg, var(--ds-brand-from), var(--ds-brand-to))"
        @click="emit('next')"
      >
        {{ t('onboarding.start') }}
      </button>
    </div>
  </div>
</template>
