<!-- settings/pages/VoicePage.vue — D5 音色工坊（⑩.6，spec §2，自设计布局 / token 守 §2）。
     音色库网格（试听/设默认/删除，默认卡暖色描边）+ 输出设置卡（autoSpeak/默认音色/语速/试听句）
     + 嘴型卡（mouthSync/mouthStrength）+ 输入小区（STT 跳 D3 + 麦克风）+ 高级（bargeIn）。 -->
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { AudioLines, Play, Star } from 'lucide-vue-next';
import type { PrefKey, Prefs, VoiceProfile } from '@openpet/protocol';
import { DEFAULT_PREFS } from '@openpet/protocol';
import Button from '../../components/Button.vue';
import Input from '../../components/Input.vue';
import Select from '../../components/Select.vue';
import Slider from '../../components/Slider.vue';
import Switch from '../../components/Switch.vue';
import SettingCard from '../../components/SettingCard.vue';
import SettingSection from '../../components/SettingSection.vue';
import ConfirmDialog from '../../components/ConfirmDialog.vue';
import VoiceWizardDialog from '../../components/voice/VoiceWizardDialog.vue';
import { bindingLabel, sortCards, toCardVm } from '../voice-studio-state';

const emit = defineEmits<{ saved: []; navigate: [string] }>();
const { t } = useI18n();

const prefs = ref<Prefs>({ ...DEFAULT_PREFS });
const wizardOpen = ref(false);
const pendingDelete = ref<VoiceProfile | null>(null);
/** 试听句（临时态不持久，spec §2）。 */
const previewText = ref('');
const previewingId = ref<string | null>(null);
const errMsg = ref('');
/** 麦克风设备列表（克隆录制同款输入源）。 */
const mics = ref<Array<{ value: string; label: string }>>([]);

const voices = computed(() => prefs.value['voice.voices']);
const cards = computed(() =>
  sortCards(voices.value.map((v) => toCardVm(v, prefs.value['voice.defaultVoiceId']))).map((c) => ({
    ...c,
    // 真窗反馈：卡上明示实际使用的连接+模型（区分"这个音色走的是啥"）
    binding: bindingLabel(
      voices.value.find((v) => v.id === c.id)!,
      prefs.value['model.providerSources'],
      prefs.value['model.models'],
      prefs.value['voice.engines.mimo.designModel'],
      t('settings.voice.bindingDefault'),
    ),
  })),
);
const defaultOptions = computed(() => [
  { value: '', label: t('settings.voice.noDefault') },
  ...voices.value.map((v) => ({ value: v.id, label: v.name })),
]);

onMounted(async () => {
  prefs.value = (await window.openpet.rpc('app.prefs.getAll', {})) as Prefs;
  previewText.value = t('settings.voice.previewSentence');
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    mics.value = [
      { value: '', label: t('settings.voice.micDefault') },
      ...devices
        .filter((d) => d.kind === 'audioinput' && d.deviceId)
        .map((d) => ({ value: d.deviceId, label: d.label || d.deviceId.slice(0, 8) })),
    ];
  } catch {
    mics.value = [{ value: '', label: t('settings.voice.micDefault') }];
  }
});

async function set<K extends PrefKey>(key: K, value: Prefs[K]): Promise<void> {
  prefs.value = { ...prefs.value, [key]: value };
  await window.openpet.rpc('app.prefs.set', {
    key,
    value: value as string | number | boolean | string[],
  });
  emit('saved');
}

async function preview(profile: VoiceProfile): Promise<void> {
  errMsg.value = '';
  previewingId.value = profile.id;
  try {
    await window.openpet.rpc('voice.previewProfile', {
      profile,
      text: previewText.value.trim() || t('settings.voice.previewSentence'),
    });
  } catch (e) {
    errMsg.value = e instanceof Error ? e.message : String(e);
  } finally {
    previewingId.value = null;
  }
}

/** 输出卡试听：有默认音色走 previewProfile，否则走 voice.speak（旧链兜底）。 */
async function previewDefault(): Promise<void> {
  const v = voices.value.find((x) => x.id === prefs.value['voice.defaultVoiceId']);
  if (v) return preview(v);
  errMsg.value = '';
  try {
    await window.openpet.rpc('voice.speak', {
      text: previewText.value.trim() || t('settings.voice.previewSentence'),
    });
  } catch (e) {
    errMsg.value = e instanceof Error ? e.message : String(e);
  }
}

