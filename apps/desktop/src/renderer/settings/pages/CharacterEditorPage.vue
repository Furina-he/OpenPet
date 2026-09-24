<!-- settings/pages/CharacterEditorPage.vue — Hub「角色编辑器」页（⑩.7 E4，照 UI/7283fb5f E4 区 + ui-design §9.4）。
     仅 userData 角色可编辑（内置=库页复制后编辑）；顶部角色选择器 + 左实时预览（ModelShowcase 复用
     + 试讲台词）+ 右四 Tab（外观/人格/动画&情绪/高级）+ 底部脏状态条。草稿逻辑下沉 character-editor-state.ts。 -->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  CueEventSchema,
  DEFAULT_CUES,
  SPRITE_SLOT_KEYS,
  resolveChatTarget,
  type CharacterManifest,
} from '@openpet/protocol';
import Button from '../../components/Button.vue';
import Input from '../../components/Input.vue';
import Select from '../../components/Select.vue';
import ToastHost from '../../components/ToastHost.vue';
import PersonaFields from '../../components/PersonaFields.vue';
import ModelShowcase from '../components/ModelShowcase.vue';
import SpriteThumb from '../components/SpriteThumb.vue';
import Switch from '../../components/Switch.vue';
import {
  cloneManifest,
  normalizeDraft,
  normalizeSprite,
  isDirty,
  validateDraft,
  setSpriteAction,
  setSpriteEmotion,
  setSpriteSlot,
  spriteActionNames,
  spriteEmotionNames,
  type EditorDraft,
} from '../character-editor-state.js';
import {
  personaSourceOf,
  spriteSourceOf,
  type CharacterListItem,
  type PersonaAllLike,
} from '../character-library-view.js';
import { engineLabel } from '../engine-label.js';
import { tryResolveSprite } from '../sprite-thumb.js';

const props = defineProps<{ initialId?: string | null }>();
const emit = defineEmits<{ navigate: [route: string] }>();
const { t } = useI18n();

const items = ref<CharacterListItem[]>([]);
const personaAll = ref<PersonaAllLike>({ personas: [], defaultId: '', bindings: {} });
const currentId = ref<string>('');
const original = ref<CharacterManifest | null>(null);
const draft = ref<EditorDraft | null>(null);
const files = ref<string[]>([]);
const activeTab = ref<'appearance' | 'persona' | 'animation' | 'advanced'>('appearance');
const errors = ref<Record<string, string>>({});
const saveError = ref('');
const saving = ref(false);
const greeting = ref(false);
const chatReady = ref(false);
const tagInput = ref('');
const actionInput = ref('');
const voices = ref<Array<{ id: string; name: string }>>([]);
const showcase = ref<InstanceType<typeof ModelShowcase> | null>(null);
const toastHost = ref<InstanceType<typeof ToastHost> | null>(null);
const toast = (text: string): void => toastHost.value?.show('float', text);
const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const editable = computed(() => items.value.filter((x) => !x.builtin));
const options = computed(() =>
  editable.value.map((x) => ({ value: x.characterId, label: `${x.manifest.name} (${x.characterId})` })),
);
const dirty = computed(() =>
  original.value && draft.value ? isDirty(original.value, draft.value) : false,
);
const imageFiles = computed(() => files.value.filter((f) => /\.(png|jpe?g|webp|gif)$/i.test(f)));
const personaSource = computed(() =>
  original.value
    ? personaSourceOf(original.value.id, normalizeDraft(draft.value ?? original.value), personaAll.value)
    : 'builtin',
);

async function loadList(): Promise<void> {
  const [r, p, prefs] = await Promise.all([
    window.openpet.rpc('character.list', {}),
    window.openpet.rpc('persona.getAll', {}),
    window.openpet.rpc('app.prefs.getAll', {}),
  ]);
  items.value = r.characters;
  personaAll.value = p;
  voices.value = prefs['voice.voices'].map((v) => ({ id: v.id, name: v.name }));
  chatReady.value =
    resolveChatTarget(
      prefs['model.providerSources'],
      prefs['model.models'],
      prefs['model.defaultChatModelId'],
    ) !== null;
  if (!currentId.value || !editable.value.some((x) => x.characterId === currentId.value)) {
    const want = props.initialId;
    currentId.value =
      (want && editable.value.some((x) => x.characterId === want) ? want : null) ??
      editable.value[0]?.characterId ??
      '';
  }
}

async function openCharacter(id: string): Promise<void> {
  const item = items.value.find((x) => x.characterId === id);
  if (!item) {
    original.value = null;
    draft.value = null;
    return;
  }
  original.value = item.manifest;
  draft.value = cloneManifest(item.manifest);
  errors.value = {};
  saveError.value = '';
  try {
    files.value = (await window.openpet.rpc('character.listFiles', { id })).files;
  } catch {
    files.value = [];
  }
}
watch(currentId, (id) => void openCharacter(id));
onMounted(() => void loadList());
watch(
  () => props.initialId,
  (id) => {
    if (id) currentId.value = id;
  },
);

function discard(): void {
  if (original.value) draft.value = cloneManifest(original.value);
  errors.value = {};
  saveError.value = '';
}
async function save(): Promise<void> {
  if (!draft.value || !original.value) return;
  errors.value = validateDraft(draft.value);
  if (Object.keys(errors.value).length > 0) return;
  saving.value = true;
  saveError.value = '';
  try {
    const manifest = normalizeDraft(draft.value);
    await window.openpet.rpc('character.updateManifest', { id: original.value.id, manifest });
    toast(t('settings.editor.savedToast'));
    await loadList();
    await openCharacter(currentId.value);
  } catch (e) {
    saveError.value = errText(e);
  } finally {
    saving.value = false;
  }
}
async function testGreeting(): Promise<void> {
  if (!original.value || greeting.value) return;
  greeting.value = true;
  try {
    await window.openpet.rpc('character.testGreeting', { id: original.value.id });
    toast(t('settings.editor.greetingSent'));
  } catch (e) {
    toast(t('settings.characters.opFailed', { detail: errText(e) }));
  } finally {
    greeting.value = false;
  }
}

