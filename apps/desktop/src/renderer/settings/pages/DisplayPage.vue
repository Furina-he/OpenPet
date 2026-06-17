<!-- apps/desktop/src/renderer/settings/pages/DisplayPage.vue — D4 显示与窗口（ui-design §7.4） -->
<script setup lang="ts">
import { onMounted, ref } from 'vue';
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
  <div class="max-w-[640px]">
    <SettingSection title="角色">
      <SettingCard
        label="缩放"
        :description="`${Math.round(prefs['display.characterScale'] * 100)}%`"
      >
        <Slider
          :model-value="prefs['display.characterScale']"
          :min="0.5"
          :max="2"
          :step="0.05"
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
      <SettingCard label="鼠标穿透">
        <Switch
          :model-value="prefs['display.clickThrough']"
          @update:model-value="(v) => set('display.clickThrough', v)"
        />
      </SettingCard>
      <SettingCard label="穿透模式常态色条" description="默认关">
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
          @update:model-value="(v) => set('display.lookAtStrength', v)"
        />
      </SettingCard>
      <SettingCard label="物理摆动（头发/裙摆）">
        <Switch
          :model-value="prefs['display.physics']"
          @update:model-value="(v) => set('display.physics', v)"
        />
      </SettingCard>
      <SettingCard label="角色脚下光晕" description="默认关">
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

    <SettingSection title="多显示器">
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

    <SettingSection title="不打扰">
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

    <SettingSection title="⚠ 实验性" tone="warn">
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
</template>
