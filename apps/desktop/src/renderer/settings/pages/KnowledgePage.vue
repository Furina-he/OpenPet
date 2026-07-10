<!-- settings/pages/KnowledgePage.vue — Hub「知识库」页（§5，照 AstrBot KB 页 + §2 glass）。
     左 = KB 卡片网格（emoji/名/计数/active/删除 + 新建）；右 = 选中 KB 的文档列表（上传 .txt/.md +
     删除）+ 检索预览（kb.search 看命中 score）。嵌入走「模型 API」默认 embedding 模型。 -->
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Kb, KbDoc, KbHit } from '@openpet/protocol';
import Button from '../../components/Button.vue';
import Input from '../../components/Input.vue';
import Switch from '../../components/Switch.vue';
import ConfirmDialog from '../../components/ConfirmDialog.vue';
import KbCard from '../../components/kb/KbCard.vue';
import AddKbDialog from '../../components/kb/AddKbDialog.vue';

const { t } = useI18n();
const kbs = ref<Kb[]>([]);
const selectedId = ref<string | null>(null);
const docs = ref<KbDoc[]>([]);
const embeddingModelLabel = ref<string | null>(null);

const dialogOpen = ref(false);
const pendingDeleteKb = ref<Kb | null>(null);
const pendingDeleteDoc = ref<KbDoc | null>(null);

const uploading = ref(false);
const error = ref('');
const importedTip = ref('');

// 检索预览
const query = ref('');
const hits = ref<KbHit[]>([]);
const searching = ref(false);

const selected = computed<Kb | null>(
  () => kbs.value.find((k) => k.id === selectedId.value) ?? null,
);

async function reload(): Promise<void> {
  const { kbs: list } = await window.openpet.rpc('kb.list', {});
  kbs.value = list;
  if (selectedId.value && !list.some((k) => k.id === selectedId.value)) selectedId.value = null;
}

async function loadEmbeddingModel(): Promise<void> {
  const [cfg, prefs] = await Promise.all([
    window.openpet.rpc('provider.getConfig', {}),
    window.openpet.rpc('app.prefs.getAll', {}),
  ]);
  const id = prefs['model.defaultEmbeddingModelId'];
  const m = id ? cfg.models.find((x) => x.id === id) : undefined;
  embeddingModelLabel.value = m ? m.model : null;
}

onMounted(async () => {
  await Promise.all([reload(), loadEmbeddingModel()]);
});

async function selectKb(id: string): Promise<void> {
  selectedId.value = id;
  query.value = '';
  hits.value = [];
  error.value = '';
  await loadDocs();
}

async function loadDocs(): Promise<void> {
  if (!selectedId.value) {
    docs.value = [];
    return;
  }
  const r = await window.openpet.rpc('kb.listDocuments', { kbId: selectedId.value });
  docs.value = r.docs;
}

async function onCreate(p: { name: string; emoji: string }): Promise<void> {
  dialogOpen.value = false;
  const { id } = await window.openpet.rpc('kb.create', { name: p.name, emoji: p.emoji });
  await reload();
  await selectKb(id);
}

async function toggleActive(kb: Kb, active: boolean): Promise<void> {
  await window.openpet.rpc('kb.update', { kb: { ...kb, active } });
  await reload();
}

async function toggleRerank(kb: Kb, rerank: boolean): Promise<void> {
  await window.openpet.rpc('kb.update', { kb: { ...kb, rerank } });
  await reload();
}

async function confirmDeleteKb(): Promise<void> {
  const kb = pendingDeleteKb.value;
  pendingDeleteKb.value = null;
  if (!kb) return;
  await window.openpet.rpc('kb.delete', { id: kb.id });
  if (selectedId.value === kb.id) selectedId.value = null;
  await reload();
}

// 批次⑥：导入统一走 Main（kb.importFile 弹系统选择框，.txt/.md/.pdf；PDF 由 unpdf 抽文本）。
async function importFile(): Promise<void> {
  if (!selectedId.value) return;
  uploading.value = true;
  error.value = '';
  importedTip.value = '';
  try {
    const r = await window.openpet.rpc('kb.importFile', { kbId: selectedId.value });
    if (!r.cancelled) {
      if (r.chunks === 0) error.value = t('settings.kb.emptyDoc');
      else importedTip.value = t('settings.kb.importedTip', { name: r.filename, n: r.chunks });
      await reload();
      await loadDocs();
    }
  } catch (err) {
    error.value = t('settings.kb.importFailed', { detail: err instanceof Error ? err.message : String(err) });
  } finally {
    uploading.value = false;
  }
}

async function confirmDeleteDoc(): Promise<void> {
  const doc = pendingDeleteDoc.value;
  pendingDeleteDoc.value = null;
  if (!doc || !selectedId.value) return;
  await window.openpet.rpc('kb.deleteDocument', { kbId: selectedId.value, docId: doc.id });
  await reload();
  await loadDocs();
}

async function runSearch(): Promise<void> {
  if (!selectedId.value || !query.value.trim()) {
    hits.value = [];
    return;
  }
  searching.value = true;
  error.value = '';
  try {
    const r = await window.openpet.rpc('kb.search', {
      kbId: selectedId.value,
      query: query.value,
    });
    hits.value = r.hits;
  } catch (err) {
    hits.value = [];
    error.value = t('settings.kb.searchFailed', { detail: err instanceof Error ? err.message : String(err) });
  } finally {
    searching.value = false;
  }
}
</script>