// --- 外观 Tab ---
function addTag(): void {
  const v = tagInput.value.trim();
  if (!draft.value || !v) return;
  draft.value.tags = [...(draft.value.tags ?? []), v];
  tagInput.value = '';
}
function removeTag(i: number): void {
  if (!draft.value) return;
  draft.value.tags = (draft.value.tags ?? []).filter((_, x) => x !== i);
}

// --- 人格 Tab ---
function addPersona(): void {
  if (draft.value && !draft.value.persona)
    draft.value.persona = { systemPrompt: '', beginDialogs: [] };
}
function removePersona(): void {
  if (draft.value) delete draft.value.persona;
}

// --- ⑫ 开场白 / 世界书编辑（normalize 收敛空值；schema 校验兜底在保存链）---
function addGreeting(): void {
  if (!draft.value?.persona) return;
  draft.value.persona.greetings = [...(draft.value.persona.greetings ?? []), ''];
}
function removeGreeting(i: number): void {
  if (!draft.value?.persona) return;
  draft.value.persona.greetings = (draft.value.persona.greetings ?? []).filter((_, x) => x !== i);
}
function addLoreEntry(): void {
  if (!draft.value) return;
  if (!draft.value.lorebook) draft.value.lorebook = { scanDepth: 4, tokenBudget: 1024, entries: [] };
  draft.value.lorebook.entries.push({ keys: [], content: '', enabled: true, insertionOrder: 100, caseSensitive: false, constant: false });
}
function setLoreKeys(i: number, raw: string): void {
  const entry = draft.value?.lorebook?.entries[i];
  if (!entry) return;
  entry.keys = raw.split(/[,，]/).map((s) => s.trim()).filter((s) => s.length > 0);
  entry.constant = entry.keys.length === 0; // 留空 = 常驻
}
function removeLoreEntry(i: number): void {
  if (!draft.value?.lorebook) return;
  draft.value.lorebook.entries = draft.value.lorebook.entries.filter((_, x) => x !== i);
}

// --- 动画 & 情绪 Tab ---
const CUE_EVENTS = CueEventSchema.options;
const BASIC_EMOTIONS = ['happy', 'sad', 'angry', 'surprised', 'relaxed', 'shy', 'curious', 'sleepy'];

function uniqueName(base: string, taken: string[]): string {
  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(`${base}${n}`)) n++;
  return `${base}${n}`;
}
/** + 自定义情绪：优先补 8 基础情绪缺口，其余 customN。 */
function addEmotion(): void {
  if (!draft.value) return;
  const rec =
    draft.value.engine === 'vrm'
      ? (draft.value.emotions ??= {})
      : (draft.value.live2dEmotions ??= {});
  const taken = Object.keys(rec);
  const name = BASIC_EMOTIONS.find((e) => !taken.includes(e)) ?? uniqueName('custom', taken);
  if (draft.value.engine === 'vrm') (rec as Record<string, Record<string, number>>)[name] = { happy: 1 };
  else (rec as Record<string, string>)[name] = '';
}
function renameRecordKey(rec: Record<string, unknown>, oldKey: string, next: string): void {
  const nv = next.trim();
  if (!nv || nv === oldKey || nv in rec) return;
  const entries = Object.entries(rec).map(([k, v]) => (k === oldKey ? [nv, v] : [k, v]));
  for (const k of Object.keys(rec)) delete rec[k];
  Object.assign(rec, Object.fromEntries(entries));
}
function addExpression(emo: string): void {
  const weights = draft.value?.emotions?.[emo];
  if (weights) weights[uniqueName('happy', Object.keys(weights))] = 1;
}
function addAction(): void {
  const v = actionInput.value.trim();
  if (!draft.value || !v) return;
  if (!(draft.value.actions ?? []).includes(v)) draft.value.actions = [...(draft.value.actions ?? []), v];
  actionInput.value = '';
}
function removeAction(i: number): void {
  if (!draft.value) return;
  draft.value.actions = (draft.value.actions ?? []).filter((_, x) => x !== i);
}
function addMotion(): void {
  if (!draft.value) return;
  const rec = (draft.value.live2dMotions ??= {});
  rec[uniqueName('wave', Object.keys(rec))] = { group: 'TapBody' };
}
function addCue(): void {
  if (!draft.value) return;
  draft.value.cues = [...(draft.value.cues ?? []), { on: 'tap.head' }];
}
function removeCue(i: number): void {
  if (!draft.value) return;
  draft.value.cues = (draft.value.cues ?? []).filter((_, x) => x !== i);
}
/** 「从默认表复制」起步：DEFAULT_CUES 深拷贝进草稿。 */
function copyDefaultCues(): void {
  if (draft.value) draft.value.cues = JSON.parse(JSON.stringify(DEFAULT_CUES));
}
const sayText = (say: string[] | undefined): string => (say ?? []).join('\n');
function setSay(i: number, text: string): void {
  const cue = draft.value?.cues?.[i];
  if (!cue) return;
  const lines = text.split('\n');
  if (lines.every((l) => l.trim() === '')) delete cue.say;
  else cue.say = lines;
}
function setCooldown(i: number, raw: string): void {
  const cue = draft.value?.cues?.[i];
  if (!cue) return;
  const n = Number(raw);
  if (raw === '' || Number.isNaN(n) || n < 0) delete cue.cooldownMs;
  else cue.cooldownMs = Math.floor(n);
}

