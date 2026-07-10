<!-- settings/pages/PersonaPage.vue — Hub「对话→人格」页（§6，照 AstrBot PersonaManager 简化 + §2 glass）。
     卡片列表（默认★/绑定标记/预览）+ 新建/编辑对话框（模板 chips + 开场白成对增删）。逻辑下沉 persona-view.ts。 -->
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { PERSONA_TEMPLATES, type Persona } from '@openpet/protocol';
import Button from '../../components/Button.vue';
import Input from '../../components/Input.vue';
import ConfirmDialog from '../../components/ConfirmDialog.vue';
import {
  validateDraft,
  draftToPersona,
  promptPreview,
  type PersonaDraft,
} from '../persona-view.js';

const { t } = useI18n();
const personas = ref<Persona[]>([]);
const defaultId = ref('');
const bindings = ref<Record<string, string>>({});
const characterId = ref('default');
const characterName = ref('');
const showForm = ref(false);
const draft = ref<PersonaDraft>({ name: '', systemPrompt: '', beginDialogs: [] });
const formError = ref('');
const pendingDelete = ref<Persona | null>(null);

async function load(): Promise<void> {
  const all = await window.openpet.rpc('persona.getAll', {});
  personas.value = all.personas;
  defaultId.value = all.defaultId;
  bindings.value = all.bindings;
  const c = await window.openpet.rpc('character.current', {});
  characterId.value = c.characterId;
  characterName.value = c.manifest.name;
}
onMounted(load);

function openCreate(): void {
  draft.value = { name: '', systemPrompt: '', beginDialogs: [] };
  formError.value = '';
  showForm.value = true;
}
function openEdit(p: Persona): void {
  draft.value = {
    id: p.id,
    name: p.name,
    systemPrompt: p.systemPrompt,
    beginDialogs: [...p.beginDialogs],
  };
  formError.value = '';
  showForm.value = true;
}
function applyTemplate(i: number): void {
  const tpl = PERSONA_TEMPLATES[i];
  if (tpl) draft.value.systemPrompt = tpl.systemPrompt;
}
function addDialogPair(): void {
  draft.value.beginDialogs.push('', '');
}
function removeDialogPair(i: number): void {
  draft.value.beginDialogs.splice(i - (i % 2), 2);
}
async function save(): Promise<void> {
  const err = validateDraft(draft.value);
  if (err) {
    formError.value = err;
    return;
  }
  const persona = draftToPersona(draft.value, () => crypto.randomUUID());
  await window.openpet.rpc('persona.upsert', { persona });
  showForm.value = false;
  await load();
}
async function confirmDelete(): Promise<void> {
  const p = pendingDelete.value;
  pendingDelete.value = null;
  if (!p) return;
  await window.openpet.rpc('persona.delete', { id: p.id });
  await load();
}
async function toggleDefault(id: string): Promise<void> {
  await window.openpet.rpc('persona.setDefault', { id: defaultId.value === id ? '' : id });
  await load();
}
async function toggleBind(id: string): Promise<void> {
  const bound = bindings.value[characterId.value] === id;
  await window.openpet.rpc('persona.bind', {
    characterId: characterId.value,
    personaId: bound ? '' : id,
  });
  await load();
}
</script>

