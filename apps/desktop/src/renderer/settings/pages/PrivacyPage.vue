<!-- settings/pages/PrivacyPage.vue — D6 隐私（ui-design §7.6；参照 1d7669e3） -->
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Prefs, PrefKey } from '@openpet/protocol';
import { DEFAULT_PREFS } from '@openpet/protocol';
import SettingSection from '../../components/SettingSection.vue';
import SettingCard from '../../components/SettingCard.vue';
import Switch from '../../components/Switch.vue';
import Select from '../../components/Select.vue';
import ConfirmDialog from '../../components/ConfirmDialog.vue';
import { needsConfirm } from '../privacy-risk';

const emit = defineEmits<{ saved: [] }>();
const { t } = useI18n();
const prefs = ref<Prefs>({ ...DEFAULT_PREFS });

onMounted(async () => {
  prefs.value = (await window.openpet.rpc('app.prefs.getAll', {})) as Prefs;
});

// 通用：写一个 pref → 乐观更新 + 持久 + 顶栏 toast。
async function set<K extends PrefKey>(key: K, value: Prefs[K]): Promise<void> {
  prefs.value = { ...prefs.value, [key]: value };
  // app.prefs.set 仅收标量；两层数组键（providerSources/models）走 provider.* RPC。
  await window.openpet.rpc('app.prefs.set', { key, value: value as string | number | boolean });
  emit('saved');
}

// 高风险开关：off→on 先弹二次确认（§2.8 ②）。
const dialog = ref<{ open: boolean; key: PrefKey | null; title: string; detail: string }>({
  open: false,
  key: null,
  title: '',
  detail: '',
});
const RISK_TEXT = computed<Partial<Record<PrefKey, { title: string; detail: string }>>>(() => ({
  'privacy.screenshot': {
    title: t('settings.privacy.riskScreenshotTitle'),
    detail: t('settings.privacy.riskScreenshotDetail'),
  },
  'privacy.camera': {
    title: t('settings.privacy.riskCameraTitle'),
    detail: t('settings.privacy.riskCameraDetail'),
  },
}));
function toggleSwitch(key: PrefKey, to: boolean): void {
  if (needsConfirm(key, prefs.value[key] as boolean, to)) {
    const txt = RISK_TEXT.value[key]!;
    dialog.value = { open: true, key, title: txt.title, detail: txt.detail };
    return; // 等确认
  }
  void set(key, to as Prefs[typeof key]);
}
function onConfirm(): void {
  const k = dialog.value.key!;
  void set(k, true as Prefs[typeof k]);
  dialog.value = { open: false, key: null, title: '', detail: '' };
}
function onCancel(): void {
  dialog.value = { open: false, key: null, title: '', detail: '' };
}

const CTX = computed(() => [
  { value: '10', label: t('settings.privacy.ctxRounds', { n: 10 }) },
  { value: '20', label: t('settings.privacy.ctxRounds', { n: 20 }) },
  { value: '40', label: t('settings.privacy.ctxRounds', { n: 40 }) },
]);
</script>

<template>
  <div class="max-w-[640px]">
    <SettingSection :title="t('settings.privacy.secKeyEncryption')">
      <SettingCard :label="t('settings.privacy.masterPassword')">
        <Switch
          :model-value="prefs['privacy.masterPassword']"
          @update:model-value="(v) => set('privacy.masterPassword', v)"
        />
      </SettingCard>
    </SettingSection>

    <SettingSection :title="t('settings.privacy.secUpload')">
      <SettingCard :label="t('settings.privacy.contentUpload')">
        <Switch
          :model-value="prefs['privacy.contentUpload']"
          @update:model-value="(v) => set('privacy.contentUpload', v)"
        />
      </SettingCard>
      <SettingCard :label="t('settings.privacy.masking')">
        <Switch
          :model-value="prefs['privacy.masking']"
          @update:model-value="(v) => set('privacy.masking', v)"
        />
      </SettingCard>
      <SettingCard :label="t('settings.privacy.contextWindow')">
        <Select
          :model-value="String(prefs['privacy.contextWindow'])"
          :options="CTX"
          @update:model-value="(v) => set('privacy.contextWindow', Number(v))"
        />
      </SettingCard>
      <SettingCard :label="t('settings.privacy.longTermMemory')">
        <Switch
          :model-value="prefs['privacy.longTermMemory']"
          @update:model-value="(v) => set('privacy.longTermMemory', v)"
        />
      </SettingCard>
      <SettingCard :label="t('settings.privacy.knowledgeBase')">
        <Switch
          :model-value="prefs['privacy.knowledgeBase']"
          @update:model-value="(v) => set('privacy.knowledgeBase', v)"
        />
      </SettingCard>
    </SettingSection>

    <SettingSection :title="t('settings.privacy.secSystemAccess')">
      <SettingCard :label="t('settings.privacy.clipboard')">
        <Switch
          :model-value="prefs['privacy.clipboard']"
          @update:model-value="(v) => set('privacy.clipboard', v)"
        />
      </SettingCard>
      <SettingCard :label="t('settings.privacy.screenshot')">
        <Switch
          :model-value="prefs['privacy.screenshot']"
          @update:model-value="(v) => toggleSwitch('privacy.screenshot', v)"
        />
      </SettingCard>
      <SettingCard :label="t('settings.privacy.microphone')">
        <Switch
          :model-value="prefs['privacy.microphone']"
          @update:model-value="(v) => set('privacy.microphone', v)"
        />
      </SettingCard>
      <SettingCard :label="t('settings.privacy.camera')">
        <Switch
          :model-value="prefs['privacy.camera']"
          @update:model-value="(v) => toggleSwitch('privacy.camera', v)"
        />
      </SettingCard>
      <SettingCard :label="t('settings.privacy.systemNotify')">
        <Switch
          :model-value="prefs['privacy.systemNotify']"
          @update:model-value="(v) => set('privacy.systemNotify', v)"
        />
      </SettingCard>
      <SettingCard :label="t('settings.privacy.affectionProfile')">
        <Switch
          :model-value="prefs['privacy.affectionProfile']"
          @update:model-value="(v) => set('privacy.affectionProfile', v)"
        />
      </SettingCard>
    </SettingSection>

    <SettingSection :title="t('settings.privacy.secTelemetry')">
      <SettingCard :label="t('settings.privacy.anonymousStats')">
        <Switch
          :model-value="prefs['privacy.anonymousStats']"
          @update:model-value="(v) => set('privacy.anonymousStats', v)"
        />
      </SettingCard>
      <SettingCard :label="t('settings.privacy.crashReport')">
        <Switch
          :model-value="prefs['privacy.crashReport']"
          @update:model-value="(v) => set('privacy.crashReport', v)"
        />
      </SettingCard>
    </SettingSection>

    <ConfirmDialog
      :open="dialog.open"
      :title="dialog.title"
      :detail="dialog.detail"
      @confirm="onConfirm"
      @cancel="onCancel"
    />
  </div>
</template>
