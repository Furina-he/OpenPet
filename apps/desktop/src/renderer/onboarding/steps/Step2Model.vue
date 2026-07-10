<!-- apps/desktop/src/renderer/onboarding/steps/Step2Model.vue — C2 LLM 配置（ui-design §7.2；视觉 d63b4f97 C2 区）
     复用 ProviderConfigPanel（API Key / Ollama 两路径都在其中）。跳过演示 → emit('skip')（App 照常进 C3，
     无 active provider 时 C4 自动走 demo 空链）。 -->
<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import ProviderConfigPanel from '../../components/ProviderConfigPanel.vue';

const { t } = useI18n();
const emit = defineEmits<{ next: []; skip: [] }>();
</script>
<template>
  <div class="flex h-full flex-col">
    <div class="min-h-0 flex-1 overflow-y-auto">
      <div class="text-md text-text-main">{{ t('onboarding.modelTitle') }}</div>
      <p class="mt-1 text-base text-text-sub">
        {{ t('onboarding.modelLead') }}
      </p>

      <ProviderConfigPanel class="mt-4" />

      <div class="mt-4 rounded-card border border-glass-border p-3 text-sm text-text-sub">
        {{ t('onboarding.modelPrivacy') }}
      </div>
    </div>

    <div class="mt-5 flex items-center justify-between">
      <button class="text-sm text-text-sub hover:text-text-main" @click="emit('skip')">
        {{ t('onboarding.modelSkip') }}
      </button>
      <button
        class="rounded-btn px-5 py-2 text-base text-white"
        style="background: linear-gradient(90deg, var(--ds-brand-from), var(--ds-brand-to))"
        @click="emit('next')"
      >
        {{ t('onboarding.next') }}
      </button>
    </div>
  </div>
</template>
