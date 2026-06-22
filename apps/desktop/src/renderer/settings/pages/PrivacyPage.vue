<!-- settings/pages/PrivacyPage.vue — D6 隐私（ui-design §7.6；参照 1d7669e3） -->
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { Prefs, PrefKey } from '@desksoul/protocol';
import { DEFAULT_PREFS } from '@desksoul/protocol';
import SettingSection from '../../components/SettingSection.vue';
import SettingCard from '../../components/SettingCard.vue';
import Switch from '../../components/Switch.vue';
import Select from '../../components/Select.vue';
import ConfirmDialog from '../../components/ConfirmDialog.vue';
import { needsConfirm } from '../privacy-risk';

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

// 高风险开关：off→on 先弹二次确认（§2.8 ②）。
const dialog = ref<{ open: boolean; key: PrefKey | null; title: string; detail: string }>({
  open: false,
  key: null,
  title: '',
  detail: '',
});
const RISK_TEXT: Partial<Record<PrefKey, { title: string; detail: string }>> = {
  'privacy.screenshot': {
    title: '允许读取屏幕内容（截屏）？',
    detail: '开启后角色/插件可在你授权时截取屏幕。仅在需要时开启。',
  },
  'privacy.camera': {
    title: '允许访问摄像头？',
    detail: '开启后角色/插件可在你授权时使用摄像头。仅在需要时开启。',
  },
};
function toggleSwitch(key: PrefKey, to: boolean): void {
  if (needsConfirm(key, prefs.value[key] as boolean, to)) {
    const t = RISK_TEXT[key]!;
    dialog.value = { open: true, key, title: t.title, detail: t.detail };
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

const CTX = [
  { value: '10', label: '最近 10 轮' },
  { value: '20', label: '最近 20 轮' },
  { value: '40', label: '最近 40 轮' },
];
</script>

<template>
  <div class="max-w-[640px]">
    <SettingSection title="API Key 加密">
      <SettingCard label="主密码（额外保护）">
        <Switch
          :model-value="prefs['privacy.masterPassword']"
          @update:model-value="(v) => set('privacy.masterPassword', v)"
        />
      </SettingCard>
    </SettingSection>

    <SettingSection title="内容上送">
      <SettingCard label="对话文本上送 LLM">
        <Switch
          :model-value="prefs['privacy.contentUpload']"
          @update:model-value="(v) => set('privacy.contentUpload', v)"
        />
      </SettingCard>
      <SettingCard label="对话脱敏（手机/邮箱/Key）">
        <Switch
          :model-value="prefs['privacy.masking']"
          @update:model-value="(v) => set('privacy.masking', v)"
        />
      </SettingCard>
      <SettingCard label="上下文窗大小">
        <Select
          :model-value="String(prefs['privacy.contextWindow'])"
          :options="CTX"
          @update:model-value="(v) => set('privacy.contextWindow', Number(v))"
        />
      </SettingCard>
      <SettingCard label="长期记忆（向量化关键事实）">
        <Switch
          :model-value="prefs['privacy.longTermMemory']"
          @update:model-value="(v) => set('privacy.longTermMemory', v)"
        />
      </SettingCard>
    </SettingSection>

    <SettingSection title="系统访问（默认全关）">
      <SettingCard label="剪贴板读取">
        <Switch
          :model-value="prefs['privacy.clipboard']"
          @update:model-value="(v) => set('privacy.clipboard', v)"
        />
      </SettingCard>
      <SettingCard label="屏幕内容（截屏）">
        <Switch
          :model-value="prefs['privacy.screenshot']"
          @update:model-value="(v) => toggleSwitch('privacy.screenshot', v)"
        />
      </SettingCard>
      <SettingCard label="麦克风">
        <Switch
          :model-value="prefs['privacy.microphone']"
          @update:model-value="(v) => set('privacy.microphone', v)"
        />
      </SettingCard>
      <SettingCard label="摄像头">
        <Switch
          :model-value="prefs['privacy.camera']"
          @update:model-value="(v) => toggleSwitch('privacy.camera', v)"
        />
      </SettingCard>
      <SettingCard label="系统通知发送">
        <Switch
          :model-value="prefs['privacy.systemNotify']"
          @update:model-value="(v) => set('privacy.systemNotify', v)"
        />
      </SettingCard>
      <SettingCard label="情感画像（F4 关系面板）">
        <Switch
          :model-value="prefs['privacy.affectionProfile']"
          @update:model-value="(v) => set('privacy.affectionProfile', v)"
        />
      </SettingCard>
    </SettingSection>

    <SettingSection title="遥测与崩溃">
      <SettingCard label="匿名使用统计">
        <Switch
          :model-value="prefs['privacy.anonymousStats']"
          @update:model-value="(v) => set('privacy.anonymousStats', v)"
        />
      </SettingCard>
      <SettingCard label="崩溃自动上报（脱敏）">
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
