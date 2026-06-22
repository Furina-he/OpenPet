<!-- settings/pages/GeneralPage.vue — D2 通用（ui-design §7.2；参照 1d7669e3 设置设计语言） -->
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
  // app.prefs.set 仅收标量；两层数组键（providerSources/models）走 provider.* RPC。
  await window.desksoul.rpc('app.prefs.set', { key, value: value as string | number | boolean });
  emit('saved');
}

const STARTUP = [
  { value: 'character+tray', label: '角色 + 托盘' },
  { value: 'tray', label: '仅托盘' },
  { value: 'none', label: '不自动显示' },
];
const LANG = [{ value: 'zh-CN', label: '简体中文' }];
const TZ = [{ value: 'Asia/Shanghai', label: '(GMT+8) 北京' }];
const CHANNEL = [
  { value: 'stable', label: '稳定版' },
  { value: 'preview', label: '预览版' },
];
const THINKING = [
  { value: 'full', label: '完整' },
  { value: 'tools', label: '仅工具' },
  { value: 'hidden', label: '隐藏' },
];
</script>

<template>
  <div class="max-w-[640px]">
    <SettingSection title="启动">
      <SettingCard label="开机自启动">
        <Switch
          :model-value="prefs['general.launchAtLogin']"
          @update:model-value="(v) => set('general.launchAtLogin', v)"
        />
      </SettingCard>
      <SettingCard label="启动时显示">
        <Select
          :model-value="prefs['general.startupShow']"
          :options="STARTUP"
          @update:model-value="(v) => set('general.startupShow', v as Prefs['general.startupShow'])"
        />
      </SettingCard>
    </SettingSection>

    <SettingSection title="语言与地区">
      <SettingCard label="语言">
        <Select
          :model-value="prefs['general.language']"
          :options="LANG"
          @update:model-value="(v) => set('general.language', v)"
        />
      </SettingCard>
      <SettingCard label="时区">
        <Select
          :model-value="prefs['general.timezone']"
          :options="TZ"
          @update:model-value="(v) => set('general.timezone', v)"
        />
      </SettingCard>
      <SettingCard label="24 小时制">
        <Switch
          :model-value="prefs['general.hour24']"
          @update:model-value="(v) => set('general.hour24', v)"
        />
      </SettingCard>
    </SettingSection>

    <SettingSection title="更新">
      <SettingCard label="自动检查更新">
        <Switch
          :model-value="prefs['general.autoUpdate']"
          @update:model-value="(v) => set('general.autoUpdate', v)"
        />
      </SettingCard>
      <SettingCard label="更新通道">
        <Select
          :model-value="prefs['general.updateChannel']"
          :options="CHANNEL"
          @update:model-value="
            (v) => set('general.updateChannel', v as Prefs['general.updateChannel'])
          "
        />
      </SettingCard>
    </SettingSection>

    <SettingSection title="通知">
      <SettingCard label="桌面通知（系统）">
        <Switch
          :model-value="prefs['general.desktopNotifications']"
          @update:model-value="(v) => set('general.desktopNotifications', v)"
        />
      </SettingCard>
      <SettingCard label="角色主动发言" description="长时间无交互时主动发起对话">
        <Switch
          :model-value="prefs['general.proactiveSpeech']"
          @update:model-value="(v) => set('general.proactiveSpeech', v)"
        />
      </SettingCard>
      <SettingCard v-if="prefs['general.proactiveSpeech']" label="主动发言频率" indent>
        <Slider
          :model-value="prefs['general.proactiveFreq']"
          :min="0"
          :max="100"
          min-label="低"
          max-label="高"
          @update:model-value="(v) => set('general.proactiveFreq', v)"
        />
      </SettingCard>
    </SettingSection>

    <SettingSection title="Agent 思考过程">
      <SettingCard label="显示模式">
        <Select
          :model-value="prefs['general.agentThinkingDisplay']"
          :options="THINKING"
          @update:model-value="
            (v) => set('general.agentThinkingDisplay', v as Prefs['general.agentThinkingDisplay'])
          "
        />
      </SettingCard>
    </SettingSection>

    <SettingSection title="开发者">
      <SettingCard label="开发者模式" description="开启后插件页出现「开发者面板」入口">
        <Switch
          :model-value="prefs['general.developerMode']"
          @update:model-value="(v) => set('general.developerMode', v)"
        />
      </SettingCard>
    </SettingSection>
  </div>
</template>
