<!-- settings/pages/CharacterLibraryPage.vue — Hub「角色库」页（批次④ E1，照 UI/dc6e09f4 E1 区）。
     卡片网格 220×320（当前角色 ● 暖色描边）；双击热切换；单击简化详情抽屉；顶栏两段式导入。 -->
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import Button from '../../components/Button.vue';
import ConfirmDialog from '../../components/ConfirmDialog.vue';
import ToastHost from '../../components/ToastHost.vue';
import {
  toCardVm,
  sortCards,
  type CharacterListItem,
  type CharacterCardVm,
} from '../character-library-view.js';

const { t } = useI18n();
const items = ref<CharacterListItem[]>([]);
const selected = ref<CharacterCardVm | null>(null); // 单击 → 简化详情抽屉
const importing = ref(false);
const confirmImport = ref<{
  path: string;
  summary: { id: string; name: string; version: string; engine: string };
} | null>(null);
const removing = ref<CharacterCardVm | null>(null); // ConfirmDialog
const toastHost = ref<InstanceType<typeof ToastHost> | null>(null);
const toast = (text: string): void => toastHost.value?.show('float', text);

const cards = computed(() => sortCards(items.value.map(toCardVm)));

async function load(): Promise<void> {
  const r = await window.openpet.rpc('character.list', {});
  items.value = r.characters;
  if (selected.value) selected.value = cards.value.find((c) => c.id === selected.value?.id) ?? null;
}
onMounted(load);

async function activate(id: string): Promise<void> {
  await window.openpet.rpc('character.switch', { id });
  toast(t('settings.characters.switched'));
  await load();
}
async function pickImport(kind: 'pack' | 'folder'): Promise<void> {
  const r = await window.openpet.rpc('character.importPick', { kind });
  if (!r.cancelled) confirmImport.value = { path: r.path, summary: r.summary };
}
async function applyImport(): Promise<void> {
  if (!confirmImport.value) return;
  importing.value = true;
  try {
    await window.openpet.rpc('character.importApply', { path: confirmImport.value.path });
    toast(t('settings.characters.importedToast', { name: confirmImport.value.summary.name }));
    confirmImport.value = null;
    await load();
  } catch (e) {
    toast(t('settings.characters.importFailed', { detail: e instanceof Error ? e.message : String(e) }));
  } finally {
    importing.value = false;
  }
}
async function doRemove(): Promise<void> {
  if (!removing.value) return;
  await window.openpet.rpc('character.remove', { id: removing.value.id });
  removing.value = null;
  selected.value = null;
  await load();
}
</script>

