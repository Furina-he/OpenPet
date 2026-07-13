<!-- settings/pages/GeneralPage.vue — D2 通用（ui-design §7.2；参照 1d7669e3 设置设计语言） -->
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Prefs, PrefKey, RegexRule } from '@openpet/protocol';
import { DEFAULT_PREFS } from '@openpet/protocol';
import SettingSection from '../../components/SettingSection.vue';
import SettingCard from '../../components/SettingCard.vue';
import Switch from '../../components/Switch.vue';
import Select from '../../components/Select.vue';
import Slider from '../../components/Slider.vue';
import Button from '../../components/Button.vue';

const emit = defineEmits<{ saved: [] }>();
const { t } = useI18n();
const prefs = ref<Prefs>({ ...DEFAULT_PREFS });

onMounted(async () => {
  prefs.value = (await window.openpet.rpc('app.prefs.getAll', {})) as Prefs;
});

// 通用：写一个 pref → 乐观更新 + 持久 + 顶栏 toast。
async function set<K extends PrefKey>(key: K, value: Prefs[K]): Promise<void> {
  prefs.value = { ...prefs.value, [key]: value };
  // app.prefs.set 收标量与数组（对象数组深校验在 prefs-service）；两层数组键（providerSources/models）走 provider.* RPC。
  await window.openpet.rpc('app.prefs.set', {
    key,
    value: value as string | number | boolean | string[],
  });
  emit('saved');
}

// ⑭ 口癖规则整组写回（照 E4 世界书条目的行编辑语义）。
function setRule(i: number, patch: Partial<RegexRule>): void {
  void set(
    'chat.regexRules',
    prefs.value['chat.regexRules'].map((r, x) => (x === i ? { ...r, ...patch } : r)),
  );
}
function addRule(): void {
  void set('chat.regexRules', [
    ...prefs.value['chat.regexRules'],
    { id: `rule-${Date.now()}`, name: '', find: '', replace: '', ignoreCase: true, enabled: true },
  ]);
}
function removeRule(i: number): void {
  void set(
    'chat.regexRules',
    prefs.value['chat.regexRules'].filter((_, x) => x !== i),
  );
}

const STARTUP = computed(() => [
  { value: 'character+tray', label: t('settings.general.startupCharacterTray') },
  { value: 'tray', label: t('settings.general.startupTrayOnly') },
  { value: 'none', label: t('settings.general.startupNone') },
]);
const LANG = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'en', label: 'English' },
];
const TZ = computed(() => [{ value: 'Asia/Shanghai', label: t('settings.general.tzBeijing') }]);
const CHANNEL = computed(() => [
  { value: 'stable', label: t('settings.general.channelStable') },
  { value: 'preview', label: t('settings.general.channelPreview') },
]);
const THINKING = computed(() => [
  { value: 'full', label: t('settings.general.thinkingFull') },
  { value: 'tools', label: t('settings.general.thinkingTools') },
  { value: 'hidden', label: t('settings.general.thinkingHidden') },
]);
</script>

