<!-- settings/pages/CharacterEditorPage.vue — Hub「角色编辑器」页（⑩.7 E4，照 UI/7283fb5f E4 区 + ui-design §9.4）。
     仅 userData 角色可编辑（内置=库页复制后编辑）；顶部角色选择器 + 左实时预览（ModelShowcase 复用
     + 试讲台词）+ 右四 Tab（外观/人格/动画&情绪/高级）+ 底部脏状态条。草稿逻辑下沉 character-editor-state.ts。 -->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { resolveChatTarget, type CharacterManifest } from '@openpet/protocol';
import Button from '../../components/Button.vue';
import Input from '../../components/Input.vue';
import Select from '../../components/Select.vue';
import ToastHost from '../../components/ToastHost.vue';
import PersonaFields from '../../components/PersonaFields.vue';
import ModelShowcase from '../components/ModelShowcase.vue';
import {
  cloneManifest,
  normalizeDraft,
  isDirty,
  validateDraft,
  type EditorDraft,
} from '../character-editor-state.js';
import {
  personaSourceOf,
  type CharacterListItem,
  type PersonaAllLike,
} from '../character-library-view.js';

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
                  <span class="uppercase text-text-main">{{ draft.engine }}</span>
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
                <Button variant="ghost" @click="removePersona">{{ t('settings.editor.removePersona') }}</Button>
              </template>
              <div v-else class="rounded-card border border-dashed border-glass-border p-6 text-center">
                <p class="text-sm text-text-sub">{{ t('settings.editor.noPackPersona') }}</p>
                <Button class="mt-3" variant="secondary" @click="addPersona">{{ t('settings.editor.addPersona') }}</Button>
              </div>
            </div>

            <!-- ③ 动画 & 情绪（T6） -->
            <div v-else-if="activeTab === 'animation'" class="text-sm text-text-sub" />

            <!-- ④ 高级（T6） -->
            <div v-else class="text-sm text-text-sub" />
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