// --- 高级 Tab ---
const voiceOptions = computed(() => [
  { value: '', label: t('settings.characters.voiceDefault') },
  ...voices.value.map((v) => ({ value: v.id, label: v.name })),
]);
async function exportPack(): Promise<void> {
  if (!original.value) return;
  try {
    const r = await window.openpet.rpc('character.export', { id: original.value.id });
    if (!r.canceled) toast(t('settings.characters.exported', { path: r.path }));
  } catch (e) {
    toast(t('settings.characters.opFailed', { detail: errText(e) }));
  }
}
function revealFolder(): void {
  if (original.value) void window.openpet.rpc('character.revealInFolder', { id: original.value.id });
}

// --- ⑳ 帧动画映射（几何 cell/states 不在 E4 编辑；映射写作者原文，预设展开归 resolveSprite）---
const spriteResolved = computed(() =>
  draft.value?.engine === 'sprite' && draft.value.sprite
    ? tryResolveSprite(normalizeSprite(draft.value.sprite))
    : null,
);
const spriteSource = computed(() =>
  original.value && draft.value ? spriteSourceOf(original.value.id, draft.value) : null,
);
const spriteStateNames = computed(() => Object.keys(spriteResolved.value?.states ?? {}));
function spriteRaw(): NonNullable<EditorDraft['sprite']> {
  return draft.value!.sprite!;
}
function setEmotionField(name: string, field: 'loop' | 'enter' | 'speed', raw: string): void {
  if (!draft.value?.sprite) return;
  const cur = spriteResolved.value?.emotions[name];
  const next = { loop: cur?.loop, enter: cur?.enter, speed: cur?.speed ?? 1 };
  if (field === 'speed') {
    const n = Number(raw);
    next.speed = Number.isFinite(n) && n >= 0.25 && n <= 4 ? n : 1;
  } else next[field] = raw || undefined;
  setSpriteEmotion(draft.value.sprite, name, next.loop || next.enter ? next : null);
}
const SPRITE_FACINGS = ['front', 'left', 'right'] as const;

const TABS = [
  { key: 'appearance', label: 'settings.editor.tabs.appearance' },
  { key: 'persona', label: 'settings.editor.tabs.persona' },
  { key: 'animation', label: 'settings.editor.tabs.animation' },
  { key: 'advanced', label: 'settings.editor.tabs.advanced' },
] as const;
</script>

