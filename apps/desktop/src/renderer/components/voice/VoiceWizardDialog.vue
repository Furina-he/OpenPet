<!-- components/voice/VoiceWizardDialog.vue — 新建音色向导（⑩.6 音色工坊，spec §2）。
     三 Tab：预设（openai/MiMo 音色名）/ 设计（MiMo voicedesign 描述+chip+试听迭代）/
     克隆（上传或现场录制参考音频 → STT 自动填参考文本 → 引擎测连 → 试听草稿）。
     试听走 voice.previewProfile（不落库）；保存 emit(profile, stagedFile)，持久化归 VoicePage。 -->
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { BookOpen, Mic, Play, Square, Upload } from 'lucide-vue-next';
import type { VoiceKind, VoiceProfile } from '@openpet/protocol';
import Input from '../Input.vue';
import Button from '../Button.vue';
import { createVoiceRecorder } from '../chat/use-voice-record';
import {
  DIALECT_CHIPS,
  GSV_TUTORIAL_URL,
  MIMO_VOICE_CHIPS,
  OPENAI_VOICE_CHIPS,
  STYLE_CHIPS,
  appendChip,
  draftToProfile,
  emptyDraft,
  newVoiceId,
  validateRefUpload,
  type WizardDraft,
} from '../../settings/voice-studio-state';

const { t } = useI18n();
const props = defineProps<{ open: boolean; micDeviceId: string }>();
const emit = defineEmits<{ save: [profile: VoiceProfile, stagedFile: string | null]; cancel: [] }>();

const draft = ref<WizardDraft>(emptyDraft());
const errMsg = ref('');
const busy = ref(false);
/** 引擎测连结果：undefined=未测。 */
const engineTest = ref<Record<'gptsovits' | 'fishaudio', { ok: boolean; error?: string } | undefined>>(
  { gptsovits: undefined, fishaudio: undefined },
);
/** 克隆引擎连接配置（工坊内配置，spec §1 裁定不进 provider 工作台）。 */
const gsvApiBase = ref('');
const fishApiBase = ref('');
const fishKey = ref('');
const fileInput = ref<HTMLInputElement | null>(null);
const transcribing = ref(false);

watch(
  () => props.open,
  async (open) => {
    if (!open) return;
    draft.value = emptyDraft();
    errMsg.value = '';
    engineTest.value = { gptsovits: undefined, fishaudio: undefined };
    const p = await window.openpet.rpc('app.prefs.getAll', {});
    gsvApiBase.value = p['voice.engines.gptsovits.apiBase'];
    fishApiBase.value = p['voice.engines.fishaudio.apiBase'];
    fishKey.value = p['voice.engines.fishaudio.key'];
  },
);

const TABS: Array<{ kind: VoiceKind; label: string }> = [
  { kind: 'preset', label: 'settings.voice.tabPreset' },
  { kind: 'design', label: 'settings.voice.tabDesign' },
  { kind: 'clone', label: 'settings.voice.tabClone' },
];

const voiceChips = computed(() =>
  draft.value.presetEngine === 'openai' ? OPENAI_VOICE_CHIPS : MIMO_VOICE_CHIPS,
);

// 克隆保存/试听门：引擎测连通过 + 素材齐（refAudio+refText 或 fishaudio referenceId）
const cloneEngineOk = computed(() => engineTest.value[draft.value.cloneEngine]?.ok === true);
const canSave = computed(() => {
  if (busy.value) return false;
  if (draft.value.kind === 'clone' && !cloneEngineOk.value) return false;
  return draftToProfile(draft.value, () => 'vp_probe').ok;
});

function setKind(kind: VoiceKind): void {
  draft.value.kind = kind;
  errMsg.value = '';
}

function openTutorial(): void {
  void window.openpet.rpc('app.openExternal', { url: GSV_TUTORIAL_URL });
}

async function setEnginePref(key: string, value: string): Promise<void> {
  await window.openpet.rpc('app.prefs.set', { key, value });
  // 连接配置变了，旧测连结果作废
  engineTest.value = { gptsovits: undefined, fishaudio: undefined };
}

async function testEngine(engine: 'gptsovits' | 'fishaudio'): Promise<void> {
  busy.value = true;
  try {
    engineTest.value = {
      ...engineTest.value,
      [engine]: await window.openpet.rpc('voice.testEngine', { engine }),
    };
  } finally {
    busy.value = false;
  }
}

