<!-- apps/desktop/src/renderer/onboarding/steps/Step3Character.vue — C3 角色选择（ui-design §7.3；视觉 98171885 C3 区）
     默认伙伴「小灵」+ 就用 TA→；「看看其他角色」禁用（E1 角色库 V1，spec §1 OUT）。 -->
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const emit = defineEmits<{ next: [] }>();
const name = ref(t('overlay.defaultCharName'));
const META = computed(() => t('onboarding.characterMeta'));

onMounted(async () => {
  try {
    const c = (await window.openpet.rpc('character.current', {})) as {
      manifest?: { name?: string };
    };
    if (c.manifest?.name) name.value = c.manifest.name;
  } catch {
    /* 读不到 manifest → 保留默认名（不阻塞引导） */
  }
});
</script>
<template>
  <div class="flex h-full flex-col">
    <div class="min-h-0 flex-1">
      <div class="text-md text-text-main">{{ t('onboarding.characterTitle') }}</div>
      <!-- 立绘占位块（VRM 立绘渲染留后续；占位不阻塞流程） -->
      <div
        class="mx-auto mt-4 flex h-[220px] w-[160px] items-center justify-center rounded-card text-5xl"
        style="
          background: linear-gradient(160deg, var(--ds-brand-from), var(--ds-brand-to));
          opacity: 0.85;
        "
        aria-hidden="true"
      >
        🧚
      </div>
      <div class="mt-3 text-center text-md text-text-main">{{ name }}</div>
      <div class="mt-1 text-center text-sm text-text-sub">{{ META }}</div>
    </div>

    <div class="mt-6 flex items-center justify-center gap-3">
      <button
        class="rounded-btn border border-glass-border px-4 py-2 text-base text-text-sub opacity-50"
        disabled
        :title="t('onboarding.libraryComingSoon')"
      >
        {{ t('onboarding.browseOthers') }}
      </button>
      <button
        class="rounded-btn px-5 py-2 text-base text-white"
        style="background: linear-gradient(90deg, var(--ds-brand-from), var(--ds-brand-to))"
        @click="emit('next')"
      >
        {{ t('onboarding.useThis') }}
      </button>
    </div>
  </div>
</template>
