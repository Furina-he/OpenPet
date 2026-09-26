<!-- apps/desktop/src/renderer/settings/pages/DisplayPage.vue — D4 显示与窗口（ui-design §7.4） -->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { FlaskConical, Monitor, Moon, UserRound } from 'lucide-vue-next';
import type { CharacterLayout, Prefs, PrefKey } from '@openpet/protocol';
import { DEFAULT_PREFS } from '@openpet/protocol';
import SettingSection from '../../components/SettingSection.vue';
import SettingCard from '../../components/SettingCard.vue';
import Switch from '../../components/Switch.vue';
import Select from '../../components/Select.vue';
import Slider from '../../components/Slider.vue';
import Button from '../../components/Button.vue';
import { pctLabel, pixelStopsView, screenPreview, sliderView } from '../display-view';

const emit = defineEmits<{ saved: [] }>();
const { t } = useI18n();
const prefs = ref<Prefs>({ ...DEFAULT_PREFS });

// ㉓ 角色大小：每角色一份，真源 = Main character-stage（layout 推送），本页不再写 display.characterScale。
const layout = ref<CharacterLayout | null>(null);
const characterName = ref('');
/** 拖动中的草稿值：拖动期间不让 layoutChanged 回推抢滑块。 */
const draft = ref<number | null>(null);
const scaleValue = computed(() => draft.value ?? layout.value?.scale ?? 1);
const slider = computed(() => (layout.value ? sliderView(layout.value) : null));
const pixelStops = computed(() => (layout.value ? pixelStopsView(layout.value) : []));
const preview = computed(() => (layout.value ? screenPreview(layout.value) : null));

async function refreshCharacter(): Promise<void> {
  try {
    const [cur, l] = await Promise.all([
      window.openpet.rpc('character.current', {}),
      window.openpet.rpc('character.layout', {}),
    ]);
    characterName.value = cur.manifest.name;
    layout.value = l;
  } catch {
    /* 角色 / 几何暂不可用：大小卡片不渲染 */
  }
}

const offs: Array<() => void> = [];
onMounted(async () => {
  // 桌宠上 Ctrl+滚轮 / 右键 / 托盘改了大小，滑块跟着动
  offs.push(window.openpet.on('character.layoutChanged', (l) => (layout.value = l)));
  offs.push(window.openpet.on('character.changed', () => void refreshCharacter()));
  prefs.value = (await window.openpet.rpc('app.prefs.getAll', {})) as Prefs;
  await refreshCharacter();
});
onUnmounted(() => offs.forEach((off) => off()));

// 通用：写一个 pref → 乐观更新 + 持久 + 顶栏 toast。
// 仅标量 pref 经 app.prefs.set；两层数组键（providerSources/models）走 provider.* RPC。
async function set<K extends PrefKey>(key: K, value: Prefs[K]): Promise<void> {
  prefs.value = { ...prefs.value, [key]: value };
  await window.openpet.rpc('app.prefs.set', { key, value: value as string | number | boolean });
  emit('saved');
}
// 缩放：拖动实时预览（不落盘），松手按当前角色持久化。
function previewScale(v: number): void {
  draft.value = v;
  void window.openpet.rpc('character.setScale', { scale: v });
}
async function commitScale(v: number): Promise<void> {
  draft.value = v;
  try {
    const r = await window.openpet.rpc('character.setScale', { scale: v, persist: true });
    if (layout.value) layout.value = { ...layout.value, scale: r.scale };
  } finally {
    draft.value = null;
  }
  emit('saved');
}

const THEME = computed(() => [
  { value: 'system', label: t('settings.display.themeSystem') },
  { value: 'light', label: t('settings.display.themeLight') },
  { value: 'dark', label: t('settings.display.themeDark') },
]);
const DISPLAYS = computed(() => [{ value: 'primary', label: t('settings.display.primaryDisplay') }]);
const DRAG = computed(() => [
  { value: 'snap', label: t('settings.display.dragSnap') },
  { value: 'free', label: t('settings.display.dragFree') },
]);
</script>