<template>
  <div class="max-w-[640px]">
    <SettingSection :title="t('settings.general.secStartup')">
      <SettingCard :label="t('settings.general.launchAtLogin')">
        <Switch
          :model-value="prefs['general.launchAtLogin']"
          @update:model-value="(v) => set('general.launchAtLogin', v)"
        />
      </SettingCard>
      <SettingCard :label="t('settings.general.startupShow')">
        <Select
          :model-value="prefs['general.startupShow']"
          :options="STARTUP"
          @update:model-value="(v) => set('general.startupShow', v as Prefs['general.startupShow'])"
        />
      </SettingCard>
    </SettingSection>

    <SettingSection :title="t('settings.general.secLocale')">
      <SettingCard :label="t('settings.general.language')">
        <Select
          :model-value="prefs['general.language']"
          :options="LANG"
          @update:model-value="(v) => set('general.language', v)"
        />
      </SettingCard>
      <SettingCard :label="t('settings.general.timezone')">
        <Select
          :model-value="prefs['general.timezone']"
          :options="TZ"
          @update:model-value="(v) => set('general.timezone', v)"
        />
      </SettingCard>
      <SettingCard :label="t('settings.general.hour24')">
        <Switch
          :model-value="prefs['general.hour24']"
          @update:model-value="(v) => set('general.hour24', v)"
        />
      </SettingCard>
      <!-- ⑫ user 宏数据源：人设/开场白/世界书中的 user 宏替换为该称呼 -->
      <SettingCard :label="t('settings.general.userName')">
        <input
          class="ds-control h-9 w-56 rounded-input px-3 text-sm text-text-main"
          :value="prefs['chat.userName']"
          :placeholder="t('settings.general.userNamePlaceholder')"
          @change="set('chat.userName', ($event.target as HTMLInputElement).value)"
        />
      </SettingCard>
    </SettingSection>

    <SettingSection :title="t('settings.general.secUpdate')">
      <SettingCard :label="t('settings.general.autoUpdate')">
        <Switch
          :model-value="prefs['general.autoUpdate']"
          @update:model-value="(v) => set('general.autoUpdate', v)"
        />
      </SettingCard>
      <SettingCard :label="t('settings.general.updateChannel')">
        <Select
          :model-value="prefs['general.updateChannel']"
          :options="CHANNEL"
          @update:model-value="
            (v) => set('general.updateChannel', v as Prefs['general.updateChannel'])
          "
        />
      </SettingCard>
    </SettingSection>

    <SettingSection :title="t('settings.general.secNotify')">
      <SettingCard :label="t('settings.general.desktopNotifications')">
        <Switch
          :model-value="prefs['general.desktopNotifications']"
          @update:model-value="(v) => set('general.desktopNotifications', v)"
        />
      </SettingCard>
      <SettingCard :label="t('settings.general.proactiveSpeech')" :description="t('settings.general.proactiveSpeechDesc')">
        <Switch
          :model-value="prefs['general.proactiveSpeech']"
          @update:model-value="(v) => set('general.proactiveSpeech', v)"
        />
      </SettingCard>
      <SettingCard v-if="prefs['general.proactiveSpeech']" :label="t('settings.general.proactiveFreq')" indent>
        <Slider
          :model-value="prefs['general.proactiveFreq']"
          :min="0"
          :max="100"
          :min-label="t('settings.general.freqLow')"
          :max-label="t('settings.general.freqHigh')"
          @update:model-value="(v) => set('general.proactiveFreq', v)"
        />
      </SettingCard>
      <SettingCard :label="t('settings.general.emotionFallback')" :description="t('settings.general.emotionFallbackDesc')">
        <Switch
          :model-value="prefs['general.emotionFallback']"
          @update:model-value="(v) => set('general.emotionFallback', v)"
        />
      </SettingCard>
    </SettingSection>

    <!-- ⑭ 对话拟人化：自然节奏 / 风格锚 / 口癖修正规则 -->
    <SettingSection :title="t('settings.general.humanize')">
      <SettingCard :label="t('settings.general.naturalRhythm')" :description="t('settings.general.naturalRhythmDesc')">
        <Switch
          :model-value="prefs['chat.naturalRhythm']"
          @update:model-value="(v) => set('chat.naturalRhythm', v)"
        />
      </SettingCard>
      <SettingCard :label="t('settings.general.styleAnchor')" :description="t('settings.general.styleAnchorDesc')">
        <Switch
          :model-value="prefs['chat.styleAnchorEnabled']"
          @update:model-value="(v) => set('chat.styleAnchorEnabled', v)"
        />
      </SettingCard>
      <div v-if="prefs['chat.styleAnchorEnabled']" class="pb-3 pl-10 pr-4">
        <textarea
          :value="prefs['chat.styleAnchorText']"
          rows="3"
          :placeholder="t('settings.general.styleAnchorPlaceholder')"
          class="ds-control w-full rounded-input p-2 text-sm text-text-main"
          @change="set('chat.styleAnchorText', ($event.target as HTMLTextAreaElement).value)"
        />
      </div>
      <!-- 口癖修正规则（照 E4 世界书条目卡片样式；空 find 行 = 未生效占位） -->
      <div class="px-4 pb-3">
        <div class="mb-2 flex items-center justify-between">
          <span class="text-sm font-medium text-text-main">{{ t('settings.general.regexRules') }}</span>
          <Button variant="secondary" @click="addRule">{{ t('settings.general.addRegexRule') }}</Button>
        </div>
        <div
          v-for="(r, i) in prefs['chat.regexRules']"
          :key="r.id"
          class="mb-2 rounded-card border border-glass-border bg-white/20 p-3"
        >
          <div class="flex items-center gap-2">
            <input
              :value="r.name"
              :placeholder="t('settings.general.regexName')"
              class="ds-control h-8 w-40 rounded-input px-2 text-sm text-text-main"
              @change="setRule(i, { name: ($event.target as HTMLInputElement).value })"
            />
            <span class="flex-1" />
            <label class="flex items-center gap-1 text-xs text-text-sub">
              <input
                type="checkbox"
                :checked="r.enabled"
                @change="setRule(i, { enabled: ($event.target as HTMLInputElement).checked })"
              />
              {{ t('settings.general.regexEnabled') }}
            </label>
            <button class="text-xs" style="color: var(--ds-danger)" @click="removeRule(i)">
              {{ t('common.delete') }}
            </button>
          </div>
          <div class="mt-2 flex items-center gap-2">
            <input
              :value="r.find"
              :placeholder="t('settings.general.regexFind')"
              class="ds-control h-8 min-w-0 flex-1 rounded-input px-2 font-mono text-sm text-text-main"
              @change="setRule(i, { find: ($event.target as HTMLInputElement).value })"
            />
            <span class="shrink-0 text-xs text-text-sub">→</span>
            <input
              :value="r.replace"
              :placeholder="t('settings.general.regexReplace')"
              class="ds-control h-8 w-40 rounded-input px-2 font-mono text-sm text-text-main"
              @change="setRule(i, { replace: ($event.target as HTMLInputElement).value })"
            />
          </div>
        </div>
      </div>
    </SettingSection>

    <SettingSection :title="t('settings.general.secVoice')">
      <SettingCard :label="t('settings.general.autoSpeak')" :description="t('settings.general.autoSpeakDesc')">
        <Switch
          :model-value="prefs['voice.autoSpeak']"
          @update:model-value="(v) => set('voice.autoSpeak', v)"
        />
      </SettingCard>
    </SettingSection>

    <SettingSection :title="t('settings.general.secThinking')">
      <SettingCard :label="t('settings.general.thinkingDisplay')">
        <Select
          :model-value="prefs['general.agentThinkingDisplay']"
          :options="THINKING"
          @update:model-value="
            (v) => set('general.agentThinkingDisplay', v as Prefs['general.agentThinkingDisplay'])
          "
        />
      </SettingCard>
    </SettingSection>

    <SettingSection :title="t('settings.general.secDeveloper')">
      <SettingCard :label="t('settings.general.developerMode')" :description="t('settings.general.developerModeDesc')">
        <Switch
          :model-value="prefs['general.developerMode']"
          @update:model-value="(v) => set('general.developerMode', v)"
        />
      </SettingCard>
    </SettingSection>
  </div>
</template>
