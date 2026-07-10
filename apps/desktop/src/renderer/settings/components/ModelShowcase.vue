<!-- settings/components/ModelShowcase.vue — 总览页左柱：VRM 实时展示（呼吸/眨眼+视线跟鼠标），
     降级链 live→preview→首字占位（overview-view.showcaseMode）。离开页面 dispose 不留 WebGL。 -->
<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { CharacterManifest } from '@openpet/protocol';
import { createVrmRuntime } from '../../character/runtime';
import type { CharacterRuntime } from '../../character/runtime-types';
import { showcaseMode, previewUrlOf, modelUrlOf, type ShowcaseMode } from '../overview-view.js';

const props = defineProps<{
  characterId: string;
  manifest: CharacterManifest;
  companionDays: number;
}>();
const { t } = useI18n();
const stage = ref<HTMLElement | null>(null);
const mode = ref<ShowcaseMode>('preview');
let runtime: CharacterRuntime | null = null;
let rafPending = false;

function onMove(e: MouseEvent): void {
  if (!runtime || rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    runtime?.setLookAt(e.clientX, e.clientY);
  });
}

async function mount(): Promise<void> {
  unmount();
  mode.value = showcaseMode(props.manifest.engine, Boolean(props.manifest.preview), false);
  if (mode.value !== 'live' || !stage.value) return;
  try {
    runtime = await createVrmRuntime(
      stage.value,
      modelUrlOf(props.characterId, props.manifest),
      props.manifest,
    );
    runtime.setIdle({ mood: 'neutral', energy: 'mid' });
    window.addEventListener('mousemove', onMove);
  } catch {
    runtime = null;
    mode.value = showcaseMode(props.manifest.engine, Boolean(props.manifest.preview), true);
  }
}
function unmount(): void {
  window.removeEventListener('mousemove', onMove);
  runtime?.dispose();
  runtime = null;
}

onMounted(() => void mount());
onUnmounted(unmount);
watch(
  () => props.characterId,
  () => void mount(),
);
</script>

<template>
  <div class="ds-glass relative flex flex-1 flex-col overflow-hidden rounded-panel">
    <!-- live 舞台常驻 DOM（createVrmRuntime 需容器实尺寸），非 live 时隐藏 -->
    <div v-show="mode === 'live'" ref="stage" class="min-h-0 w-full flex-1" />
    <img
      v-if="mode === 'preview'"
      :src="previewUrlOf(characterId, manifest) ?? ''"
      :alt="manifest.name"
      class="min-h-0 w-full flex-1 object-contain p-3"
    />
    <div
      v-if="mode === 'initial'"
      class="flex min-h-0 flex-1 items-center justify-center text-6xl font-semibold text-white"
      :style="{ background: 'linear-gradient(135deg, var(--ds-brand-from), var(--ds-brand-to))' }"
    >
      {{ manifest.name.slice(0, 1) }}
    </div>

    <div class="flex flex-col items-center gap-1 border-t border-glass-border p-3">
      <div class="text-base font-semibold text-text-main">{{ manifest.name }}</div>
      <div class="flex items-center gap-1.5 text-xs" :style="{ color: 'var(--ds-success)' }">
        <span class="h-1.5 w-1.5 rounded-full" style="background: var(--ds-success)" />
        {{ t('settings.overview.model.online') }} ·
        <span class="text-text-sub">{{ t('settings.overview.model.companion', { days: companionDays }) }}</span>
      </div>
      <div
        v-if="mode === 'live'"
        class="mt-1 rounded-full border border-glass-border px-2 py-0.5 text-[10px] text-text-sub"
      >
        {{ t('settings.overview.model.liveTag') }}
      </div>
    </div>
  </div>
</template>
