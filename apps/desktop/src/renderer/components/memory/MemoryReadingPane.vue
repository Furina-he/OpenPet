<!-- components/memory/MemoryReadingPane.vue — ㉒ 图谱阅读栏（spec §4.1 / §3.1 / §4.4）。
     标题 · 路径 · 更新于 / #标签 / 安全渲染正文（双链可点）/ 反向链接 / 被想起的痕迹 / [编辑] [重命名]；
     未建页面：一键建为人物或话题页。读页走请求代数守卫：快速连点时慢到的旧响应丢弃。 -->
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { MemoryGraph, MemoryGraphNode } from '@openpet/protocol';
import { formatIdleDuration, memoryPageKind } from '@openpet/protocol';
import Button from '../Button.vue';
import Input from '../Input.vue';
import { renderMemoryMarkdown } from '../../settings/memory-markdown.js';
import {
  backlinksOf,
  ghostPageSkeleton,
  linkResolverFor,
  stripFrontmatter,
} from '../../settings/memory-view.js';
import { createLatestRequest } from '../../settings/latest-request.js';

const props = defineProps<{ node: MemoryGraphNode; graph: MemoryGraph | null }>();
const emit = defineEmits<{
  navigate: [string];
  edit: [string];
  close: [];
  changed: [string];
}>();
const { t } = useI18n();

const body = ref('');
const error = ref('');
const renaming = ref(false);
const newTitle = ref('');
const busy = ref(false);
/** 正文里点到的未建页面名（node 本身是 ghost 时用 node.title）。 */
const ghostName = ref<string | null>(null);
const guard = createLatestRequest();

const isGhost = computed(() => props.node.kind === 'ghost');
const renamable = computed(() => {
  if (isGhost.value || props.node.readonly) return false;
  const k = memoryPageKind(props.node.id);
  return k === 'people' || k === 'topics';
});
const html = computed(() =>
  renderMemoryMarkdown(body.value, linkResolverFor(props.graph, props.node.id)),
);
const backlinks = computed(() => backlinksOf(props.graph, props.node.id));
const recallText = computed(() => {
  const r = props.node.recall;
  if (!r || r.count === 0) return t('settings.memory.graph.neverRecalled');
  const dur = formatIdleDuration(Math.max(0, Date.now() - r.lastAt));
  const rel = dur === '刚刚' ? dur : t('settings.memory.timeAgo', { dur });
  return t('settings.memory.graph.recall', { n: r.count, rel });
});

async function load(): Promise<void> {
  const n = guard.next();
  body.value = '';
  error.value = '';
  ghostName.value = null;
  renaming.value = false;
  if (isGhost.value) return;
  try {
    const r = await window.openpet.rpc('memory.readPage', { path: props.node.id });
    if (!guard.isCurrent(n)) return; // 旧响应丢弃
    body.value = r.page ? r.page.body : stripFrontmatter(r.raw);
  } catch (e) {
    if (!guard.isCurrent(n)) return;
    error.value = t('settings.memory.graph.loadFailed', {
      detail: e instanceof Error ? e.message : String(e),
    });
  }
}
watch(() => props.node.id, load, { immediate: true });

function onBodyClick(e: MouseEvent): void {
  const a = (e.target as HTMLElement | null)?.closest<HTMLAnchorElement>('a.ds-wikilink');
  if (!a) return;
  e.preventDefault();
  if (a.dataset.target) emit('navigate', a.dataset.target);
  else if (a.dataset.ghost) ghostName.value = a.dataset.ghost;
}

