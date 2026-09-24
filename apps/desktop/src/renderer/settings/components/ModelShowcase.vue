<!-- settings/components/ModelShowcase.vue — 总览页左柱：VRM 实时展示（呼吸/眨眼+视线跟鼠标），
     降级链 live→preview→首字占位（overview-view.showcaseMode）。离开页面 dispose 不留 WebGL。
     ⑩.7：compact 态（E2 抽屉/E4 编辑器复用，隐藏 footer）+ expose 表情/动作试播驱动。
     ⑳ sprite：CSS 帧预览常动（SpriteThumb，不载 pixi），试播按映射点播对应行；加载失败降级 preview/首字。 -->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { CharacterManifest } from '@openpet/protocol';
import { createVrmRuntime } from '../../character/runtime';
import type { CharacterRuntime } from '../../character/runtime-types';
import { showcaseMode, previewUrlOf, modelUrlOf, type ShowcaseMode } from '../overview-view.js';
import { spriteSourceOf } from '../character-library-view.js';
import { actionPreviewState, emotionPreviewState, tryResolveSprite } from '../sprite-thumb.js';
import SpriteThumb from './SpriteThumb.vue';

const props = defineProps<{
  characterId: string;
  manifest: CharacterManifest;
  companionDays?: number;
  /** E2/E4 复用：只留舞台，不渲染名称/在线 footer。 */
  compact?: boolean;
}>();
const { t } = useI18n();
const stage = ref<HTMLElement | null>(null);
const mode = ref<ShowcaseMode>('preview');
let runtime: CharacterRuntime | null = null;
let rafPending = false;

// ⑳ sprite 舞台：量出容器尺寸喂给 SpriteThumb（它按像素盒 contain）
const spriteBox = ref<HTMLElement | null>(null);
const spriteSize = ref({ w: 0, h: 0 });
const thumb = ref<InstanceType<typeof SpriteThumb> | null>(null);
const spriteSource = computed(() => spriteSourceOf(props.characterId, props.manifest));
const spriteResolved = computed(() => tryResolveSprite(props.manifest.sprite));
const spriteObserver = new ResizeObserver((entries) => {
  const r = entries[0]?.contentRect;
  if (r) spriteSize.value = { w: Math.floor(r.width), h: Math.floor(r.height) };
});
watch(spriteBox, (el, old) => {
  if (old) spriteObserver.unobserve(old);
  if (el) spriteObserver.observe(el);
});
function onSpriteError(): void {
  mode.value = showcaseMode(props.manifest.engine, Boolean(props.manifest.preview), true);
}

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
onUnmounted(() => {
  unmount();
  spriteObserver.disconnect();
});
watch(
  () => props.characterId,
  () => void mount(),
);

// ⑩.7 试播驱动（live 态生效；preview/initial 降级 no-op）
// ⑳ sprite：映射到行的情绪 / 动作点播该行；未映射（程序化）在 CSS 预览里无从表现 → no-op
function spritePlay(state: string | null): void {
  if (state) thumb.value?.play(state);
}
defineExpose({
  applyEmotion: (name: string, weight = 1): void => {
    if (mode.value === 'sprite' && spriteResolved.value) {
      spritePlay(emotionPreviewState(spriteResolved.value, name));
    } else runtime?.applyEmotion(name, weight);
  },
  playAction: (name: string): void => {
    if (mode.value === 'sprite' && spriteResolved.value) {
      spritePlay(actionPreviewState(spriteResolved.value, name));
    } else runtime?.playAction(name);
  },
  playIdle: (): void => {
    if (mode.value === 'sprite' && spriteResolved.value) spritePlay(spriteResolved.value.slots.idle);
    else runtime?.setIdle({ mood: 'neutral', energy: 'mid' });
  },
  /** ⑳ E4 状态列表点播。 */
  playState: (state: string): void => spritePlay(state),
  isLive: (): boolean => mode.value === 'live' || mode.value === 'sprite',
});
</script>

<template>
  <div class="ds-glass relative flex flex-1 flex-col overflow-hidden rounded-panel">
    <!-- live 舞台常驻 DOM（createVrmRuntime 需容器实尺寸），非 live 时隐藏 -->
    <div v-show="mode === 'live'" ref="stage" class="min-h-0 w-full flex-1" />
    <div
      v-if="mode === 'sprite' && spriteSource"
      ref="spriteBox"
      class="flex min-h-0 w-full flex-1 items-end justify-center p-3"
    >
      <SpriteThumb
        v-if="spriteSize.w > 0 && spriteSize.h > 0"
        ref="thumb"
        :source="spriteSource"
        :width="spriteSize.w"
        :height="spriteSize.h"
        autoplay
        @error="onSpriteError"
      />
    </div>
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

    <div v-if="!compact" class="flex flex-col items-center gap-1 border-t border-glass-border p-3">
      <div class="text-base font-semibold text-text-main">{{ manifest.name }}</div>
      <div class="flex items-center gap-1.5 text-xs" :style="{ color: 'var(--ds-success)' }">
        <span class="h-1.5 w-1.5 rounded-full" style="background: var(--ds-success)" />
        {{ t('settings.overview.model.online') }} ·
        <span class="text-text-sub">{{ t('settings.overview.model.companion', { days: companionDays ?? 0 }) }}</span>
      </div>
      <div
        v-if="mode === 'live' || mode === 'sprite'"
        class="mt-1 rounded-full border border-glass-border px-2 py-0.5 text-[10px] text-text-sub"
      >
        {{ mode === 'sprite' ? t('settings.overview.model.spriteTag') : t('settings.overview.model.liveTag') }}
      </div>
    </div>
  </div>
</template>
