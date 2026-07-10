<!-- apps/desktop/src/renderer/settings/pages/DisplayPage.vue — D4 显示与窗口（ui-design §7.4） -->
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { FlaskConical, Monitor, Moon, UserRound } from 'lucide-vue-next';
import type { Prefs, PrefKey } from '@openpet/protocol';
import { DEFAULT_PREFS } from '@openpet/protocol';
import SettingSection from '../../components/SettingSection.vue';
import SettingCard from '../../components/SettingCard.vue';
import Switch from '../../components/Switch.vue';
import Select from '../../components/Select.vue';
import Slider from '../../components/Slider.vue';

const emit = defineEmits<{ saved: [] }>();
const { t } = useI18n();
const prefs = ref<Prefs>({ ...DEFAULT_PREFS });

onMounted(async () => {
  prefs.value = (await window.openpet.rpc('app.prefs.getAll', {})) as Prefs;
});

// 通用：写一个 pref → 乐观更新 + 持久 + 顶栏 toast。
// 仅标量 pref 经 app.prefs.set；两层数组键（providerSources/models）走 provider.* RPC。
async function set<K extends PrefKey>(key: K, value: Prefs[K]): Promise<void> {
  prefs.value = { ...prefs.value, [key]: value };
  await window.openpet.rpc('app.prefs.set', { key, value: value as string | number | boolean });
  emit('saved');
}
// 缩放：拖动实时预览（不落盘），松手持久。
function previewScale(v: number): void {
  prefs.value = { ...prefs.value, 'display.characterScale': v };
  void window.openpet.rpc('character.setScale', { scale: v });
}
function commitScale(v: number): void {
  void set('display.characterScale', v);
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
          :label="t('settings.display.scale')"
          :description="`${Math.round(prefs['display.characterScale'] * 100)}%`"
        >
          <Slider
            :model-value="prefs['display.characterScale']"
            :min="0.5"
            :max="2"
            :step="0.05"
            min-label="50%"
            max-label="200%"
            @update:model-value="previewScale"
            @change="commitScale(prefs['display.characterScale'])"
          />
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
          {{ t('settings.display.livePreview') }}
        </div>
        <div class="rounded-panel border border-glass-border bg-white/25 p-4 text-center">
          <div class="mx-auto flex h-44 w-40 items-end justify-center rounded-panel bg-white/35">
            <div
              class="ds-avatar mb-5 h-24 w-24 text-lg transition-transform ease-ds"
              :style="`transform: scale(${Math.min(1.25, prefs['display.characterScale'])})`"
            >
              {{ t('settings.shell.avatarInitial') }}
            </div>
          </div>
          <div
            class="mx-auto mt-3 w-fit rounded-btn border border-glass-border px-3 py-1 text-sm text-text-sub"
          >
            {{ Math.round(prefs['display.characterScale'] * 100) }}%
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