async function create(kind: 'people' | 'topics'): Promise<void> {
  const name = isGhost.value ? props.node.title : ghostName.value;
  if (!name) return;
  const { path, content } = ghostPageSkeleton(name, kind);
  busy.value = true;
  try {
    await window.openpet.rpc('memory.writePage', { path, content });
    ghostName.value = null;
    emit('changed', path);
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}

function startRename(): void {
  newTitle.value = props.node.title;
  renaming.value = true;
}
async function doRename(): Promise<void> {
  const title = newTitle.value.trim();
  if (!title || title === props.node.title) {
    renaming.value = false;
    return;
  }
  busy.value = true;
  try {
    const r = await window.openpet.rpc('memory.renamePage', { path: props.node.id, title });
    renaming.value = false;
    emit('changed', r.path);
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="ds-glass flex h-full min-h-0 flex-col rounded-panel p-4">
    <div class="flex items-start justify-between gap-2">
      <div class="min-w-0">
        <div class="truncate text-base font-semibold text-text-main" :title="node.title">
          {{ node.title }}
        </div>
        <div v-if="!isGhost" class="truncate text-xs text-text-sub" :title="node.id">
          {{ node.id }}
          <template v-if="node.updated">
            · {{ t('settings.memory.updated', { date: node.updated }) }}</template
          >
        </div>
      </div>
      <button
        class="ds-focus shrink-0 rounded-btn px-2 text-lg leading-none text-text-sub hover:text-text-main"
        :aria-label="t('settings.memory.graph.close')"
        @click="emit('close')"
      >
        ×
      </button>
    </div>

    <!-- 未建页面 -->
    <template v-if="isGhost">
      <p class="mt-4 text-sm text-text-sub">{{ t('settings.memory.graph.ghostTitle') }}</p>
      <div class="mt-3 flex gap-2">
        <Button variant="secondary" :disabled="busy" @click="create('people')">{{
          t('settings.memory.createPeople')
        }}</Button>
        <Button variant="secondary" :disabled="busy" @click="create('topics')">{{
          t('settings.memory.createTopic')
        }}</Button>
      </div>
    </template>

    <template v-else>
      <div v-if="node.tags.length" class="mt-2 flex flex-wrap gap-1">
        <span
          v-for="tag in node.tags"
          :key="tag"
          class="rounded-full px-2 text-xs text-text-sub"
          style="background: var(--ds-glass-border)"
          >#{{ tag }}</span
        >
      </div>
      <div v-if="node.readonly" class="mt-2 text-xs text-text-sub">
        {{ t('settings.memory.graph.readonly') }}
      </div>
      <div v-if="error" class="mt-2 text-xs" style="color: var(--ds-danger)">{{ error }}</div>
      <div
        v-if="ghostName"
        class="mt-2 flex flex-wrap items-center gap-2 border-y border-glass-border py-2 text-xs"
      >
        <span class="text-text-sub">{{ t('settings.memory.ghostHint', { name: ghostName }) }}</span>
        <Button variant="secondary" :disabled="busy" @click="create('people')">{{
          t('settings.memory.createPeople')
        }}</Button>
        <Button variant="secondary" :disabled="busy" @click="create('topics')">{{
          t('settings.memory.createTopic')
        }}</Button>
      </div>

      <!-- eslint-disable-next-line vue/no-v-html -- renderMemoryMarkdown 已转义全部 html 并白名单协议（㉒ §4.5） -->
      <div
        class="ds-prose mt-3 min-h-[72px] flex-1 overflow-y-auto text-sm text-text-main"
        @click="onBodyClick"
        v-html="html"
      />

      <div class="mt-3 border-t border-glass-border pt-2 text-xs">
        <div class="text-text-sub">
          {{ t('settings.memory.backlinks', { n: backlinks.length }) }}
        </div>
        <div v-if="backlinks.length === 0" class="py-1 text-text-sub opacity-70">
          {{ t('settings.memory.noBacklinks') }}
        </div>
        <div v-else class="mt-1 flex max-h-24 flex-col gap-0.5 overflow-y-auto">
          <button
            v-for="b in backlinks"
            :key="b.path"
            class="ds-focus truncate rounded-btn px-2 py-1 text-left transition ease-ds hover:bg-glass-border"
            :title="b.context"
            @click="emit('navigate', b.path)"
          >
            <span class="text-text-main">{{ b.title }}</span>
            <span v-if="b.context" class="ml-2 text-text-sub">{{ b.context }}</span>
          </button>
        </div>
        <div
          v-if="node.kind === 'people' || node.kind === 'topics'"
          class="mt-2 text-text-sub"
        >
          ✦ {{ recallText }}
        </div>
      </div>

      <div v-if="!node.readonly" class="mt-3 flex flex-wrap items-center gap-2">
        <template v-if="renaming">
          <Input
            v-model="newTitle"
            :placeholder="t('settings.memory.graph.renamePlaceholder')"
            @keydown.enter="doRename"
            @keydown.esc="renaming = false"
          />
          <Button variant="primary" :disabled="busy" @click="doRename">{{
            t('settings.memory.graph.renameConfirm')
          }}</Button>
        </template>
        <template v-else>
          <Button variant="secondary" @click="emit('edit', node.id)">{{
            t('settings.memory.graph.edit')
          }}</Button>
          <Button v-if="renamable" variant="secondary" @click="startRename">{{
            t('settings.memory.graph.rename')
          }}</Button>
        </template>
      </div>
    </template>
  </div>
</template>

<style scoped>
.ds-prose :deep(h2) {
  margin: 1em 0 0.4em;
  font-size: 0.95rem;
  font-weight: 600;
}
.ds-prose :deep(p),
.ds-prose :deep(ul) {
  margin: 0.3em 0;
}
.ds-prose :deep(ul) {
  padding-left: 1.2em;
  list-style: disc;
}
.ds-prose :deep(blockquote) {
  color: var(--ds-text-sub);
}
.ds-prose :deep(a) {
  color: var(--ds-brand-to);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.ds-prose :deep(a.ds-wikilink.is-ghost) {
  color: var(--ds-text-sub);
  text-decoration-style: dashed;
}
.ds-prose :deep(.ds-tag-chip) {
  display: inline-block;
  margin: 0 2px;
  padding: 0 6px;
  border-radius: 999px;
  font-size: 0.8em;
  color: var(--ds-text-sub);
  background: var(--ds-glass-border);
}
.ds-prose :deep(.ds-lock-badge) {
  font-size: 0.8em;
  opacity: 0.7;
}
</style>
