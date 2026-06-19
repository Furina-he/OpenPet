<!-- apps/desktop/src/renderer/onboarding/App.vue — 引导壳（ui-design §7 贯穿壳：4 步指示器 + 跳过） -->
<script setup lang="ts">
import { ref } from 'vue';
import {
  next as wizNext,
  currentStep,
  stepNumber,
  wizardFromStep,
  type WizardState,
} from './wizard';
import Step1Welcome from './steps/Step1Welcome.vue';
import Step2Model from './steps/Step2Model.vue';
import Step3Character from './steps/Step3Character.vue';
import Step4FirstChat from './steps/Step4FirstChat.vue';
import StepDone from './steps/StepDone.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';

const STEP_LABELS = ['欢迎', '模型', '角色', '互动'];

// dev harness：?step=welcome|model|character|firstchat|done
const wiz = ref<WizardState>(
  wizardFromStep(new URLSearchParams(window.location.search).get('step')),
);
const askSkip = ref(false);

function advance(): void {
  wiz.value = wizNext(wiz.value);
}
async function finish(): Promise<void> {
  await window.desksoul.rpc('app.window.finishOnboarding', {});
}
function confirmSkip(): void {
  askSkip.value = false;
  void finish();
}
</script>
<template>
  <div class="flex h-screen flex-col p-6 text-base" style="background: var(--ds-glass-bg)">
    <!-- 顶部：步骤指示器 + 跳过（完成页不显） -->
    <header v-if="!wiz.finished" class="mb-5 flex items-center justify-between">
      <div class="flex items-center gap-2">
        <template v-for="(label, i) in STEP_LABELS" :key="label">
          <span
            class="text-sm"
            :class="i + 1 === stepNumber(wiz) ? 'text-text-main' : 'text-text-sub'"
          >
            {{ i + 1 }} {{ label }}
          </span>
          <span v-if="i < STEP_LABELS.length - 1" class="text-text-sub">·</span>
        </template>
      </div>
      <button class="text-sm text-text-sub hover:text-text-main" @click="askSkip = true">
        跳过
      </button>
    </header>

    <!-- 步骤内容 -->
    <main class="min-h-0 flex-1">
      <Step1Welcome v-if="currentStep(wiz) === 'welcome' && !wiz.finished" @next="advance" />
      <Step2Model
        v-else-if="currentStep(wiz) === 'model' && !wiz.finished"
        @next="advance"
        @skip="advance"
      />
      <Step3Character
        v-else-if="currentStep(wiz) === 'character' && !wiz.finished"
        @next="advance"
      />
      <Step4FirstChat
        v-else-if="currentStep(wiz) === 'firstchat' && !wiz.finished"
        @next="advance"
      />
      <StepDone v-else @finish="finish" />
    </main>

    <ConfirmDialog
      :open="askSkip"
      title="跳过引导？"
      detail="跳过后默认角色仍可用，但你需要手动配置模型。"
      confirm-label="跳过引导"
      @confirm="confirmSkip"
      @cancel="askSkip = false"
    />
  </div>
</template>