// --- 参考音频：上传 / 现场录制 → voice.saveRefAudio 暂存 → voice.transcribe 填参考文本草稿 ---
async function stageRefAudio(dataBase64: string, mime: string): Promise<void> {
  const { file } = await window.openpet.rpc('voice.saveRefAudio', { dataBase64, mime });
  draft.value.refAudioFile = file;
  transcribing.value = true;
  try {
    const { text } = await window.openpet.rpc('voice.transcribe', { dataBase64, mime });
    if (text && !draft.value.refText.trim()) draft.value.refText = text;
  } catch {
    // STT 未配置/失败 → 参考文本留给用户手填（页内已有说明）
  } finally {
    transcribing.value = false;
  }
}

async function onFilePicked(e: Event): Promise<void> {
  const file = (e.target as HTMLInputElement).files?.[0];
  (e.target as HTMLInputElement).value = '';
  if (!file) return;
  const err = validateRefUpload(file.name, file.size);
  if (err) {
    errMsg.value = t(err === 'size' ? 'settings.voice.errRefSize' : 'settings.voice.errRefType');
    return;
  }
  errMsg.value = '';
  busy.value = true;
  try {
    const buf = new Uint8Array(await file.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000)
      bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    await stageRefAudio(btoa(bin), file.name.toLowerCase().endsWith('.mp3') ? 'audio/mpeg' : 'audio/wav');
  } catch (e2) {
    errMsg.value = e2 instanceof Error ? e2.message : String(e2);
  } finally {
    busy.value = false;
  }
}

const recorder = createVoiceRecorder({
  onText: (text) => {
    if (text && !draft.value.refText.trim()) draft.value.refText = text;
  },
  onWav: async (dataBase64, mime) => {
    const { file } = await window.openpet.rpc('voice.saveRefAudio', { dataBase64, mime });
    draft.value.refAudioFile = file;
  },
  deviceId: () => props.micDeviceId,
});

