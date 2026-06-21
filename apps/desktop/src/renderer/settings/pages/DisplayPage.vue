<!-- apps/desktop/src/renderer/settings/pages/DisplayPage.vue — D4 显示与窗口（ui-design §7.4） -->
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { FlaskConical, Monitor, Moon, UserRound } from 'lucide-vue-next';
import type { Prefs, PrefKey } from '@desksoul/protocol';
import { DEFAULT_PREFS } from '@desksoul/protocol';
import SettingSection from '../../components/SettingSection.vue';
import SettingCard from '../../components/SettingCard.vue';
import Switch from '../../components/Switch.vue';
import Select from '../../components/Select.vue';
import Slider from '../../components/Slider.vue';

const emit = defineEmits<{ saved: [] }>();
const prefs = ref<Prefs>({ ...DEFAULT_PREFS });

onMounted(async () => {
  prefs.value = (await window.desksoul.rpc('app.prefs.getAll', {})) as Prefs;
});

// 通用：写一个 pref → 乐观更新 + 持久 + 顶栏 toast。
async function set<K extends PrefKey>(key: K, value: Prefs[K]): Promise<void> {
  prefs.value = { ...prefs.value, [key]: value };
  await window.desksoul.rpc('app.prefs.set', { key, value });
  emit('saved');
}
// 缩放：拖动实时预览（不落盘），松手持久。
function previewScale(v: number): void {
  prefs.value = { ...prefs.value, 'display.characterScale': v };
  void window.desksoul.rpc('character.setScale', { scale: v });
}
function commitScale(v: number): void {
  void set('display.characterScale', v);
}

const THEME = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
];
const DISPLAYS = [{ value: 'primary', label: '主显示器' }];
const DRAG = [
  { value: 'snap', label: '吸附到目标屏边缘' },
  { value: 'free', label: '自由跨屏' },
];
</script>

<template>
  <div class="grid max-w-[1000px] gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
    <div class="min-w-0">
      <SettingSection title="角色" description="调整 DeskSoul 在桌面上的尺寸、置顶和跟随鼠标行为。">
        <SettingCard
          label="缩放"
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
        <SettingCard label="始终置顶">
          <Switch
            :model-value="prefs['display.alwaysOnTop']"
            @update:model-value="(v) => set('display.alwaysOnTop', v)"
          />
        </SettingCard>
        <SettingCard label="鼠标穿透" description="开启后点击会穿过角色落到桌面。">
          <Switch
            :model-value="prefs['display.clickThrough']"
            @update:model-value="(v) => set('display.clickThrough', v)"
          />
        </SettingCard>
        <SettingCard label="穿透模式常态色条" description="在角色脚下显示 4px 状态色条。">
          <Switch
            :model-value="prefs['display.clickThroughBar']"
            @update:model-value="(v) => set('display.clickThroughBar', v)"
          />
        </SettingCard>
        <SettingCard label="LookAt 看向鼠标">
          <Switch
            :model-value="prefs['display.lookAt']"
            @update:model-value="(v) => set('display.lookAt', v)"
          />
        </SettingCard>
        <SettingCard label="LookAt 强度">
          <Slider
            :model-value="prefs['display.lookAtStrength']"
            :min="0"
            :max="100"
            min-label="弱"
            max-label="强"
            @update:model-value="(v) => set('display.lookAtStrength', v)"
          />
        </SettingCard>
        <SettingCard label="物理摆动（头发/裙摆）">
          <Switch
            :model-value="prefs['display.physics']"
            @update:model-value="(v) => set('display.physics', v)"
          />
        </SettingCard>
        <SettingCard label="角色脚下光晕" description="默认关闭，适合深色壁纸。">
          <Switch
            :model-value="prefs['display.footGlow']"
            @update:model-value="(v) => set('display.footGlow', v)"
          />
        </SettingCard>
        <SettingCard label="界面主题">
          <Select
            :model-value="prefs['display.theme']"
            :options="THEME"
            @update:model-value="(v) => set('display.theme', v as Prefs['display.theme'])"
          />
        </SettingCard>
      </SettingSection>

      <SettingSection title="多显示器" description="决定角色在哪块屏幕出现，以及拖动时如何吸附。">
        <SettingCard label="跟随显示器">
          <Select
            :model-value="prefs['display.followDisplay']"
            :options="DISPLAYS"
            @update:model-value="(v) => set('display.followDisplay', v)"
          />
        </SettingCard>
        <SettingCard label="跨屏拖动行为">
          <Select
            :model-value="prefs['display.crossScreenDrag']"
            :options="DRAG"
            @update:model-value="
              (v) => set('display.crossScreenDrag', v as Prefs['display.crossScreenDrag'])
            "
          />
        </SettingCard>
      </SettingSection>

      <SettingSection title="不打扰" description="全屏、会议或游戏时减少存在感。">
        <SettingCard label="全屏应用时自动隐藏">
          <Switch
            :model-value="prefs['display.fullscreenHide']"
            @update:model-value="(v) => set('display.fullscreenHide', v)"
          />
        </SettingCard>
        <SettingCard label="游戏检测">
          <Switch
            :model-value="prefs['display.gameDetect']"
            @update:model-value="(v) => set('display.gameDetect', v)"
          />
        </SettingCard>
        <SettingCard label="视频会议时降级为轮廓">
          <Switch
            :model-value="prefs['display.meetingDowngrade']"
            @update:model-value="(v) => set('display.meetingDowngrade', v)"
          />
        </SettingCard>
      </SettingSection>

      <SettingSection title="实验性" tone="warn" description="这些能力可能影响稳定性与性能。">
        <SettingCard
          label="桌面壁纸层模式（角色不抢 Z 序）"
          description="此模式下点击穿透行为可能与你的桌面工具冲突"
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
          实时预览
        </div>
        <div class="rounded-panel border border-glass-border bg-white/25 p-4 text-center">
          <div class="mx-auto flex h-44 w-40 items-end justify-center rounded-panel bg-white/35">
            <div
              class="ds-avatar mb-5 h-24 w-24 text-lg transition-transform ease-ds"
              :style="`transform: scale(${Math.min(1.25, prefs['display.characterScale'])})`"
            >
              小
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
          显示器
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
        <div class="mt-2 text-center text-sm text-text-sub">主显示器（推荐）</div>
      </section>

      <section class="ds-glass rounded-panel p-4">
        <div class="mb-3 flex items-center gap-2 text-md font-semibold text-text-main">
          <Moon :size="18" :stroke-width="1.5" />
          不打扰行为
        </div>
        <div class="rounded-panel border border-glass-border bg-white/25 p-4">
          <div class="flex items-center justify-between text-sm text-text-sub">
            <span>隐藏角色</span>
            <span style="color: var(--ds-brand-to)">启用</span>
          </div>
          <div class="mt-2 flex items-center justify-between text-sm text-text-sub">
            <span>静音互动音效</span>
            <span style="color: var(--ds-brand-to)">启用</span>
          </div>
          <div class="mt-4 text-center text-lg font-semibold text-text-sub">Z z</div>
        </div>
      </section>

      <section class="ds-glass rounded-panel p-4">
        <div class="mb-2 flex items-center gap-2 text-md font-semibold text-text-main">
          <FlaskConical :size="18" :stroke-width="1.5" />
          实验性功能
        </div>
        <p class="text-sm leading-relaxed text-text-sub">
          开启前建议先保存当前工作；这些功能仍处于验证阶段。
        </p>
      </section>
    </aside>
  </div>
</template>
