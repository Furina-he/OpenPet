<!-- settings/components/SpriteThumb.vue — ⑳ 帧动画缩略图：CSS 背景切帧按官方逐帧时长播放（Hub 不载 pixi）。
     默认停第 0 帧、悬停才动（autoplay = 常动，总览 showcase 用）；expose play(state) 供试播 / E4 状态列表点播。
     数学全在 sprite-thumb.ts；图片加载失败 emit('error') 由父级降级到 preview / 首字。 -->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import type { SpriteThumbSource } from '../character-library-view.js';
import { cellFromImage, frameBackground, thumbScale, tryResolveSprite } from '../sprite-thumb.js';

const props = withDefaults(
  defineProps<{
    source: SpriteThumbSource;
    /** 缩略图盒尺寸（CSS px）；格等比 contain 进盒、底边对齐。 */
    width: number;
    height: number;
    autoplay?: boolean;
    /** 基线状态（缺省 = idle 槽位）。 */
    state?: string | undefined;
  }>(),
  { autoplay: false, state: undefined },
);
const emit = defineEmits<{ error: [] }>();

const resolved = computed(() => tryResolveSprite(props.source.sheet));
const natural = ref<{ width: number; height: number } | null>(null);
const hovering = ref(false);
const current = ref('');
const frame = ref(0);
let timer: ReturnType<typeof setTimeout> | null = null;
/** 点播：剩余轮数（一次性行 1 轮、循环行 2 轮），播完回基线。 */
let temp: { rounds: number } | null = null;

const baseState = (): string => props.state ?? resolved.value?.slots.idle ?? '';
const cell = computed(() =>
  resolved.value && natural.value
    ? cellFromImage(resolved.value, natural.value.width, natural.value.height)
    : null,
);
const scale = computed(() => (cell.value ? thumbScale(cell.value, props.width, props.height) : 1));
const frameStyle = computed(() => {
  const st = resolved.value?.states[current.value];
  if (!st || !cell.value || !natural.value) return null;
  return {
    width: `${cell.value.width * scale.value}px`,
    height: `${cell.value.height * scale.value}px`,
    backgroundImage: `url("${props.source.url}")`,
    backgroundRepeat: 'no-repeat',
    imageRendering: resolved.value?.smoothing === 'pixel' ? ('pixelated' as const) : ('auto' as const),
    ...frameBackground(st, frame.value, cell.value, scale.value, natural.value),
  };
});

function stop(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}

function tick(): void {
  stop();
  const st = resolved.value?.states[current.value];
  if (!st) return;
  if (!props.autoplay && !hovering.value && !temp) {
    frame.value = 0;
    current.value = baseState();
    return;
  }
  const d = st.durationsMs[frame.value] ?? 100;
  timer = setTimeout(() => {
    frame.value += 1;
    if (frame.value >= st.frames) {
      frame.value = 0;
      if (temp && --temp.rounds <= 0) {
        temp = null;
        current.value = baseState();
      }
    }
    tick();
  }, d);
}

function restart(): void {
  temp = null;
  current.value = baseState();
  frame.value = 0;
  tick();
}

function load(): void {
  natural.value = null;
  stop();
  const img = new Image();
  img.onload = () => {
    natural.value = { width: img.naturalWidth, height: img.naturalHeight };
    restart();
  };
  img.onerror = () => emit('error');
  img.src = props.source.url;
}

onMounted(() => {
  if (!resolved.value) emit('error');
  else load();
});
onUnmounted(stop);
watch(() => props.source.url, load);
watch(
  () => [props.state, props.source.sheet] as const,
  () => restart(),
  { deep: true },
);

function onEnter(): void {
  hovering.value = true;
  tick();
}
function onLeave(): void {
  hovering.value = false;
  if (!temp) tick();
}

defineExpose({
  /** 点播某状态（一次性行一轮 / 循环行两轮），播完回基线；未知状态 no-op。 */
  play(state: string): void {
    const st = resolved.value?.states[state];
    if (!st) return;
    temp = { rounds: st.loop ? 2 : 1 };
    current.value = state;
    frame.value = 0;
    tick();
  },
});
</script>

<template>
  <div
    class="flex items-end justify-center overflow-hidden"
    :style="{ width: `${width}px`, height: `${height}px` }"
    @mouseenter="onEnter"
    @mouseleave="onLeave"
  >
    <div v-if="frameStyle" :style="frameStyle" />
  </div>
</template>