<template>
  <div class="space-y-6">
    <section class="ds-glass rounded-panel p-5">
      <div class="mb-4 flex items-center justify-between">
        <h2 class="text-md font-semibold text-text-main">{{ t('settings.characters.title') }}</h2>
        <div class="flex gap-2">
          <Button variant="primary" @click="pickImport('pack')">{{ t('settings.characters.importPack') }}</Button>
          <Button variant="secondary" @click="pickImport('folder')">{{ t('settings.characters.importFolder') }}</Button>
        </div>
      </div>

      <!-- 卡片网格 220×320（ui-design §9.1）：双击热切换，单击详情 -->
      <div class="flex flex-wrap gap-4">
        <div
          v-for="c in cards"
          :key="c.id"
          class="relative h-[320px] w-[220px] cursor-pointer overflow-hidden rounded-card border transition ease-ds hover:-translate-y-1"
          :class="c.active ? 'border-2' : 'border-glass-border'"
          :style="c.active ? { borderColor: 'var(--ds-brand-from)' } : {}"
          @click="selected = c"
          @dblclick="activate(c.id)"
        >
          <!-- 当前角色角标 -->
          <span
            v-if="c.active"
            class="absolute left-2 top-2 z-10 flex items-center gap-1 rounded-btn px-2 py-0.5 text-xs text-white"
            :style="{
              background: 'linear-gradient(90deg, var(--ds-brand-from), var(--ds-brand-to))',
            }"
          >
            {{ t('settings.characters.currentBadge') }}
          </span>
          <!-- 立绘 200×200：preview → asset://；无 → 首字渐变占位 -->
          <img
            v-if="c.previewUrl"
            :src="c.previewUrl"
            :alt="c.name"
            class="mx-auto mt-2.5 h-[200px] w-[200px] rounded-card object-cover"
          />
          <div
            v-else
            class="mx-auto mt-2.5 flex h-[200px] w-[200px] items-center justify-center rounded-card text-5xl font-semibold text-white"
            :style="{
              background: 'linear-gradient(135deg, var(--ds-brand-from), var(--ds-brand-to))',
            }"
          >
            {{ c.name.slice(0, 1) }}
          </div>
          <!-- 元数据 -->
          <div class="px-4 py-3">
            <div class="truncate font-semibold text-text-main">{{ c.name }}</div>
            <div class="mt-1 flex items-center gap-1.5 text-xs text-text-sub">
              <span>v{{ c.version }}</span>
              <span
                class="rounded-btn border border-glass-border px-1.5 py-0.5 uppercase"
                >{{ c.engine }}</span
              >
              <span v-if="c.builtin" class="rounded-btn border border-glass-border px-1.5 py-0.5"
                >{{ t('settings.characters.builtin') }}</span
              >
            </div>
          </div>
        </div>

        <div v-if="!cards.length" class="w-full px-3 py-8 text-center text-sm text-text-sub">
          {{ t('settings.characters.empty') }}
        </div>
      </div>
    </section>

    <!-- 简化详情抽屉（E2 完整版 follow-up） -->
    <div
      v-if="selected"
      class="ds-glass fixed bottom-4 right-4 top-4 z-50 flex w-[360px] flex-col rounded-panel p-5"
    >
      <div class="mb-3 flex items-center justify-between">
        <h3 class="text-md font-semibold text-text-main">{{ selected.name }}</h3>
        <button class="text-sm text-text-sub hover:text-text-main" @click="selected = null">
          ✕
        </button>
      </div>
      <div class="min-h-0 flex-1 space-y-2 overflow-y-auto text-sm">
        <div class="flex justify-between border-b border-glass-border py-2">
          <span class="text-text-sub">ID</span>
          <span class="text-text-main">{{ selected.id }}</span>
        </div>
        <div class="flex justify-between border-b border-glass-border py-2">
          <span class="text-text-sub">{{ t('settings.characters.version') }}</span>
          <span class="text-text-main">v{{ selected.version }}</span>
        </div>
        <div class="flex justify-between border-b border-glass-border py-2">
          <span class="text-text-sub">{{ t('settings.characters.engine') }}</span>
          <span class="uppercase text-text-main">{{ selected.engine }}</span>
        </div>
        <div class="flex justify-between border-b border-glass-border py-2">
          <span class="text-text-sub">{{ t('settings.characters.source') }}</span>
          <span class="text-text-main">{{ selected.builtin ? t('settings.characters.builtin') : t('settings.characters.imported') }}</span>
        </div>
        <div class="flex justify-between border-b border-glass-border py-2">
          <span class="text-text-sub">{{ t('settings.characters.persona') }}</span>
          <span class="text-text-main">{{ selected.hasPersona ? t('settings.characters.hasPersona') : '—' }}</span>
        </div>
        <div class="flex justify-between border-b border-glass-border py-2">
          <span class="text-text-sub">{{ t('settings.characters.cues') }}</span>
          <span class="text-text-main">{{ selected.cueCount }}</span>
        </div>
        <div class="flex justify-between border-b border-glass-border py-2">
          <span class="text-text-sub">{{ t('settings.characters.vocab') }}</span>
          <span class="text-text-main">{{ selected.emotionCount }} / {{ selected.actionCount }}</span>
        </div>
      </div>
      <div class="mt-4 flex flex-col gap-2">
        <Button variant="primary" :disabled="selected.active" @click="activate(selected.id)">
          {{ selected.active ? t('settings.characters.isCurrent') : t('settings.characters.makeCurrent') }}
        </Button>
        <Button v-if="!selected.builtin" variant="danger" @click="removing = selected"
          >{{ t('settings.characters.uninstall') }}</Button
        >
      </div>
    </div>

    <!-- 导入确认对话框（两段式②前的摘要确认） -->
    <div
      v-if="confirmImport"
      class="fixed inset-0 z-[60] flex items-center justify-center"
      style="background: rgba(0, 0, 0, 0.32)"
    >
      <div class="ds-glass w-[420px] rounded-panel p-5">
        <div class="text-md text-text-main">{{ t('settings.characters.confirmImportTitle') }}</div>
        <div class="mt-3 space-y-1.5 text-sm">
          <div class="flex justify-between">
            <span class="text-text-sub">{{ t('settings.persona.name') }}</span>
            <span class="text-text-main">{{ confirmImport.summary.name }}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-text-sub">ID</span>
            <span class="text-text-main">{{ confirmImport.summary.id }}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-text-sub">{{ t('settings.characters.version') }}</span>
            <span class="text-text-main">v{{ confirmImport.summary.version }}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-text-sub">{{ t('settings.characters.engine') }}</span>
            <span class="uppercase text-text-main">{{ confirmImport.summary.engine }}</span>
          </div>
        </div>
        <div class="mt-5 flex justify-end gap-2">
          <Button variant="ghost" :disabled="importing" @click="confirmImport = null">{{ t('common.cancel') }}</Button>
          <Button variant="primary" :disabled="importing" @click="applyImport">
            {{ importing ? t('settings.characters.importing') : t('settings.characters.importLabel') }}
          </Button>
        </div>
      </div>
    </div>

    <ConfirmDialog
      :open="!!removing"
      :title="t('settings.characters.confirmRemoveTitle')"
      :detail="removing ? t('settings.characters.confirmRemoveDetail', { name: removing.name }) : ''"
      :confirm-label="t('settings.characters.uninstall')"
      @confirm="doRemove"
      @cancel="removing = null"
    />
    <ToastHost ref="toastHost" />
  </div>
</template>