<template>
  <div class="grid max-w-[1000px] gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
    <div class="min-w-0">
      <SettingSection :title="t('settings.display.secCharacter')" :description="t('settings.display.secCharacterDesc')">
        <SettingCard
          v-if="layout && slider"
          :label="t('settings.display.scaleFor', { name: characterName })"
          :description="`${pctLabel(scaleValue)} · ${t('settings.display.scaleDesc')}`"
        >
          <div v-if="layout.pixelSnap" class="flex flex-col items-end gap-1.5">
            <div class="flex items-center gap-1 rounded-btn border border-glass-border p-0.5">
              <button
                v-for="s in pixelStops"
                :key="s.value"
                type="button"
                class="ds-focus rounded-btn px-2.5 py-1 text-sm transition-colors ease-ds disabled:cursor-not-allowed disabled:opacity-40"
                :class="
                  s.active
                    ? 'bg-white/70 font-semibold text-text-main shadow-sm'
                    : 'text-text-sub hover:text-text-main'
                "
                :disabled="!s.enabled"
                :aria-pressed="s.active"
                @click="commitScale(s.value)"
              >
                {{ s.label }}<span class="ml-1 text-xs text-text-sub">{{ s.pct }}</span>
              </button>
            </div>
            <div class="text-xs text-text-sub">{{ t('settings.display.scalePixelHint') }}</div>
          </div>
          <div v-else class="flex items-center gap-3">
            <Slider
              :model-value="scaleValue"
              :min="slider.min"
              :max="slider.max"
              :step="slider.step"
              :min-label="slider.minLabel"
              :max-label="slider.maxLabel"
              @update:model-value="previewScale"
              @change="commitScale"
            />
            <Button variant="secondary" class="shrink-0" @click="commitScale(1)">
              {{ t('settings.display.scaleReset') }}
            </Button>
          </div>
        </SettingCard>
        <SettingCard :label="t('settings.display.alwaysOnTop')">
          <Switch
            :model-value="prefs['display.alwaysOnTop']"
            @update:model-value="(v) => set('display.alwaysOnTop', v)"
          />
        </SettingCard>
        <SettingCard :label="t('settings.display.clickThrough')" :description="t('settings.display.clickThroughDesc')">
          <Switch
            :model-value="prefs['display.clickThrough']"
            @update:model-value="(v) => set('display.clickThrough', v)"
          />
        </SettingCard>
        <SettingCard :label="t('settings.display.clickThroughBar')" :description="t('settings.display.clickThroughBarDesc')">
          <Switch
            :model-value="prefs['display.clickThroughBar']"
            @update:model-value="(v) => set('display.clickThroughBar', v)"
          />
        </SettingCard>
        <SettingCard :label="t('settings.display.lookAt')">
          <Switch
            :model-value="prefs['display.lookAt']"
            @update:model-value="(v) => set('display.lookAt', v)"
          />
        </SettingCard>
        <SettingCard :label="t('settings.display.lookAtStrength')">
          <Slider
            :model-value="prefs['display.lookAtStrength']"
            :min="0"
            :max="100"
            :min-label="t('settings.display.weak')"
            :max-label="t('settings.display.strong')"
            @update:model-value="(v) => set('display.lookAtStrength', v)"
          />
        </SettingCard>
        <SettingCard :label="t('settings.display.physics')">
          <Switch
            :model-value="prefs['display.physics']"
            @update:model-value="(v) => set('display.physics', v)"
          />
        </SettingCard>
        <SettingCard :label="t('settings.display.footGlow')" :description="t('settings.display.footGlowDesc')">
          <Switch
            :model-value="prefs['display.footGlow']"
            @update:model-value="(v) => set('display.footGlow', v)"
          />
        </SettingCard>
        <SettingCard :label="t('settings.display.theme')">
          <Select
            :model-value="prefs['display.theme']"
            :options="THEME"
            @update:model-value="(v) => set('display.theme', v as Prefs['display.theme'])"
          />
        </SettingCard>
      </SettingSection>

      <SettingSection :title="t('settings.display.secMultiDisplay')" :description="t('settings.display.secMultiDisplayDesc')">
        <SettingCard :label="t('settings.display.followDisplay')">
          <Select
            :model-value="prefs['display.followDisplay']"
            :options="DISPLAYS"
            @update:model-value="(v) => set('display.followDisplay', v)"
          />
        </SettingCard>
        <SettingCard :label="t('settings.display.crossScreenDrag')">
          <Select
            :model-value="prefs['display.crossScreenDrag']"
            :options="DRAG"
            @update:model-value="
              (v) => set('display.crossScreenDrag', v as Prefs['display.crossScreenDrag'])
            "
          />
        </SettingCard>
      </SettingSection>

      <SettingSection :title="t('settings.display.secDnd')" :description="t('settings.display.secDndDesc')">
        <SettingCard :label="t('settings.display.fullscreenHide')">
          <Switch
            :model-value="prefs['display.fullscreenHide']"
            @update:model-value="(v) => set('display.fullscreenHide', v)"
          />
        </SettingCard>
        <SettingCard :label="t('settings.display.gameDetect')">
          <Switch
            :model-value="prefs['display.gameDetect']"
            @update:model-value="(v) => set('display.gameDetect', v)"
          />
        </SettingCard>
        <SettingCard :label="t('settings.display.meetingDowngrade')">
          <Switch
            :model-value="prefs['display.meetingDowngrade']"
            @update:model-value="(v) => set('display.meetingDowngrade', v)"
          />
        </SettingCard>
      </SettingSection>

      <SettingSection :title="t('settings.display.secExperimental')" tone="warn" :description="t('settings.display.secExperimentalDesc')">
        <SettingCard
          :label="t('settings.display.wallpaperMode')"
          :description="t('settings.display.wallpaperModeDesc')"
        >
          <Switch
            :model-value="prefs['display.wallpaperMode']"
            @update:model-value="(v) => set('display.wallpaperMode', v)"
          />
        </SettingCard>
      </SettingSection>
    </div>

    <aside class="space-y-4">
      <section class="ds-glass rounded-panel p-4">
        <div class="mb-3 flex items-center gap-2 text-md font-semibold text-text-main">
          <UserRound :size="18" :stroke-width="1.5" />
          {{ t('settings.display.screenPreview') }}
        </div>
        <div class="rounded-panel border border-glass-border bg-white/25 p-4 text-center">
          <!-- ㉓ 屏幕示意：当前显示器工作区缩略框 + 角色模型框（等比），随 layoutChanged 实时更新 -->
          <div
            v-if="preview"
            class="relative mx-auto overflow-hidden rounded-[6px] border border-glass-border bg-white/35"
            :style="{ width: `${preview.width}px`, height: `${preview.height}px` }"
          >
            <div
              class="absolute rounded-[3px] transition-all ease-ds"
              :style="{
                left: `${preview.model.left}px`,
                top: `${preview.model.top}px`,
                width: `${preview.model.width}px`,
                height: `${preview.model.height}px`,
                background: 'linear-gradient(180deg, var(--ds-brand-from), var(--ds-brand-to))',
              }"
            />
          </div>
          <div
            class="mx-auto mt-3 w-fit rounded-btn border border-glass-border px-3 py-1 text-sm text-text-sub"
          >
            {{ pctLabel(scaleValue) }}
          </div>
          <div class="mt-2 text-xs leading-relaxed text-text-sub">
            {{ t('settings.display.screenPreviewHint') }}
          </div>
        </div>
      </section>

      <section class="ds-glass rounded-panel p-4">
        <div class="mb-3 flex items-center gap-2 text-md font-semibold text-text-main">
          <Monitor :size="18" :stroke-width="1.5" />
          {{ t('settings.display.displays') }}
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div class="rounded-card border p-4 text-center" style="border-color: var(--ds-brand-to)">
            <div class="text-lg font-semibold text-text-main">1</div>
            <div class="mt-2 h-1 rounded-full" style="background: var(--ds-brand-to)" />
          </div>
          <div class="rounded-card border border-glass-border p-4 text-center text-text-sub">
            <div class="text-lg font-semibold">2</div>
            <div class="mt-2 h-1 rounded-full bg-glass-border" />
          </div>
        </div>
        <div class="mt-2 text-center text-sm text-text-sub">{{ t('settings.display.primaryRecommended') }}</div>
      </section>

      <section class="ds-glass rounded-panel p-4">
        <div class="mb-3 flex items-center gap-2 text-md font-semibold text-text-main">
          <Moon :size="18" :stroke-width="1.5" />
          {{ t('settings.display.dndBehavior') }}
        </div>
        <div class="rounded-panel border border-glass-border bg-white/25 p-4">
          <div class="flex items-center justify-between text-sm text-text-sub">
            <span>{{ t('settings.display.hideCharacter') }}</span>
            <span style="color: var(--ds-brand-to)">{{ t('common.enabledShort') }}</span>
          </div>
          <div class="mt-2 flex items-center justify-between text-sm text-text-sub">
            <span>{{ t('settings.display.muteFx') }}</span>
            <span style="color: var(--ds-brand-to)">{{ t('common.enabledShort') }}</span>
          </div>
          <div class="mt-4 text-center text-lg font-semibold text-text-sub">Z z</div>
        </div>
      </section>

      <section class="ds-glass rounded-panel p-4">
        <div class="mb-2 flex items-center gap-2 text-md font-semibold text-text-main">
          <FlaskConical :size="18" :stroke-width="1.5" />
          {{ t('settings.display.experimentalFeatures') }}
        </div>
        <p class="text-sm leading-relaxed text-text-sub">
          {{ t('settings.display.experimentalHint') }}
        </p>
      </section>
    </aside>
  </div>
</template>