<template>
  <div class="space-y-6">
    <section class="ds-glass rounded-panel p-5">
      <div class="mb-3 flex items-center justify-between">
        <h2 class="text-md font-semibold text-text-main">{{ t('settings.persona.title') }}</h2>
        <Button variant="primary" @click="openCreate">{{ t('settings.persona.create') }}</Button>
      </div>

      <div v-if="!personas.length" class="px-3 py-8 text-center text-sm text-text-sub">
        {{ t('settings.persona.empty') }}
      </div>

      <div v-else class="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div
          v-for="p in personas"
          :key="p.id"
          class="rounded-card border border-glass-border bg-white/30 p-4"
        >
          <div class="flex items-center gap-2">
            <span class="truncate font-semibold text-text-main">{{ p.name }}</span>
            <span
              v-if="defaultId === p.id"
              class="shrink-0 rounded-full px-2 py-0.5 text-xs"
              style="background: var(--ds-warm-soft); color: var(--ds-brand-to)"
            >
              {{ t('settings.persona.defaultBadge') }}
            </span>
            <span
              v-if="bindings[characterId] === p.id"
              class="shrink-0 rounded-full border border-glass-border px-2 py-0.5 text-xs text-text-sub"
            >
              {{ t('settings.persona.boundTo', { name: characterName }) }}
            </span>
          </div>
          <div class="mt-2 text-sm text-text-sub">{{ promptPreview(p) }}</div>
          <div class="mt-1 text-xs text-text-sub">{{ t('settings.persona.dialogCount', { n: p.beginDialogs.length }) }}</div>
          <div class="mt-3 flex items-center gap-3 text-sm">
            <button class="text-text-sub hover:text-text-main" @click="toggleDefault(p.id)">
              {{ defaultId === p.id ? t('settings.persona.unsetDefault') : t('settings.persona.setDefault') }}
            </button>
            <button class="text-text-sub hover:text-text-main" @click="toggleBind(p.id)">
              {{ bindings[characterId] === p.id ? t('settings.persona.unbind') : t('settings.persona.bindTo', { name: characterName }) }}
            </button>
            <span class="flex-1" />
            <button class="text-text-sub hover:text-text-main" @click="openEdit(p)">{{ t('common.edit') }}</button>
            <button class="text-text-sub hover:text-text-main" @click="pendingDelete = p">
              {{ t('common.delete') }}
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- 新建/编辑对话框（结构照 AddMcpServerDialog） -->
    <div
      v-if="showForm"
      class="fixed inset-0 z-[60] flex items-center justify-center"
      style="background: rgba(0, 0, 0, 0.32)"
      @click.self="showForm = false"
    >
      <div class="ds-glass max-h-[88vh] w-[560px] overflow-y-auto rounded-panel p-5">
        <div class="text-md font-semibold text-text-main">
          {{ draft.id ? t('settings.persona.editTitle') : t('settings.persona.createTitle') }}
        </div>

        <div class="mt-4 space-y-3">
          <div>
            <span class="mb-1 block text-sm text-text-sub">{{ t('settings.persona.fromTemplate') }}</span>
            <div class="flex flex-wrap gap-2">
              <button
                v-for="(t, i) in PERSONA_TEMPLATES"
                :key="t.name"
                class="rounded-full border border-glass-border px-3 py-1 text-sm text-text-sub transition ease-ds hover:text-text-main"
                @click="applyTemplate(i)"
              >
                {{ t.name }}
              </button>
            </div>
          </div>

          <label class="block">
            <span class="mb-1 block text-sm text-text-sub">{{ t('settings.persona.name') }}</span>
            <Input v-model="draft.name" :placeholder="t('settings.persona.namePlaceholder')" />
          </label>

          <label class="block">
            <span class="mb-1 block text-sm text-text-sub">{{ t('settings.persona.prompt') }}</span>
            <textarea
              v-model="draft.systemPrompt"
              rows="6"
              class="ds-control w-full rounded-input p-2 text-sm text-text-main"
              :placeholder="t('settings.persona.promptPlaceholder')"
            />
          </label>

          <div>
            <div class="mb-1 flex items-center justify-between">
              <span class="text-sm text-text-sub">{{ t('settings.persona.beginDialogs') }}</span>
              <Button variant="secondary" @click="addDialogPair">{{ t('settings.persona.addPair') }}</Button>
            </div>
            <div
              v-for="(_, i) in draft.beginDialogs"
              :key="i"
              class="mb-2 flex items-center gap-2"
            >
              <span class="w-10 shrink-0 text-xs text-text-sub">
                {{ i % 2 === 0 ? t('settings.persona.userRole') : t('settings.persona.charRole') }}
              </span>
              <Input
                v-model="draft.beginDialogs[i]!"
                :placeholder="i % 2 === 0 ? t('settings.persona.userSays') : t('settings.persona.charReplies')"
              />
              <button
                v-if="i % 2 === 1"
                class="shrink-0 text-sm text-text-sub hover:text-text-main"
                @click="removeDialogPair(i)"
              >
                {{ t('common.delete') }}
              </button>
            </div>
          </div>
        </div>

        <div
          v-if="formError"
          class="mt-3 rounded-card px-3 py-2 text-sm"
          :style="{ color: 'var(--ds-danger)', background: 'var(--ds-warm-soft)' }"
        >
          {{ t(formError) }}
        </div>

        <div class="mt-5 flex items-center justify-end gap-2">
          <Button variant="ghost" @click="showForm = false">{{ t('common.cancel') }}</Button>
          <Button variant="primary" @click="save">{{ t('common.save') }}</Button>
        </div>
      </div>
    </div>

    <ConfirmDialog
      :open="!!pendingDelete"
      :title="t('settings.persona.confirmDeleteTitle', { name: pendingDelete?.name ?? '' })"
      :detail="t('settings.persona.confirmDeleteDetail')"
      :confirm-label="t('common.delete')"
      @confirm="confirmDelete"
      @cancel="pendingDelete = null"
    />
  </div>
</template>