<template>
  <div class="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-6">
    <!-- 左：KB 列表 + 新建 -->
    <section class="space-y-3">
      <div class="flex items-center justify-between">
        <h2 class="text-md font-semibold text-text-main">{{ t('settings.kb.title') }}</h2>
        <Button variant="primary" @click="dialogOpen = true">{{ t('settings.kb.create') }}</Button>
      </div>

      <div
        v-if="!kbs.length"
        class="ds-glass rounded-panel px-3 py-8 text-center text-sm text-text-sub"
      >
        {{ t('settings.kb.empty') }}
      </div>

      <div class="space-y-2">
        <KbCard
          v-for="kb in kbs"
          :key="kb.id"
          :kb="kb"
          :selected="kb.id === selectedId"
          @select="selectKb(kb.id)"
          @toggle="(v) => toggleActive(kb, v)"
          @delete="pendingDeleteKb = kb"
        />
      </div>
    </section>

    <!-- 右：选中 KB 的文档 + 检索预览 -->
    <section class="space-y-4">
      <div
        v-if="!selected"
        class="ds-glass rounded-panel px-3 py-10 text-center text-sm text-text-sub"
      >
        {{ t('settings.kb.pickOne') }}
      </div>

      <template v-else>
        <div
          v-if="error"
          class="rounded-card px-3 py-2 text-sm"
          style="color: var(--ds-danger); background: var(--ds-warm-soft)"
        >
          {{ error }}
        </div>

        <!-- 文档列表 + 上传 -->
        <div class="ds-glass rounded-panel p-5">
          <div class="mb-3 flex items-center justify-between">
            <h3 class="font-semibold text-text-main">
              {{ selected.emoji }} {{ selected.name }} · {{ t('settings.kb.docs') }}
            </h3>
            <Button variant="secondary" :disabled="uploading" @click="importFile">
              {{ uploading ? t('settings.kb.processing') : t('settings.kb.importFile') }}
            </Button>
          </div>

          <div v-if="importedTip" class="mb-2 text-sm" style="color: var(--ds-brand-to)">
            {{ importedTip }}
          </div>

          <div v-if="!docs.length" class="px-2 py-6 text-center text-sm text-text-sub">
            {{ t('settings.kb.noDocs') }}
          </div>
          <div
            v-for="d in docs"
            :key="d.id"
            class="flex items-center gap-3 border-b border-glass-border py-2 last:border-0"
          >
            <div class="min-w-0 flex-1">
              <div class="truncate font-medium text-text-main">{{ d.filename }}</div>
              <div class="text-sm text-text-sub">{{ t('settings.kb.chunks', { n: d.chunkCount }) }}</div>
            </div>
            <button
              class="text-sm text-text-sub hover:text-text-main"
              @click="pendingDeleteDoc = d"
            >
              {{ t('common.delete') }}
            </button>
          </div>

          <!-- 批次⑥：检索后 rerank 重排（需在「模型 API」配 rerank 能力模型并设默认）。 -->
          <div class="mt-3 flex items-center justify-between border-t border-glass-border pt-3">
            <div>
              <div class="text-sm font-medium text-text-main">{{ t('settings.kb.rerank') }}</div>
              <div class="text-sm text-text-sub">
                {{ t('settings.kb.rerankDesc') }}
              </div>
            </div>
            <Switch
              :model-value="selected.rerank"
              @update:model-value="(v) => selected && toggleRerank(selected, v)"
            />
          </div>
        </div>

        <!-- 检索预览 -->
        <div class="ds-glass rounded-panel p-5">
          <h3 class="mb-3 font-semibold text-text-main">{{ t('settings.kb.searchPreview') }}</h3>
          <div class="flex gap-2">
            <div class="flex-1">
              <Input
                v-model="query"
                :placeholder="t('settings.kb.searchPlaceholder')"
                @keyup.enter="runSearch"
              />
            </div>
            <Button variant="secondary" :disabled="searching" @click="runSearch">
              {{ searching ? t('settings.kb.searching') : t('settings.kb.search') }}
            </Button>
          </div>

          <div v-if="hits.length" class="mt-3 space-y-2">
            <div
              v-for="(h, i) in hits"
              :key="i"
              class="rounded-card border border-glass-border p-3"
            >
              <div class="mb-1 text-sm text-text-sub">{{ t('settings.kb.similarity') }} {{ h.score.toFixed(3) }}</div>
              <div class="text-sm text-text-main">{{ h.text }}</div>
            </div>
          </div>
          <div v-else-if="query && !searching" class="mt-3 text-sm text-text-sub">{{ t('settings.kb.noHits') }}</div>
        </div>
      </template>
    </section>

    <AddKbDialog
      :open="dialogOpen"
      :embedding-model-label="embeddingModelLabel"
      @create="onCreate"
      @cancel="dialogOpen = false"
    />
    <ConfirmDialog
      :open="!!pendingDeleteKb"
      :title="t('settings.kb.confirmDeleteKbTitle')"
      :detail="pendingDeleteKb ? t('settings.kb.confirmDeleteKbDetail', { name: pendingDeleteKb.name }) : ''"
      :confirm-label="t('common.delete')"
      @confirm="confirmDeleteKb"
      @cancel="pendingDeleteKb = null"
    />
    <ConfirmDialog
      :open="!!pendingDeleteDoc"
      :title="t('settings.kb.confirmDeleteDocTitle')"
      :detail="pendingDeleteDoc ? t('settings.kb.confirmDeleteDocDetail', { name: pendingDeleteDoc.filename }) : ''"
      :confirm-label="t('common.delete')"
      @confirm="confirmDeleteDoc"
      @cancel="pendingDeleteDoc = null"
    />
  </div>
</template>