<template>
  <div class="flex h-full min-h-0 flex-col space-y-4">
    <!-- 空态：无 userData 角色 → 从库中复制内置角色开始 -->
    <section v-if="!editable.length" class="ds-glass rounded-panel p-10 text-center">
      <p class="text-md text-text-main">{{ t('settings.editor.emptyTitle') }}</p>
      <p class="mt-2 text-sm text-text-sub">{{ t('settings.editor.emptyHint') }}</p>
      <Button class="mt-5" variant="primary" @click="emit('navigate', 'character.library')">
        {{ t('settings.editor.gotoLibrary') }}
      </Button>
    </section>

    <template v-else>
      <!-- 顶部：角色选择器 -->
      <section class="ds-glass flex items-center gap-3 rounded-panel p-4">
        <span class="text-sm text-text-sub">{{ t('settings.editor.pickCharacter') }}</span>
        <Select v-model="currentId" :options="options" />
        <span v-if="dirty" class="rounded-full px-2 py-0.5 text-xs" style="background: var(--ds-warm-soft); color: var(--ds-brand-to)">
          {{ t('settings.editor.dirtyBadge') }}
        </span>
      </section>

      <div v-if="draft && original" class="flex min-h-0 flex-1 gap-4">
        <!-- 左列：实时预览 + 试讲 -->
        <div class="flex w-[300px] shrink-0 flex-col gap-3">
          <ModelShowcase
            ref="showcase"
            :key="original.id"
            :character-id="original.id"
            :manifest="original"
            compact
            class="min-h-[360px]"
          />
          <Button
            variant="secondary"
            :disabled="!chatReady || greeting"
            :title="chatReady ? '' : t('settings.editor.greetingNeedsModel')"
            @click="testGreeting"
          >
            {{ greeting ? t('settings.editor.greetingBusy') : t('settings.editor.testGreeting') }}
          </Button>
          <p v-if="!chatReady" class="text-xs text-text-sub">{{ t('settings.editor.greetingNeedsModel') }}</p>
        </div>

        <!-- 右列：四 Tab -->
        <section class="ds-glass flex min-h-0 min-w-0 flex-1 flex-col rounded-panel">
          <div class="flex shrink-0 gap-1 border-b border-glass-border px-4 pt-3">
            <button
              v-for="tab in TABS"
              :key="tab.key"
              class="relative rounded-t-btn px-4 py-2 text-sm transition ease-ds"
              :class="activeTab === tab.key ? 'font-medium text-text-main' : 'text-text-sub hover:text-text-main'"
              @click="activeTab = tab.key"
            >
              {{ t(tab.label) }}
              <span
                v-if="activeTab === tab.key"
                class="absolute inset-x-3 bottom-0 h-0.5 rounded-full"
                style="background: linear-gradient(90deg, var(--ds-brand-from), var(--ds-brand-to))"
              />
            </button>
          </div>

          <div class="min-h-0 flex-1 overflow-y-auto p-5">
            <!-- ① 外观 -->
            <div v-if="activeTab === 'appearance'" class="max-w-[560px] space-y-4">
              <label class="block">
                <span class="mb-1 block text-sm text-text-sub">{{ t('settings.editor.fields.name') }}</span>
                <Input v-model="draft.name" />
                <span v-if="errors['name']" class="mt-1 block text-xs" style="color: var(--ds-danger)">{{ t(errors['name']!) }}</span>
              </label>
              <label class="block">
                <span class="mb-1 block text-sm text-text-sub">{{ t('settings.characters.author') }}</span>
                <Input :model-value="draft.author ?? ''" @update:model-value="draft.author = $event" />
              </label>
              <label class="block">
                <span class="mb-1 block text-sm text-text-sub">{{ t('settings.editor.fields.description') }}</span>
                <textarea
                  :value="draft.description ?? ''"
                  rows="3"
                  class="ds-control w-full rounded-input p-2 text-sm text-text-main"
                  @input="draft.description = ($event.target as HTMLTextAreaElement).value"
                />
              </label>
              <div>
                <span class="mb-1 block text-sm text-text-sub">{{ t('settings.editor.fields.tags') }}</span>
                <div class="flex flex-wrap items-center gap-1.5">
                  <span
                    v-for="(tag, i) in draft.tags ?? []"
                    :key="`${tag}-${i}`"
                    class="flex items-center gap-1 rounded-full border border-glass-border px-2 py-0.5 text-xs text-text-sub"
                  >
                    {{ tag }}
                    <button class="hover:text-text-main" :aria-label="t('common.delete')" @click="removeTag(i)">✕</button>
                  </span>
                  <input
                    v-model="tagInput"
                    class="ds-control h-8 w-32 rounded-input px-2 text-xs text-text-main"
                    :placeholder="t('settings.editor.fields.tagPlaceholder')"
                    @keydown.enter.prevent="addTag"
                  />
                </div>
                <span v-if="errors['tags']" class="mt-1 block text-xs" style="color: var(--ds-danger)">{{ t(errors['tags']!) }}</span>
              </div>
              <label class="block">
                <span class="mb-1 block text-sm text-text-sub">{{ t('settings.characters.license') }}</span>
                <Input :model-value="draft.license ?? ''" @update:model-value="draft.license = $event" />
              </label>
              <div>
                <span class="mb-1 block text-sm text-text-sub">{{ t('settings.editor.fields.preview') }}</span>
                <Select
                  :model-value="draft.preview ?? ''"
                  :options="[
                    { value: '', label: t('settings.editor.fields.previewNone') },
                    ...imageFiles.map((f) => ({ value: f, label: f })),
                  ]"
                  @update:model-value="draft.preview = $event || undefined"
                />
              </div>
              <!-- 引擎/模型只读（id/engine/model v1 不可改） -->
              <div class="grid grid-cols-2 gap-x-6 rounded-card border border-glass-border bg-white/20 p-3 text-sm">
                <div class="flex justify-between py-1">
                  <span class="text-text-sub">{{ t('settings.characters.engine') }}</span>
                  <span class="text-text-main">{{ engineLabel(draft.engine, t) }}</span>
                </div>
                <div class="flex justify-between py-1">
                  <span class="text-text-sub">{{ t('settings.characters.modelFile') }}</span>
                  <span class="truncate pl-3 text-text-main">{{ draft.model }}</span>
                </div>
                <p class="col-span-2 mt-1 text-xs text-text-sub">{{ t('settings.editor.immutableHint') }}</p>
              </div>
            </div>

            <!-- ② 人格 -->
            <div v-else-if="activeTab === 'persona'" class="max-w-[560px] space-y-4">
              <!-- 生效序提示：用户绑定 > 包声明 > 用户默认 -->
              <div class="rounded-card border border-glass-border bg-white/20 p-3 text-sm">
                <p class="text-text-sub">{{ t('settings.editor.personaOrder') }}</p>
                <p class="mt-1 text-text-main">
                  {{ t('settings.editor.personaActive', { layer: t(`settings.characters.personaFrom.${personaSource}`) }) }}
                </p>
                <p v-if="personaSource === 'binding'" class="mt-1 text-xs" style="color: var(--ds-brand-to)">
                  {{ t('settings.editor.personaShadowed') }}
                </p>
              </div>
              <template v-if="draft.persona">
                <PersonaFields
                  :system-prompt="draft.persona.systemPrompt"
                  :begin-dialogs="draft.persona.beginDialogs"
                  show-templates
                  :prompt-rows="8"
                  @update:system-prompt="draft.persona!.systemPrompt = $event"
                  @update:begin-dialogs="draft.persona!.beginDialogs = $event"
                />
                <!-- ⑫ 开场白：切换角色时气泡随机一条；支持 char/user 宏 -->
                <div>
                  <div class="mb-2 flex items-center justify-between">
                    <span class="text-sm font-medium text-text-main">{{ t('settings.editor.greetings') }}</span>
                    <Button variant="secondary" @click="addGreeting">{{ t('settings.editor.addGreeting') }}</Button>
                  </div>
                  <div v-for="(g, i) in draft.persona.greetings ?? []" :key="i" class="mb-2 flex items-start gap-2">
                    <textarea
                      :value="g" rows="2"
                      class="ds-control flex-1 rounded-input p-2 text-sm text-text-main"
                      @change="draft.persona!.greetings![i] = ($event.target as HTMLTextAreaElement).value"
                    />
                    <button class="text-xs" style="color: var(--ds-danger)" @click="removeGreeting(i)">{{ t('common.delete') }}</button>
                  </div>
                </div>
                <Button variant="ghost" @click="removePersona">{{ t('settings.editor.removePersona') }}</Button>
              </template>
              <div v-else class="rounded-card border border-dashed border-glass-border p-6 text-center">
                <p class="text-sm text-text-sub">{{ t('settings.editor.noPackPersona') }}</p>
                <Button class="mt-3" variant="secondary" @click="addPersona">{{ t('settings.editor.addPersona') }}</Button>
              </div>

              <!-- ⑫ 世界书：关键词触发注入（keys 逗号分隔，留空=常驻） -->
              <div>
                <div class="mb-2 flex items-center justify-between">
                  <span class="text-sm font-medium text-text-main">{{ t('settings.editor.lorebook') }}</span>
                  <Button variant="secondary" @click="addLoreEntry">{{ t('settings.editor.addLorebookEntry') }}</Button>
                </div>
                <p class="mb-2 text-xs text-text-sub">{{ t('settings.editor.lorebookHint') }}</p>
                <p v-if="!draft.lorebook?.entries.length" class="rounded-card border border-dashed border-glass-border p-4 text-center text-sm text-text-sub">
                  {{ t('settings.editor.lorebookEmpty') }}
                </p>
                <div v-for="(e, i) in draft.lorebook?.entries ?? []" :key="i" class="mb-2 rounded-card border border-glass-border bg-white/20 p-3">
                  <div class="flex items-center gap-2">
                    <input
                      :value="e.keys.join(', ')" :placeholder="t('settings.editor.lorebookKeys')"
                      class="ds-control h-8 flex-1 rounded-input px-2 text-sm text-text-main"
                      @change="setLoreKeys(i, ($event.target as HTMLInputElement).value)"
                    />
                    <label class="flex items-center gap-1 text-xs text-text-sub">
                      <input type="checkbox" :checked="e.enabled" @change="draft.lorebook!.entries[i]!.enabled = ($event.target as HTMLInputElement).checked" />
                      {{ t('settings.editor.lorebookEnabled') }}
                    </label>
                    <button class="text-xs" style="color: var(--ds-danger)" @click="removeLoreEntry(i)">{{ t('common.delete') }}</button>
                  </div>
                  <textarea
                    :value="e.content" rows="3" :placeholder="t('settings.editor.lorebookContent')"
                    class="ds-control mt-2 w-full rounded-input p-2 text-sm text-text-main"
                    @change="draft.lorebook!.entries[i]!.content = ($event.target as HTMLTextAreaElement).value"
                  />
                </div>
              </div>
            </div>

            <!-- ③ 动画 & 情绪 -->
            <div v-else-if="activeTab === 'animation'" class="max-w-[680px] space-y-6">
              <!-- ⑳ 帧动画：状态列表 + 情绪/动作映射 + 槽位 + 显示选项（替换 VRM 表情权重区与动作词表区） -->
              <template v-if="draft.engine === 'sprite' && draft.sprite">
                <p v-if="errors['sprite']" class="text-xs" style="color: var(--ds-danger)">{{ t(errors['sprite']!) }}</p>
                <div>
                  <span class="mb-1 block text-sm font-medium text-text-main">{{ t('settings.editor.sprite.states') }}</span>
                  <p class="mb-2 text-xs text-text-sub">{{ t('settings.editor.sprite.statesHint') }}</p>
                  <div class="flex flex-wrap gap-2">
                    <button
                      v-for="st in spriteStateNames"
                      :key="st"
                      class="flex w-[88px] flex-col items-center rounded-card border border-glass-border bg-white/20 p-1.5 transition ease-ds hover:bg-white/40"
                      @click="showcase?.playState(st)"
                    >
                      <SpriteThumb v-if="spriteSource" :source="spriteSource" :state="st" :width="72" :height="72" />
                      <span class="mt-1 w-full truncate text-center text-[11px] text-text-main">{{ st }}</span>
                      <span class="text-[10px] text-text-sub">
                        {{ t('settings.editor.sprite.frames', { n: spriteResolved?.states[st]?.frames ?? 0 }) }}
                      </span>
                    </button>
                  </div>
                </div>

                <div>
                  <span class="mb-1 block text-sm font-medium text-text-main">{{ t('settings.editor.sprite.emotionMap') }}</span>
                  <p class="mb-2 text-xs text-text-sub">{{ t('settings.editor.sprite.emotionHint') }}</p>
                  <div class="grid grid-cols-[minmax(0,96px)_minmax(0,1fr)_minmax(0,1fr)_56px] items-center gap-x-2 gap-y-1.5 text-xs">
                    <span class="text-text-sub">{{ t('settings.editor.sprite.emotion') }}</span>
                    <span class="text-text-sub">{{ t('settings.editor.sprite.loop') }}</span>
                    <span class="text-text-sub">{{ t('settings.editor.sprite.enter') }}</span>
                    <span class="text-text-sub">{{ t('settings.editor.sprite.speed') }}</span>
                    <template v-for="emo in spriteEmotionNames(draft.sprite)" :key="emo">
                      <span class="truncate text-sm text-text-main">{{ emo }}</span>
                      <select
                        class="ds-control h-8 w-full min-w-0 rounded-input px-2 text-xs text-text-main"
                        :value="spriteResolved?.emotions[emo]?.loop ?? ''"
                        @change="setEmotionField(emo, 'loop', ($event.target as HTMLSelectElement).value)"
                      >
                        <option value="">{{ t('settings.editor.sprite.none') }}</option>
                        <option v-for="st in spriteStateNames" :key="st" :value="st">{{ st }}</option>
                      </select>
                      <select
                        class="ds-control h-8 w-full min-w-0 rounded-input px-2 text-xs text-text-main"
                        :value="spriteResolved?.emotions[emo]?.enter ?? ''"
                        @change="setEmotionField(emo, 'enter', ($event.target as HTMLSelectElement).value)"
                      >
                        <option value="">{{ t('settings.editor.sprite.none') }}</option>
                        <option v-for="st in spriteStateNames" :key="st" :value="st">{{ st }}</option>
                      </select>
                      <input
                        type="number"
                        min="0.25"
                        max="4"
                        step="0.05"
                        :disabled="!spriteResolved?.emotions[emo]"
                        :value="spriteResolved?.emotions[emo]?.speed ?? 1"
                        class="ds-control h-8 w-full min-w-0 rounded-input px-1 text-xs text-text-main disabled:opacity-40"
                        @change="setEmotionField(emo, 'speed', ($event.target as HTMLInputElement).value)"
                      />
                    </template>
                  </div>
                </div>

                <div>
                  <span class="mb-1 block text-sm font-medium text-text-main">{{ t('settings.editor.sprite.actionMap') }}</span>
                  <p class="mb-2 text-xs text-text-sub">{{ t('settings.editor.sprite.actionHint') }}</p>
                  <div class="grid grid-cols-[minmax(0,120px)_minmax(0,1fr)] items-center gap-x-2 gap-y-1.5">
                    <template v-for="act in spriteActionNames(draft.sprite)" :key="act">
                      <span class="truncate text-sm text-text-main">{{ act }}</span>
                      <select
                        class="ds-control h-8 w-full min-w-0 rounded-input px-2 text-xs text-text-main"
                        :value="spriteResolved?.actions[act] ?? ''"
                        @change="setSpriteAction(spriteRaw(), act, ($event.target as HTMLSelectElement).value || null)"
                      >
                        <option value="">{{ t('settings.editor.sprite.procedural') }}</option>
                        <option v-for="st in spriteStateNames" :key="st" :value="st">{{ st }}</option>
                      </select>
                    </template>
                  </div>
                </div>

                <div>
                  <span class="mb-2 block text-sm font-medium text-text-main">{{ t('settings.editor.sprite.slots') }}</span>
                  <div class="grid grid-cols-[minmax(0,120px)_minmax(0,1fr)] items-center gap-x-2 gap-y-1.5">
                    <template v-for="slot in SPRITE_SLOT_KEYS" :key="slot">
                      <span class="text-sm text-text-main">{{ t(`settings.editor.sprite.slot.${slot}`) }}</span>
                      <select
                        class="ds-control h-8 w-full min-w-0 rounded-input px-2 text-xs text-text-main"
                        :value="spriteResolved?.slots[slot] ?? ''"
                        @change="setSpriteSlot(spriteRaw(), slot, ($event.target as HTMLSelectElement).value || null)"
                      >
                        <option v-if="slot !== 'idle'" value="">{{ t('settings.editor.sprite.none') }}</option>
                        <option v-for="st in spriteStateNames" :key="st" :value="st">{{ st }}</option>
                      </select>
                    </template>
                  </div>
                </div>

                <div class="space-y-3 rounded-card border border-glass-border bg-white/20 p-3">
                  <span class="block text-sm font-medium text-text-main">{{ t('settings.editor.sprite.display') }}</span>
                  <div class="flex items-center justify-between gap-3">
                    <span class="text-sm text-text-main">{{ t('settings.editor.sprite.smoothing') }}</span>
                    <select
                      class="ds-control h-8 min-w-0 max-w-[60%] rounded-input px-2 text-xs text-text-main"
                      :value="spriteRaw().smoothing ?? 'smooth'"
                      @change="spriteRaw().smoothing = ($event.target as HTMLSelectElement).value === 'pixel' ? 'pixel' : 'smooth'"
                    >
                      <option value="smooth">{{ t('settings.editor.sprite.smooth') }}</option>
                      <option value="pixel">{{ t('settings.editor.sprite.pixel') }}</option>
                    </select>
                  </div>
                  <div class="flex items-center justify-between gap-3">
                    <span class="text-sm text-text-main">{{ t('settings.editor.sprite.fit') }}</span>
                    <select
                      class="ds-control h-8 min-w-0 max-w-[60%] rounded-input px-2 text-xs text-text-main"
                      :value="spriteRaw().fit ?? 'contain'"
                      @change="spriteRaw().fit = ($event.target as HTMLSelectElement).value === 'integer' ? 'integer' : 'contain'"
                    >
                      <option value="contain">{{ t('settings.editor.sprite.contain') }}</option>
                      <option value="integer">{{ t('settings.editor.sprite.integer') }}</option>
                    </select>
                  </div>
                  <div class="flex items-center justify-between gap-3">
                    <span class="text-sm text-text-main">{{ t('settings.editor.sprite.facing') }}</span>
                    <select
                      class="ds-control h-8 min-w-0 max-w-[60%] rounded-input px-2 text-xs text-text-main"
                      :value="spriteRaw().facing ?? 'front'"
                      @change="spriteRaw().facing = SPRITE_FACINGS.find((f) => f === ($event.target as HTMLSelectElement).value) ?? 'front'"
                    >
                      <option v-for="f in SPRITE_FACINGS" :key="f" :value="f">
                        {{ t(`settings.editor.sprite.facings.${f}`) }}
                      </option>
                    </select>
                  </div>
                  <div class="flex items-center justify-between gap-3">
                    <div>
                      <span class="block text-sm text-text-main">{{ t('settings.editor.sprite.flipToCursor') }}</span>
                      <span class="block text-xs text-text-sub">{{ t('settings.editor.sprite.flipHint') }}</span>
                    </div>
                    <Switch
                      :model-value="spriteRaw().flipToCursor ?? false"
                      @update:model-value="spriteRaw().flipToCursor = $event"
                    />
                  </div>
                  <div class="flex items-center justify-between gap-3">
                    <div>
                      <span class="block text-sm text-text-main">{{ t('settings.editor.sprite.proceduralLife') }}</span>
                      <span class="block text-xs text-text-sub">{{ t('settings.editor.sprite.proceduralLifeHint') }}</span>
                    </div>
                    <Switch
                      :model-value="spriteRaw().proceduralLife ?? true"
                      @update:model-value="spriteRaw().proceduralLife = $event"
                    />
                  </div>
                </div>
              </template>

              <template v-else>
              <!-- 情绪映射表：VRM=权重组合 / Live2D=表情名；空=运行时内置默认表 -->
              <div>
                <div class="mb-2 flex items-center justify-between">
                  <span class="text-sm font-medium text-text-main">{{ t('settings.editor.emotionMap') }}</span>
                  <Button variant="secondary" @click="addEmotion">{{ t('settings.editor.addEmotion') }}</Button>
                </div>
                <p v-if="errors['emotions']" class="mb-2 text-xs" style="color: var(--ds-danger)">{{ t(errors['emotions']!) }}</p>

                <template v-if="draft.engine === 'vrm'">
                  <p v-if="!Object.keys(draft.emotions ?? {}).length" class="rounded-card border border-dashed border-glass-border p-4 text-center text-sm text-text-sub">
                    {{ t('settings.editor.emotionsEmpty') }}
                  </p>
                  <div
                    v-for="(weights, emo) in draft.emotions ?? {}"
                    :key="emo"
                    class="mb-2 rounded-card border border-glass-border bg-white/20 p-3"
                  >
                    <div class="flex items-center gap-2">
                      <input
                        :value="emo"
                        class="ds-control h-8 w-32 rounded-input px-2 text-sm font-medium text-text-main"
                        @change="renameRecordKey(draft.emotions!, String(emo), ($event.target as HTMLInputElement).value)"
                      />
                      <span class="flex-1" />
                      <button class="text-xs text-text-sub hover:text-text-main" @click="addExpression(String(emo))">{{ t('settings.editor.addExpression') }}</button>
                      <button class="text-xs" style="color: var(--ds-danger)" @click="delete draft.emotions![emo]">{{ t('common.delete') }}</button>
                    </div>
                    <div class="mt-2 flex flex-wrap gap-2">
                      <div
                        v-for="(w, expr) in weights"
                        :key="expr"
                        class="flex items-center gap-1.5 rounded-btn border border-glass-border px-2 py-1"
                      >
                        <input
                          :value="expr"
                          class="ds-control h-7 w-24 rounded-input px-2 text-xs text-text-main"
                          @change="renameRecordKey(weights, String(expr), ($event.target as HTMLInputElement).value)"
                        />
                        <input
                          type="number"
                          min="0"
                          max="1"
                          step="0.05"
                          :value="w"
                          class="ds-control h-7 w-16 rounded-input px-1 text-xs text-text-main"
                          @change="weights[expr] = Number(($event.target as HTMLInputElement).value)"
                        />
                        <button class="text-xs text-text-sub hover:text-text-main" :aria-label="t('common.delete')" @click="delete weights[expr]">✕</button>
                      </div>
                    </div>
                  </div>
                </template>

                <template v-else>
                  <p v-if="!Object.keys(draft.live2dEmotions ?? {}).length" class="rounded-card border border-dashed border-glass-border p-4 text-center text-sm text-text-sub">
                    {{ t('settings.editor.emotionsEmpty') }}
                  </p>
                  <div
                    v-for="(expr, emo) in draft.live2dEmotions ?? {}"
                    :key="emo"
                    class="mb-2 flex items-center gap-2"
                  >
                    <input
                      :value="emo"
                      class="ds-control h-8 w-32 rounded-input px-2 text-sm text-text-main"
                      @change="renameRecordKey(draft.live2dEmotions!, String(emo), ($event.target as HTMLInputElement).value)"
                    />
                    <span class="text-xs text-text-sub">→</span>
                    <input
                      :value="expr"
                      class="ds-control h-8 flex-1 rounded-input px-2 text-sm text-text-main"
                      :placeholder="t('settings.editor.live2dExprPlaceholder')"
                      @change="draft.live2dEmotions![emo] = ($event.target as HTMLInputElement).value"
                    />
                    <button class="text-xs" style="color: var(--ds-danger)" @click="delete draft.live2dEmotions![emo]">{{ t('common.delete') }}</button>
                  </div>
                </template>
              </div>

              <!-- 动作词表（chip 增删）；Live2D 另有 motion 组表 -->
              <div>
                <span class="mb-2 block text-sm font-medium text-text-main">{{ t('settings.editor.actionsVocab') }}</span>
                <p v-if="errors['actions']" class="mb-2 text-xs" style="color: var(--ds-danger)">{{ t(errors['actions']!) }}</p>
                <div class="flex flex-wrap items-center gap-1.5">
                  <span
                    v-for="(a, i) in draft.actions ?? []"
                    :key="`${a}-${i}`"
                    class="flex items-center gap-1 rounded-full border border-glass-border px-2 py-0.5 text-xs text-text-sub"
                  >
                    {{ a }}
                    <button class="hover:text-text-main" :aria-label="t('common.delete')" @click="removeAction(i)">✕</button>
                  </span>
                  <input
                    v-model="actionInput"
                    class="ds-control h-8 w-32 rounded-input px-2 text-xs text-text-main"
                    :placeholder="t('settings.editor.fields.tagPlaceholder')"
                    @keydown.enter.prevent="addAction"
                  />
                </div>
                <p class="mt-1 text-xs text-text-sub">{{ t('settings.editor.actionsHint') }}</p>
              </div>

              <div v-if="draft.engine === 'live2d'">
                <div class="mb-2 flex items-center justify-between">
                  <span class="text-sm font-medium text-text-main">{{ t('settings.editor.motionsTable') }}</span>
                  <Button variant="secondary" @click="addMotion">{{ t('common.add') }}</Button>
                </div>
                <div
                  v-for="(mo, name) in draft.live2dMotions ?? {}"
                  :key="name"
                  class="mb-2 flex items-center gap-2"
                >
                  <input
                    :value="name"
                    class="ds-control h-8 w-32 rounded-input px-2 text-sm text-text-main"
                    @change="renameRecordKey(draft.live2dMotions!, String(name), ($event.target as HTMLInputElement).value)"
                  />
                  <span class="text-xs text-text-sub">→</span>
                  <input
                    :value="mo.group"
                    class="ds-control h-8 flex-1 rounded-input px-2 text-sm text-text-main"
                    :placeholder="t('settings.editor.motionGroup')"
                    @change="mo.group = ($event.target as HTMLInputElement).value"
                  />
                  <input
                    type="number"
                    min="0"
                    :value="mo.index ?? ''"
                    class="ds-control h-8 w-20 rounded-input px-2 text-sm text-text-main"
                    :placeholder="t('settings.editor.motionIndex')"
                    @change="
                      ($event.target as HTMLInputElement).value === ''
                        ? delete mo.index
                        : (mo.index = Number(($event.target as HTMLInputElement).value))
                    "
                  />
                  <button class="text-xs" style="color: var(--ds-danger)" @click="delete draft.live2dMotions![name]">{{ t('common.delete') }}</button>
                </div>
              </div>
              </template>

              <!-- 交互 cue 表（= 设计稿 Hooks；空 = 内置默认表） -->
              <div>
                <div class="mb-2 flex items-center justify-between">
                  <span class="text-sm font-medium text-text-main">{{ t('settings.editor.cueTable') }}</span>
                  <div class="flex gap-2">
                    <Button v-if="!(draft.cues ?? []).length" variant="secondary" @click="copyDefaultCues">
                      {{ t('settings.editor.copyDefaultCues') }}
                    </Button>
                    <Button variant="secondary" @click="addCue">{{ t('settings.editor.addCue') }}</Button>
                  </div>
                </div>
                <p v-if="!(draft.cues ?? []).length" class="rounded-card border border-dashed border-glass-border p-4 text-center text-sm text-text-sub">
                  {{ t('settings.editor.cuesEmpty') }}
                </p>
                <div
                  v-for="(cue, i) in draft.cues ?? []"
                  :key="i"
                  class="mb-2 rounded-card border border-glass-border bg-white/20 p-3"
                >
                  <div class="flex items-center gap-2">
                    <Select
                      :model-value="cue.on"
                      :options="CUE_EVENTS.map((e) => ({ value: e, label: e }))"
                      @update:model-value="cue.on = $event as typeof cue.on"
                    />
                    <span class="flex-1" />
                    <button class="text-xs" style="color: var(--ds-danger)" @click="removeCue(i)">{{ t('common.delete') }}</button>
                  </div>
                  <div class="mt-2 grid grid-cols-3 gap-2">
                    <label class="block">
                      <span class="mb-1 block text-xs text-text-sub">{{ t('settings.editor.cueEmotion') }}</span>
                      <input
                        :value="cue.emotion ?? ''"
                        class="ds-control h-8 w-full rounded-input px-2 text-xs text-text-main"
                        @change="
                          ($event.target as HTMLInputElement).value.trim()
                            ? (cue.emotion = ($event.target as HTMLInputElement).value.trim())
                            : delete cue.emotion
                        "
                      />
                    </label>
                    <label class="block">
                      <span class="mb-1 block text-xs text-text-sub">{{ t('settings.editor.cueAction') }}</span>
                      <input
                        :value="cue.action ?? ''"
                        class="ds-control h-8 w-full rounded-input px-2 text-xs text-text-main"
                        @change="
                          ($event.target as HTMLInputElement).value.trim()
                            ? (cue.action = ($event.target as HTMLInputElement).value.trim())
                            : delete cue.action
                        "
                      />
                    </label>
                    <label class="block">
                      <span class="mb-1 block text-xs text-text-sub">{{ t('settings.editor.cueCooldown') }}</span>
                      <input
                        type="number"
                        min="0"
                        :value="cue.cooldownMs ?? ''"
                        class="ds-control h-8 w-full rounded-input px-2 text-xs text-text-main"
                        @change="setCooldown(i, ($event.target as HTMLInputElement).value)"
                      />
                    </label>
                  </div>
                  <label class="mt-2 block">
                    <span class="mb-1 block text-xs text-text-sub">{{ t('settings.editor.cueSay') }}</span>
                    <textarea
                      :value="sayText(cue.say)"
                      rows="2"
                      class="ds-control w-full rounded-input p-2 text-xs text-text-main"
                      :placeholder="t('settings.editor.cueSayPlaceholder')"
                      @change="setSay(i, ($event.target as HTMLTextAreaElement).value)"
                    />
                  </label>
                </div>
              </div>
            </div>

            <!-- ④ 高级 -->
            <div v-else class="max-w-[560px] space-y-4">
              <label class="block">
                <span class="mb-1 block text-sm text-text-sub">{{ t('settings.characters.version') }}</span>
                <Input v-model="draft.version" />
                <span v-if="errors['version']" class="mt-1 block text-xs" style="color: var(--ds-danger)">{{ t(errors['version']!) }}</span>
              </label>
              <div>
                <span class="mb-1 block text-sm text-text-sub">{{ t('settings.characters.voiceBinding') }}</span>
                <Select
                  :model-value="draft.voice ?? ''"
                  :options="voiceOptions"
                  @update:model-value="draft.voice = $event || undefined"
                />
                <p class="mt-1 text-xs text-text-sub">{{ t('settings.editor.voiceHint') }}</p>
              </div>
              <div class="flex gap-2 pt-2">
                <Button variant="secondary" @click="exportPack">{{ t('settings.characters.menu.export') }}</Button>
                <Button variant="ghost" @click="revealFolder">{{ t('settings.editor.openFolder') }}</Button>
              </div>
            </div>
          </div>

          <!-- 底部脏状态条 -->
          <div class="flex shrink-0 items-center gap-3 border-t border-glass-border px-5 py-3">
            <span v-if="saveError" class="min-w-0 flex-1 truncate text-xs" style="color: var(--ds-danger)">{{ saveError }}</span>
            <span v-else-if="errors['version']" class="min-w-0 flex-1 truncate text-xs" style="color: var(--ds-danger)">{{ t(errors['version']!) }}</span>
            <span v-else class="flex-1" />
            <Button variant="ghost" :disabled="!dirty || saving" @click="discard">{{ t('settings.editor.discard') }}</Button>
            <Button variant="primary" :disabled="!dirty || saving" @click="save">
              {{ saving ? t('settings.editor.saving') : t('settings.editor.saveReload') }}
            </Button>
          </div>
        </section>
      </div>
    </template>

    <ToastHost ref="toastHost" />
  </div>
</template>