async function previewDraft(): Promise<void> {
  const r = draftToProfile(
    { ...draft.value, name: draft.value.name.trim() || t('settings.voice.draftName') },
    () => 'vp_draft',
  );
  if (!r.ok) {
    errMsg.value = t('settings.voice.errIncomplete', { detail: r.error });
    return;
  }
  errMsg.value = '';
  busy.value = true;
  try {
    await window.openpet.rpc('voice.previewProfile', {
      profile: r.profile,
      text: t('settings.voice.previewSentence'),
    });
  } catch (e) {
    errMsg.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}

function save(): void {
  const r = draftToProfile(draft.value, () => newVoiceId());
  if (!r.ok) {
    errMsg.value = t('settings.voice.errIncomplete', { detail: r.error });
    return;
  }
  emit('save', r.profile, r.profile.refAudioFile ?? null);
}
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 z-[60] flex items-center justify-center"
    style="background: rgba(0, 0, 0, 0.32)"
    @click.self="emit('cancel')"
  >
    <div class="ds-glass max-h-[88vh] w-[620px] overflow-y-auto rounded-panel p-5">
      <div class="text-md font-semibold text-text-main">{{ t('settings.voice.wizardTitle') }}</div>

      <!-- 三 Tab：预设 / 设计 / 克隆 -->
      <div class="mt-3 flex gap-2">
        <button
          v-for="tab in TABS"
          :key="tab.kind"
          class="rounded-btn border px-3 py-1.5 text-sm transition ease-ds"
          :class="draft.kind === tab.kind ? 'border-brand-to text-text-main' : 'border-glass-border text-text-sub hover:text-text-main'"
          :style="draft.kind === tab.kind ? 'background: var(--ds-warm-soft)' : ''"
          @click="setKind(tab.kind)"
        >
          {{ t(tab.label) }}
        </button>
      </div>

      <label class="mt-4 block">
        <span class="mb-1 block text-sm text-text-sub">{{ t('settings.voice.name') }}</span>
        <Input v-model="draft.name" :placeholder="t('settings.voice.namePlaceholder')" />
      </label>

      <!-- 预设 Tab -->
      <div v-if="draft.kind === 'preset'" class="mt-4 space-y-3">
        <div>
          <span class="mb-1 block text-sm text-text-sub">{{ t('settings.voice.engine') }}</span>
          <div class="flex gap-2">
            <button
              v-for="eng in ['openai', 'mimo'] as const"
              :key="eng"
              class="rounded-btn border px-3 py-1.5 text-sm transition ease-ds"
              :class="draft.presetEngine === eng ? 'border-brand-to text-text-main' : 'border-glass-border text-text-sub'"
              :style="draft.presetEngine === eng ? 'background: var(--ds-warm-soft)' : ''"
              @click="draft.presetEngine = eng"
            >
              {{ t(`settings.voice.engine_${eng}`) }}
            </button>
          </div>
          <p class="mt-1 text-sm text-text-sub">{{ t('settings.voice.presetEngineHint') }}</p>
        </div>
        <label class="block">
          <span class="mb-1 block text-sm text-text-sub">{{ t('settings.voice.voiceName') }}</span>
          <Input v-model="draft.voiceName" placeholder="alloy" />
        </label>
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="chip in voiceChips"
            :key="chip"
            class="rounded-full border border-glass-border px-2.5 py-0.5 text-sm text-text-sub transition hover:text-text-main"
            @click="draft.voiceName = chip"
          >
            {{ chip }}
          </button>
        </div>
      </div>

      <!-- 设计 Tab（MiMo voicedesign） -->
      <div v-else-if="draft.kind === 'design'" class="mt-4 space-y-3">
        <p class="text-sm text-text-sub">{{ t('settings.voice.designHint') }}</p>
        <textarea
          v-model="draft.stylePrompt"
          rows="3"
          class="ds-control w-full rounded-input p-2 text-sm text-text-main"
          :placeholder="t('settings.voice.stylePlaceholder')"
        />
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="chip in STYLE_CHIPS"
            :key="chip"
            class="rounded-full border border-glass-border px-2.5 py-0.5 text-sm text-text-sub transition hover:text-text-main"
            @click="draft.stylePrompt = appendChip(draft.stylePrompt, chip)"
          >
            {{ chip }}
          </button>
        </div>
        <div>
          <span class="mb-1 block text-sm text-text-sub">{{ t('settings.voice.dialect') }}</span>
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="chip in DIALECT_CHIPS"
              :key="chip"
              class="rounded-full border px-2.5 py-0.5 text-sm transition"
              :class="draft.dialect === chip ? 'border-brand-to text-text-main' : 'border-glass-border text-text-sub hover:text-text-main'"
              :style="draft.dialect === chip ? 'background: var(--ds-warm-soft)' : ''"
              @click="draft.dialect = draft.dialect === chip ? '' : chip"
            >
              {{ chip }}
            </button>
          </div>
        </div>
        <details>
          <summary class="cursor-pointer text-sm text-text-sub">{{ t('settings.voice.advanced') }}</summary>
          <label class="mt-2 block">
            <span class="mb-1 block text-sm text-text-sub">{{ t('settings.voice.seedText') }}</span>
            <Input v-model="draft.seedText" :placeholder="t('settings.voice.seedTextHint')" />
          </label>
        </details>
      </div>

      <!-- 克隆 Tab -->
      <div v-else class="mt-4 space-y-3">
        <p class="text-sm text-text-sub">{{ t('settings.voice.cloneHint') }}</p>
        <!-- 参考音频：上传 / 现场录制 -->
        <div class="flex items-center gap-2">
          <input ref="fileInput" type="file" accept=".wav,.mp3" class="hidden" @change="onFilePicked" />
          <Button variant="secondary" :disabled="busy" @click="fileInput?.click()">
            <span class="flex items-center gap-1.5">
              <Upload :size="14" :stroke-width="1.5" />{{ t('settings.voice.uploadRef') }}
            </span>
          </Button>
          <Button
            variant="secondary"
            :disabled="busy"
            @click="recorder.toggle()"
          >
            <span class="flex items-center gap-1.5" :style="recorder.micError.value ? 'color: var(--ds-danger)' : ''">
              <Square v-if="recorder.state.value === 'recording'" :size="14" :stroke-width="1.5" />
              <Mic v-else :size="14" :stroke-width="1.5" />
              {{
                recorder.state.value === 'recording'
                  ? t('settings.voice.recordStop', { s: Math.floor(recorder.elapsedMs.value / 1000) })
                  : t('settings.voice.recordStart')
              }}
            </span>
          </Button>
          <span v-if="draft.refAudioFile" class="text-sm" style="color: var(--ds-success)">
            {{ t('settings.voice.refReady', { file: draft.refAudioFile }) }}
          </span>
        </div>
        <p v-if="recorder.state.value === 'recording'" class="text-sm text-text-sub">
          {{ t('settings.voice.recordHint') }}
        </p>
        <!-- 参考文本（克隆质量关键；STT 自动填草稿可改） -->
        <label class="block">
          <span class="mb-1 block text-sm text-text-sub">
            {{ t('settings.voice.refText') }}
            <span v-if="transcribing">{{ t('settings.voice.transcribing') }}</span>
          </span>
          <textarea
            v-model="draft.refText"
            rows="2"
            class="ds-control w-full rounded-input p-2 text-sm text-text-main"
            :placeholder="t('settings.voice.refTextPlaceholder')"
          />
          <span class="mt-1 block text-sm text-text-sub">{{ t('settings.voice.refTextHint') }}</span>
        </label>

        <!-- 引擎选择 + 测连 -->
        <div class="space-y-2">
          <div
            v-for="eng in ['gptsovits', 'fishaudio'] as const"
            :key="eng"
            class="rounded-card border p-3"
            :class="draft.cloneEngine === eng ? 'border-brand-to' : 'border-glass-border'"
            :style="draft.cloneEngine === eng ? 'background: var(--ds-warm-soft)' : ''"
          >
            <div class="flex items-center gap-2">
              <label class="flex flex-1 cursor-pointer items-center gap-2">
                <input v-model="draft.cloneEngine" type="radio" :value="eng" />
                <span class="text-base font-medium text-text-main">{{ t(`settings.voice.engine_${eng}`) }}</span>
                <span class="text-sm text-text-sub">{{ t(`settings.voice.engineDesc_${eng}`) }}</span>
              </label>
              <span
                v-if="engineTest[eng]"
                class="rounded-full px-2 py-0.5 text-xs"
                :style="engineTest[eng]!.ok ? 'background: var(--ds-warm-soft); color: var(--ds-success)' : 'background: var(--ds-warm-soft); color: var(--ds-danger)'"
              >
                {{ engineTest[eng]!.ok ? t('settings.voice.testOk') : t('settings.voice.testFail', { error: engineTest[eng]!.error ?? '' }) }}
              </span>
              <Button variant="secondary" :disabled="busy" @click="testEngine(eng)">
                {{ t('settings.voice.testConn') }}
              </Button>
            </div>
            <div v-if="draft.cloneEngine === eng" class="mt-2 space-y-2">
              <template v-if="eng === 'gptsovits'">
                <p class="flex items-center gap-2 text-sm text-text-sub">
                  {{ t('settings.voice.gsvNeedLocal') }}
                  <button class="inline-flex items-center gap-1 underline" @click="openTutorial">
                    <BookOpen :size="13" :stroke-width="1.5" />{{ t('settings.voice.gsvTutorial') }}
                  </button>
                </p>
                <label class="block">
                  <span class="mb-1 block text-sm text-text-sub">{{ t('settings.voice.apiBase') }}</span>
                  <Input
                    v-model="gsvApiBase"
                    placeholder="http://127.0.0.1:9880"
                    @focusout="setEnginePref('voice.engines.gptsovits.apiBase', gsvApiBase.trim())"
                  />
                </label>
              </template>
              <template v-else>
                <label class="block">
                  <span class="mb-1 block text-sm text-text-sub">{{ t('settings.voice.apiBase') }}</span>
                  <Input
                    v-model="fishApiBase"
                    placeholder="https://api.fish-audio.cn"
                    @focusout="setEnginePref('voice.engines.fishaudio.apiBase', fishApiBase.trim())"
                  />
                </label>
                <label class="block">
                  <span class="mb-1 block text-sm text-text-sub">{{ t('settings.voice.fishKey') }}</span>
                  <input
                    v-model="fishKey"
                    type="password"
                    class="ds-control w-full rounded-input px-3 py-2 text-base text-text-main"
                    @focusout="setEnginePref('voice.engines.fishaudio.key', fishKey.trim())"
                  />
                </label>
                <label class="block">
                  <span class="mb-1 block text-sm text-text-sub">{{ t('settings.voice.referenceId') }}</span>
                  <Input v-model="draft.referenceId" placeholder="626bb6d3f3364c9cbc3aa6a67300a664" />
                  <span class="mt-1 block text-sm text-text-sub">{{ t('settings.voice.referenceIdHint') }}</span>
                </label>
              </template>
            </div>
          </div>
        </div>
      </div>

      <div
        v-if="errMsg"
        class="mt-3 rounded-card px-3 py-2 text-sm"
        style="color: var(--ds-danger); background: var(--ds-warm-soft)"
      >
        {{ errMsg }}
      </div>

      <div class="mt-5 flex items-center justify-between">
        <Button variant="secondary" :disabled="busy" @click="previewDraft">
          <span class="flex items-center gap-1.5">
            <Play :size="14" :stroke-width="1.5" />{{ t('settings.voice.previewDraft') }}
          </span>
        </Button>
        <div class="flex gap-2">
          <Button variant="ghost" @click="emit('cancel')">{{ t('common.cancel') }}</Button>
          <Button variant="primary" :disabled="!canSave" @click="save">{{ t('common.save') }}</Button>
        </div>
      </div>
    </div>
  </div>
</template>