async function onWizardSave(profile: VoiceProfile, stagedFile: string | null): Promise<void> {
  wizardOpen.value = false;
  if (stagedFile) {
    await window.openpet.rpc('voice.commitRefAudio', { voiceId: profile.id, file: stagedFile });
  }
  await set('voice.voices', [...voices.value, profile]);
  // 首个音色自动设默认（少一步操作；已有默认不动）
  if (!prefs.value['voice.defaultVoiceId']) await set('voice.defaultVoiceId', profile.id);
}

async function confirmDelete(): Promise<void> {
  const v = pendingDelete.value;
  pendingDelete.value = null;
  if (!v) return;
  await set(
    'voice.voices',
    voices.value.filter((x) => x.id !== v.id),
  );
  if (prefs.value['voice.defaultVoiceId'] === v.id) await set('voice.defaultVoiceId', '');
  await window.openpet.rpc('voice.removeVoiceDir', { id: v.id });
}
</script>

<template>
  <div class="max-w-[1080px]">
    <!-- 音色库（标题行 + 网格卡） -->
    <div class="mb-3 flex items-end justify-between gap-4">
      <div>
        <h2 class="text-md font-semibold text-text-main">{{ t('settings.voice.libTitle') }}</h2>
        <p class="mt-0.5 text-sm text-text-sub">{{ t('settings.voice.libSubtitle') }}</p>
      </div>
      <Button variant="primary" @click="wizardOpen = true">{{ t('settings.voice.addVoice') }}</Button>
    </div>

    <div v-if="!cards.length" class="ds-glass mb-4 rounded-panel px-4 py-12 text-center">
      <AudioLines :size="44" :stroke-width="1.2" class="mx-auto text-text-sub opacity-50" />
      <p class="mt-3 text-sm text-text-sub">{{ t('settings.voice.empty') }}</p>
      <Button class="mt-4" variant="primary" @click="wizardOpen = true">
        {{ t('settings.voice.emptyCta') }}
      </Button>
    </div>
    <div v-else class="mb-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <div
        v-for="c in cards"
        :key="c.id"
        class="ds-glass rounded-panel border p-4"
        :class="c.isDefault ? 'border-2' : 'border-glass-border'"
        :style="c.isDefault ? { borderColor: 'var(--ds-brand-from)' } : {}"
      >
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <div class="flex items-center gap-1.5 truncate text-base font-semibold text-text-main">
              {{ c.name }}
              <Star
                v-if="c.isDefault"
                :size="14"
                :stroke-width="1.5"
                style="color: var(--ds-brand-from)"
                fill="currentColor"
              />
            </div>
            <div class="mt-0.5 truncate text-sm text-text-sub">{{ c.detail || '—' }}</div>
            <div class="mt-0.5 truncate text-xs text-text-sub opacity-80">{{ c.binding }}</div>
          </div>
          <div class="flex shrink-0 flex-col items-end gap-1">
            <span
              class="rounded-full px-2 py-0.5 text-xs text-text-main"
              style="background: var(--ds-warm-soft)"
            >
              {{ t(`settings.voice.kind_${c.kind}`) }}
            </span>
            <span class="text-xs text-text-sub">{{ t(`settings.voice.engine_${c.engine}`) }}</span>
          </div>
        </div>
        <div class="mt-3 flex items-center gap-2">
          <Button
            variant="secondary"
            :disabled="previewingId === c.id"
            @click="preview(voices.find((v) => v.id === c.id)!)"
          >
            <span class="flex items-center gap-1.5">
              <Play :size="13" :stroke-width="1.5" />
              {{ previewingId === c.id ? t('settings.voice.previewing') : t('settings.voice.preview') }}
            </span>
          </Button>
          <Button
            v-if="!c.isDefault"
            variant="ghost"
            @click="set('voice.defaultVoiceId', c.id)"
          >
            {{ t('settings.voice.setDefault') }}
          </Button>
          <span class="flex-1" />
          <Button variant="ghost" @click="pendingDelete = voices.find((v) => v.id === c.id) ?? null">
            <span style="color: var(--ds-danger)">{{ t('common.delete') }}</span>
          </Button>
        </div>
      </div>
    </div>

    <div
      v-if="errMsg"
      class="mb-4 rounded-card px-3 py-2 text-sm"
      style="color: var(--ds-danger); background: var(--ds-warm-soft)"
    >
      {{ errMsg }}
    </div>

    <!-- 输出设置 -->
    <SettingSection :title="t('settings.voice.secOutput')">
      <SettingCard :label="t('settings.voice.autoSpeak')" :description="t('settings.voice.autoSpeakDesc')">
        <Switch
          :model-value="prefs['voice.autoSpeak']"
          @update:model-value="(v) => set('voice.autoSpeak', v)"
        />
      </SettingCard>
      <SettingCard :label="t('settings.voice.defaultVoice')" :description="t('settings.voice.defaultVoiceDesc')">
        <Select
          :model-value="prefs['voice.defaultVoiceId']"
          :options="defaultOptions"
          @update:model-value="(v) => set('voice.defaultVoiceId', v)"
        />
      </SettingCard>
      <SettingCard :label="t('settings.voice.rate')" :description="t('settings.voice.rateDesc')">
        <div class="flex items-center gap-2">
          <Slider
            :model-value="prefs['voice.rate']"
            :min="0.5"
            :max="2"
            :step="0.05"
            @update:model-value="(v) => (prefs = { ...prefs, 'voice.rate': v })"
            @change="(v) => set('voice.rate', v)"
          />
          <span class="w-10 text-right text-sm text-text-sub">{{ prefs['voice.rate'].toFixed(2) }}×</span>
        </div>
      </SettingCard>
      <SettingCard :label="t('settings.voice.previewLine')" :description="t('settings.voice.previewLineDesc')">
        <div class="flex items-center gap-2">
          <Input v-model="previewText" class="w-[260px]" />
          <Button variant="secondary" @click="previewDefault">
            <span class="flex items-center gap-1.5">
              <Play :size="13" :stroke-width="1.5" />{{ t('settings.voice.preview') }}
            </span>
          </Button>
        </div>
      </SettingCard>
    </SettingSection>

    <!-- 嘴型 -->
    <SettingSection :title="t('settings.voice.secMouth')">
      <SettingCard :label="t('settings.voice.mouthSync')" :description="t('settings.voice.mouthSyncDesc')">
        <Switch
          :model-value="prefs['voice.mouthSync']"
          @update:model-value="(v) => set('voice.mouthSync', v)"
        />
      </SettingCard>
      <SettingCard :label="t('settings.voice.mouthStrength')" :description="t('settings.voice.mouthStrengthDesc')">
        <div class="flex items-center gap-2">
          <Slider
            :model-value="prefs['voice.mouthStrength']"
            :min="0"
            :max="2"
            :step="0.1"
            @update:model-value="(v) => (prefs = { ...prefs, 'voice.mouthStrength': v })"
            @change="(v) => set('voice.mouthStrength', v)"
          />
          <span class="w-10 text-right text-sm text-text-sub">{{ prefs['voice.mouthStrength'].toFixed(1) }}×</span>
        </div>
      </SettingCard>
    </SettingSection>

    <!-- 输入（收缩小区，本批次非重点） -->
    <SettingSection :title="t('settings.voice.secInput')">
      <SettingCard :label="t('settings.voice.sttModel')" :description="t('settings.voice.sttModelDesc')">
        <Button variant="secondary" @click="emit('navigate', 'model')">
          {{ t('settings.voice.goModelPage') }}
        </Button>
      </SettingCard>
      <SettingCard :label="t('settings.voice.micDevice')" :description="t('settings.voice.micDeviceDesc')">
        <Select
          :model-value="prefs['voice.micDeviceId']"
          :options="mics"
          @update:model-value="(v) => set('voice.micDeviceId', v)"
        />
      </SettingCard>
    </SettingSection>

    <!-- 高级 -->
    <SettingSection :title="t('settings.voice.secAdvanced')">
      <SettingCard :label="t('settings.voice.bargeIn')" :description="t('settings.voice.bargeInDesc')">
        <Switch
          :model-value="prefs['voice.bargeIn']"
          @update:model-value="(v) => set('voice.bargeIn', v)"
        />
      </SettingCard>
    </SettingSection>

    <VoiceWizardDialog
      :open="wizardOpen"
      :mic-device-id="prefs['voice.micDeviceId']"
      @save="onWizardSave"
      @cancel="wizardOpen = false"
      @navigate="
        (r) => {
          wizardOpen = false;
          emit('navigate', r);
        }
      "
    />
    <ConfirmDialog
      :open="!!pendingDelete"
      :title="t('settings.voice.confirmDeleteTitle')"
      :detail="pendingDelete ? t('settings.voice.confirmDeleteDetail', { name: pendingDelete.name }) : ''"
      :confirm-label="t('common.delete')"
      @confirm="confirmDelete"
      @cancel="pendingDelete = null"
    />
  </div>
</template>
