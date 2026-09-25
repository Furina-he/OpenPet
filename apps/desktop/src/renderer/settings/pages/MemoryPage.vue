<!-- settings/pages/MemoryPage.vue — Hub「记忆」页（F3）。㉒ 起双视图：
     【图谱】（默认）Obsidian 式关系图谱：工具条（搜索 / 范围 / 未建页面·提及·孤立页面开关 / 试一句）+
     canvas（MemoryGraph）+ 浮动阅读栏（MemoryReadingPane）+ 试一句结果侧栏 + 图例带计数；
     【列表】⑲ wiki 浏览器：左栏树 + 右栏 textarea 编辑 ⇄ 安全预览（双链可点 / 反向链接）+ 节锁定 + 页删除（②级）。
     工具条：立即整理 / 打开文件夹 / 清空全部（③级 DELETE）。视图与开关存 localStorage（纯 UI 状态不进 prefs）；
     纯逻辑在 memory-view / memory-graph-model / graph-* 模块；memory.changed 通知刷新树与图谱。 -->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type {
  MemoryGraph,
  MemoryProbeResult,
  MemoryStatus,
  MemoryTree,
} from '@openpet/protocol';
import { formatIdleDuration } from '@openpet/protocol';
import Button from '../../components/Button.vue';
import Input from '../../components/Input.vue';
import ConfirmDialog from '../../components/ConfirmDialog.vue';
import Select from '../../components/Select.vue';
import Switch from '../../components/Switch.vue';
import MemoryGraphCanvas from '../../components/memory/MemoryGraph.vue';
import MemoryReadingPane from '../../components/memory/MemoryReadingPane.vue';
import MemoryProbe from '../../components/memory/MemoryProbe.vue';
import MemoryProbeResultPanel from '../../components/memory/MemoryProbeResult.vue';
import {
  buildGraphView,
  DEFAULT_FILTERS,
  legendCounts,
  probeRings,
  searchHits,
  type GraphFilters,
} from '../memory-graph-model.js';
import {
  backlinksOf,
  buildGroups,
  filterGroups,
  ghostPageSkeleton,
  highlight,
  isDeletable,
  isDirty,
  linkResolverFor,
  listSections,
  stripFrontmatter,
  toggleSectionLock,
  type TreeGroup,
} from '../memory-view.js';
import { renderMemoryMarkdown } from '../memory-markdown.js';

const { t } = useI18n();
const tree = ref<MemoryTree | null>(null);
/** ㉒ 当前角色范围的图谱：预览双链解析 + 反向链接。 */
const graph = ref<MemoryGraph | null>(null);
/** ㉒ 点了未建页面的双链：待建页名。 */
const ghost = ref<string | null>(null);

// ---------- ㉒ 图谱视图状态（localStorage，键前缀 openpet.memory.）----------
const LS = 'openpet.memory.';
function lsGet<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(LS + key);
    return raw === null ? fallback : ({ ...(fallback as object), ...JSON.parse(raw) } as T);
  } catch {
    return fallback;
  }
}
function lsSet(key: string, v: unknown): void {
  try {
    window.localStorage.setItem(LS + key, JSON.stringify(v));
  } catch {
    /* 配额满：不记 */
  }
}
const ui = ref(lsGet('ui', { view: 'graph' as 'graph' | 'list', scope: 'current' as 'current' | 'all' }));
const filters = ref<GraphFilters>(lsGet('filters', DEFAULT_FILTERS));
watch(ui, (v) => lsSet('ui', v), { deep: true });
watch(filters, (v) => lsSet('filters', v), { deep: true });
const graphQuery = ref('');
const graphSelected = ref<string | null>(null);
const probeOpen = ref(false);
const probeResult = ref<MemoryProbeResult | null>(null);
const graphCanvas = ref<InstanceType<typeof MemoryGraphCanvas> | null>(null);
const PANE_W = 420;

const graphView = computed(() =>
  graph.value
    ? buildGraphView(graph.value, filters.value)
    : { nodes: [], edges: [] },
);
const hits = computed(() => searchHits(graphView.value.nodes, graphQuery.value));
const rings = computed(() =>
  probeResult.value && graph.value
    ? probeRings(graph.value.nodes, probeResult.value)
    : new Map<string, never>(),
);
const legend = computed(() => legendCounts(graphView.value.nodes));
const graphNode = computed(
  () => graph.value?.nodes.find((n) => n.id === graphSelected.value) ?? null,
);
/** 布局记忆键：本角色 id（关系页节点的 characterId）。 */
const currentCid = computed(
  () =>
    graph.value?.nodes.find((n) => n.kind === 'relationship' && !n.readonly)?.characterId ??
    'default',
);
const graphEmpty = computed(
  () => !!graph.value && !graph.value.nodes.some((n) => n.kind === 'people' || n.kind === 'topics'),
);
const scopeOptions = computed(() => [
  { value: 'current', label: t('settings.memory.graph.scopeCurrent') },
  { value: 'all', label: t('settings.memory.graph.scopeAll') },
]);
const ariaLabel = computed(() =>
  t('settings.memory.graph.aria', {
    pages: graph.value?.stats.pages ?? 0,
    links: graph.value?.stats.links ?? 0,
  }),
);
function selectGraph(id: string | null): void {
  graphSelected.value = id;
}
function searchEnter(): void {
  const first = graphView.value.nodes.find((n) => hits.value.has(n.id));
  if (first) graphSelected.value = first.id;
}
/** [编辑]：切到列表视图并打开该页（复用 ⑲ 编辑器）。 */
async function editInList(path: string): Promise<void> {
  ui.value.view = 'list';
  await open(path);
  mode.value = 'edit';
}
async function onPaneChanged(path: string): Promise<void> {
  await loadTree();
  graphSelected.value = path;
}
watch(
  () => ui.value.scope,
  () => void loadTree(),
);
const status = ref<MemoryStatus | null>(null);
const query = ref('');
const selected = ref<string | null>(null);
const original = ref('');
const draft = ref('');
const mode = ref<'edit' | 'preview'>('preview');
const busy = ref(false);
const notice = ref<{ kind: 'ok' | 'err'; text: string } | null>(null);
const confirmDelete = ref(false);
const confirmClear = ref(false);
let noticeTimer: ReturnType<typeof setTimeout> | undefined;

const groups = computed<TreeGroup[]>(() =>
  tree.value ? filterGroups(buildGroups(tree.value), query.value) : [],
);
const dirty = computed(() => isDirty(original.value, draft.value));
const sections = computed(() => listSections(draft.value));
// ㉒ 安全渲染（转义 html / 协议白名单）+ 双链可点
const previewHtml = computed(() =>
  renderMemoryMarkdown(
    stripFrontmatter(draft.value),
    linkResolverFor(graph.value, selected.value ?? ''),
  ),
);
const backlinks = computed(() => (selected.value ? backlinksOf(graph.value, selected.value) : []));
const selectedNode = computed(() => {
  if (!tree.value || !selected.value) return null;
  const all = [
    tree.value.profile,
    ...tree.value.people,
    ...tree.value.topics,
    tree.value.relationship,
    tree.value.timeline,
  ];
  return all.find((n) => n.path === selected.value) ?? null;
});

function say(kind: 'ok' | 'err', text: string): void {
  notice.value = { kind, text };
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => (notice.value = null), 4000);
}
function rel(ts: number): string {
  const dur = formatIdleDuration(Math.max(0, Date.now() - ts));
  return dur === '刚刚' ? dur : t('settings.memory.timeAgo', { dur });
}
const groupLabel = (kind: TreeGroup['kind']): string =>
  t(`settings.memory.group${kind.charAt(0).toUpperCase()}${kind.slice(1)}`);

async function loadTree(): Promise<void> {
  try {
    const [tr, st, gr] = await Promise.all([
      window.openpet.rpc('memory.tree', {}),
      window.openpet.rpc('memory.status', {}),
      window.openpet.rpc('memory.graph', { scope: ui.value.scope }),
    ]);
    tree.value = tr;
    status.value = st;
    graph.value = gr;
  } catch (e) {
    say('err', e instanceof Error ? e.message : String(e));
  }
}
async function open(path: string): Promise<void> {
  if (dirty.value && !window.confirm(t('settings.memory.unsaved'))) return;
  try {
    const r = await window.openpet.rpc('memory.readPage', { path });
    selected.value = path;
    original.value = r.raw;
    draft.value = r.raw;
    ghost.value = null;
  } catch (e) {
    say('err', e instanceof Error ? e.message : String(e));
  }
}
async function save(): Promise<void> {
  if (!selected.value || !dirty.value) return;
  busy.value = true;
  try {
    await window.openpet.rpc('memory.writePage', { path: selected.value, content: draft.value });
    const r = await window.openpet.rpc('memory.readPage', { path: selected.value });
    original.value = r.raw;
    draft.value = r.raw;
    say('ok', t('settings.memory.saved'));
    await loadTree();
  } catch (e) {
    say(
      'err',
      t('settings.memory.saveFailed', { detail: e instanceof Error ? e.message : String(e) }),
    );
  } finally {
    busy.value = false;
  }
}
function discard(): void {
  draft.value = original.value;
}
function toggleLock(name: string): void {
  draft.value = toggleSectionLock(draft.value, name);
  mode.value = 'edit';
}
async function deletePage(): Promise<void> {
  confirmDelete.value = false;
  if (!selected.value) return;
  try {
    await window.openpet.rpc('memory.deletePage', { path: selected.value });
    selected.value = null;
    original.value = draft.value = '';
    await loadTree();
  } catch (e) {
    say('err', e instanceof Error ? e.message : String(e));
  }
}
async function compileNow(): Promise<void> {
  busy.value = true;
  try {
    const r = await window.openpet.rpc('memory.compileNow', {});
    if (!r.ok) say('err', t('settings.memory.compileFailed', { detail: r.error ?? '' }));
    else if (r.ops === 0) say('ok', t('settings.memory.compiledNone'));
    else say('ok', t('settings.memory.compiledOk', { ops: r.ops }));
    await loadTree();
    if (selected.value && !dirty.value) await open(selected.value);
  } finally {
    busy.value = false;
  }
}
async function clearAll(): Promise<void> {
  confirmClear.value = false;
  await window.openpet.rpc('memory.clear', {});
  selected.value = null;
  graphSelected.value = null;
  original.value = draft.value = '';
  await loadTree();
}
const openFolder = (): void => void window.openpet.rpc('memory.openFolder', {});

/** ㉒ 预览区点击委托：双链 → 打开目标页；未建页面 → 建页提示。 */
function onPreviewClick(e: MouseEvent): void {
  const a = (e.target as HTMLElement | null)?.closest<HTMLAnchorElement>('a.ds-wikilink');
  if (!a) return;
  e.preventDefault();
  if (a.dataset.target) void open(a.dataset.target);
  else if (a.dataset.ghost) ghost.value = a.dataset.ghost;
}
async function createGhost(kind: 'people' | 'topics'): Promise<void> {
  if (!ghost.value) return;
  const { path, content } = ghostPageSkeleton(ghost.value, kind);
  try {
    await window.openpet.rpc('memory.writePage', { path, content });
    ghost.value = null;
    await loadTree();
    await open(path);
  } catch (e) {
    say('err', e instanceof Error ? e.message : String(e));
  }
}

let off: (() => void) | null = null;
onMounted(() => {
  void loadTree();
  off = window.openpet.on('memory.changed', () => {
    void loadTree();
    if (selected.value && !dirty.value) void open(selected.value);
  });
});
onUnmounted(() => {
  off?.();
  if (noticeTimer) clearTimeout(noticeTimer);
});
watch(selected, () => (mode.value = 'preview'));
// 列表视图选中的页，切回图谱时同步选中
watch(
  () => ui.value.view,
  (v) => {
    if (v === 'graph' && selected.value) graphSelected.value = selected.value;
  },
);
</script>

<template>
  <div class="mx-auto max-w-[1080px] space-y-4">
    <div class="flex items-end justify-between gap-4">
      <div class="min-w-0">
        <h2 class="text-md font-semibold text-text-main">{{ t('settings.memory.title') }}</h2>
        <p class="mt-1 text-sm text-text-sub">{{ t('settings.memory.desc') }}</p>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <div class="ds-glass flex rounded-btn p-0.5 text-sm" role="tablist">
          <button
            v-for="v in ['graph', 'list'] as const"
            :key="v"
            role="tab"
            :aria-selected="ui.view === v"
            class="ds-focus rounded-btn px-3 py-1.5 transition ease-ds"
            :class="ui.view === v ? 'bg-glass-border font-medium text-text-main' : 'text-text-sub'"
            @click="ui.view = v"
          >
            {{ v === 'graph' ? t('settings.memory.graph.viewGraph') : t('settings.memory.graph.viewList') }}
          </button>
        </div>
        <Button variant="secondary" :disabled="busy || !status?.enabled" @click="compileNow">
          {{ busy ? t('settings.memory.compiling') : t('settings.memory.compileNow') }}
        </Button>
        <Button variant="secondary" @click="openFolder">{{
          t('settings.memory.openFolder')
        }}</Button>
        <Button variant="secondary" :disabled="busy" @click="confirmClear = true">{{
          t('settings.memory.clearAll')
        }}</Button>
      </div>
    </div>

    <!-- 状态行 / 横幅 -->
    <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-text-sub">
      <span v-if="status">{{ t('settings.memory.pages', { n: status.pageCount }) }}</span>
      <span v-if="status?.lastCompile?.ok === false" style="color: var(--ds-danger)">
        {{ t('settings.memory.lastCompileFailed', { detail: status.lastCompile.error ?? '' }) }}
      </span>
      <span v-else-if="status?.lastCompile">{{
        t('settings.memory.lastCompile', { rel: rel(status.lastCompile.at) })
      }}</span>
      <span v-else-if="status">{{ t('settings.memory.neverCompiled') }}</span>
      <span v-if="status?.lastCompile?.merged?.length">{{
        t('settings.memory.mergedNote', { n: status.lastCompile.merged.length })
      }}</span>
      <span v-if="notice" :style="notice.kind === 'err' ? 'color: var(--ds-danger)' : ''">{{
        notice.text
      }}</span>
    </div>
    <div
      v-if="status && !status.enabled"
      class="ds-glass rounded-panel px-4 py-3 text-sm text-text-sub"
    >
      {{ t('settings.memory.disabled') }}
    </div>
    <div
      v-else-if="status?.migration"
      class="ds-glass rounded-panel px-4 py-3 text-sm text-text-sub"
    >
      {{ t('settings.memory.migratedBanner', { n: status.migration.from }) }}
    </div>
    <div
      v-else-if="status && status.legacyFacts > 0"
      class="ds-glass rounded-panel px-4 py-3 text-sm text-text-sub"
    >
      {{ t('settings.memory.legacyPending', { n: status.legacyFacts }) }}
    </div>

    <!-- ㉒ 图谱视图 -->
    <template v-if="ui.view === 'graph'">
      <div
        class="ds-glass flex flex-col rounded-panel"
        style="height: max(480px, calc(100vh - 340px))"
      >
        <div class="flex flex-wrap items-center gap-3 border-b border-glass-border px-3 py-2">
          <div class="w-56">
            <Input
              v-model="graphQuery"
              :placeholder="t('settings.memory.graph.search')"
              @keydown.enter="searchEnter"
            />
          </div>
          <div class="w-36">
            <Select v-model="ui.scope" :options="scopeOptions" />
          </div>
          <label class="flex items-center gap-1.5 text-sm text-text-sub">
            <Switch v-model="filters.ghosts" />{{ t('settings.memory.graph.ghosts') }}
          </label>
          <label class="flex items-center gap-1.5 text-sm text-text-sub">
            <Switch v-model="filters.mentions" />{{ t('settings.memory.graph.mentions') }}
          </label>
          <label class="flex items-center gap-1.5 text-sm text-text-sub">
            <Switch v-model="filters.orphans" />{{ t('settings.memory.graph.orphans') }}
          </label>
          <Button
            class="ml-auto"
            :variant="probeOpen ? 'primary' : 'secondary'"
            @click="probeOpen = !probeOpen"
            >💭 {{ t('settings.memory.graph.probe') }}</Button
          >
        </div>
        <div v-if="probeOpen" class="border-b border-glass-border px-3 py-2">
          <MemoryProbe
            :enabled="!!status?.enabled"
            @result="probeResult = $event"
            @close="probeOpen = false"
          />
        </div>

        <div class="relative min-h-0 flex-1">
          <MemoryGraphCanvas
            v-if="graph"
            ref="graphCanvas"
            :view="graphView"
            :cid="currentCid"
            :selected="graphSelected"
            :hits="hits"
            :rings="rings"
            :right-inset="graphNode ? PANE_W + 16 : 0"
            :left-inset="probeResult ? 316 : 0"
            :label="ariaLabel"
            @select="selectGraph"
          />
          <!-- 空态 -->
          <div
            v-if="graphEmpty"
            class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 text-sm text-text-sub"
          >
            <span>{{ t('settings.memory.graph.empty') }}</span>
            <Button
              class="pointer-events-auto"
              variant="secondary"
              :disabled="busy || !status?.enabled"
              @click="compileNow"
              >{{ t('settings.memory.compileNow') }}</Button
            >
          </div>
          <!-- 试一句结果（左上浮层） -->
          <div
            v-if="probeResult"
            class="absolute left-3 top-3 flex max-h-[calc(100%-72px)] w-[300px] flex-col"
          >
            <MemoryProbeResultPanel :result="probeResult" @select="selectGraph" />
          </div>
          <!-- 阅读栏（右侧浮层，不挤压画布） -->
          <div
            v-if="graphNode"
            class="absolute bottom-3 right-3 top-3 max-w-[60%]"
            :style="{ width: `${PANE_W}px` }"
          >
            <MemoryReadingPane
              :node="graphNode"
              :graph="graph"
              @navigate="selectGraph"
              @edit="editInList"
              @close="selectGraph(null)"
              @changed="onPaneChanged"
            />
          </div>
          <!-- 图例 + 缩放 -->
          <div
            class="pointer-events-none absolute bottom-3 left-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-sub"
          >
            <span class="flex items-center gap-1"
              ><i
                class="inline-block h-2.5 w-2.5 rounded-full"
                style="background: linear-gradient(135deg, var(--ds-brand-from), var(--ds-brand-to))"
              />{{ t('settings.memory.graph.legendSelf') }}</span
            >
            <span class="flex items-center gap-1"
              ><i class="inline-block h-2.5 w-2.5 rounded-full" style="background: var(--ds-graph-people)" />{{
                t('settings.memory.graph.legendPeople')
              }}
              {{ legend.people }}</span
            >
            <span class="flex items-center gap-1"
              ><i class="inline-block h-2.5 w-2.5 rounded-full" style="background: var(--ds-graph-topics)" />{{
                t('settings.memory.graph.legendTopics')
              }}
              {{ legend.topics }}</span
            >
            <span class="flex items-center gap-1"
              ><i
                class="inline-block h-2.5 w-2.5 rounded-full"
                style="background: var(--ds-graph-character)"
              />{{ t('settings.memory.graph.legendCharacter') }}</span
            >
            <span v-if="filters.ghosts" class="flex items-center gap-1"
              ><i
                class="inline-block h-2.5 w-2.5 rounded-full border"
                style="border-color: var(--ds-text-sub)"
              />{{ t('settings.memory.graph.legendGhost') }} {{ legend.ghost }}</span
            >
            <span class="flex items-center gap-1" style="color: var(--ds-brand-to)"
              >✦ <span class="text-text-sub">{{ t('settings.memory.graph.legendRecall') }}</span></span
            >
            <span class="pointer-events-auto ml-2 flex gap-1">
              <button
                class="ds-glass ds-focus h-7 w-7 rounded-btn text-text-main"
                :title="t('settings.memory.graph.zoomIn')"
                :aria-label="t('settings.memory.graph.zoomIn')"
                @click="graphCanvas?.zoomBy(1.25)"
              >
                ＋
              </button>
              <button
                class="ds-glass ds-focus h-7 w-7 rounded-btn text-text-main"
                :title="t('settings.memory.graph.zoomOut')"
                :aria-label="t('settings.memory.graph.zoomOut')"
                @click="graphCanvas?.zoomBy(0.8)"
              >
                －
              </button>
              <button
                class="ds-glass ds-focus h-7 w-7 rounded-btn text-text-main"
                :title="t('settings.memory.graph.fit')"
                :aria-label="t('settings.memory.graph.fit')"
                @click="graphCanvas?.fitAll()"
              >
                ⤢
              </button>
            </span>
          </div>
        </div>
      </div>
      <p class="text-xs text-text-sub">{{ t('settings.memory.graph.obsidianHint') }}</p>
    </template>

    <div v-else class="grid grid-cols-[260px_minmax(0,1fr)] gap-4">
      <!-- 左栏树 -->
      <div class="ds-glass flex max-h-[640px] flex-col rounded-panel p-3">
        <Input v-model="query" :placeholder="t('settings.memory.searchPlaceholder')" />
        <div class="mt-2 min-h-0 flex-1 overflow-y-auto">
          <div
            v-if="tree && groups.length === 0"
            class="px-2 py-6 text-center text-sm text-text-sub"
          >
            {{ t('settings.memory.noResult') }}
          </div>
          <div v-for="g in groups" :key="g.kind" class="mb-2">
            <div class="px-2 py-1 text-xs font-medium uppercase tracking-wide text-text-sub">
              {{ groupLabel(g.kind) }}
            </div>
            <div v-if="g.nodes.length === 0" class="px-2 py-1 text-sm text-text-sub">
              {{ t('settings.memory.emptyGroup') }}
            </div>
            <button
              v-for="n in g.nodes"
              :key="n.path"
              class="ds-focus block w-full rounded-btn px-2 py-1.5 text-left transition ease-ds hover:bg-glass-border"
              :class="n.path === selected ? 'bg-glass-border' : ''"
              :title="n.path"
              @click="open(n.path)"
            >
              <div class="truncate text-base text-text-main">
                <template v-for="(seg, i) in highlight(n.title, query)" :key="i">
                  <mark
                    v-if="seg.hit"
                    class="rounded bg-transparent font-semibold text-text-main"
                    >{{ seg.text }}</mark
                  >
                  <template v-else>{{ seg.text }}</template>
                </template>
              </div>
              <div v-if="n.broken" class="truncate text-xs" style="color: var(--ds-danger)">
                {{ t('settings.memory.brokenPage') }}
              </div>
              <div v-else-if="n.summary" class="truncate text-xs text-text-sub">
                {{ n.summary }}
              </div>
            </button>
          </div>
        </div>
      </div>

      <!-- 右栏编辑器 -->
      <div class="ds-glass flex min-h-[420px] flex-col rounded-panel p-4">
        <div v-if="!selected" class="flex flex-1 items-center justify-center text-sm text-text-sub">
          {{ t('settings.memory.selectHint') }}
        </div>
        <template v-else>
          <div class="flex items-center justify-between gap-3 border-b border-glass-border pb-3">
            <div class="min-w-0">
              <div class="truncate text-base font-medium text-text-main">
                {{ selectedNode?.title ?? selected }}
              </div>
              <div class="truncate text-xs text-text-sub">
                {{ selected }}
                <template v-if="selectedNode">
                  · {{ t('settings.memory.updated', { date: selectedNode.updated }) }} ·
                  {{
                    selectedNode.source === 'user'
                      ? t('settings.memory.sourceUser')
                      : t('settings.memory.sourceLlm')
                  }}
                </template>
              </div>
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <span v-if="dirty" class="text-xs text-text-sub">{{
                t('settings.memory.unsaved')
              }}</span>
              <Button variant="secondary" @click="mode = mode === 'edit' ? 'preview' : 'edit'">
                {{ mode === 'edit' ? t('settings.memory.preview') : t('settings.memory.edit') }}
              </Button>
              <Button v-if="dirty" variant="secondary" :disabled="busy" @click="discard">{{
                t('settings.memory.discard')
              }}</Button>
              <Button variant="primary" :disabled="!dirty || busy" @click="save">{{
                t('settings.memory.save')
              }}</Button>
            </div>
          </div>

          <!-- ㉒ 反向链接 -->
          <details v-if="backlinks.length" class="border-b border-glass-border py-2 text-xs">
            <summary class="cursor-pointer text-text-sub">
              {{ t('settings.memory.backlinks', { n: backlinks.length }) }}
            </summary>
            <div class="mt-1 flex flex-col gap-0.5">
              <button
                v-for="b in backlinks"
                :key="b.path"
                class="ds-focus truncate rounded-btn px-2 py-1 text-left transition ease-ds hover:bg-glass-border"
                :title="b.context"
                @click="open(b.path)"
              >
                <span class="text-text-main">{{ b.title }}</span>
                <span v-if="b.context" class="ml-2 text-text-sub">{{ b.context }}</span>
              </button>
            </div>
          </details>
          <div
            v-if="ghost"
            class="flex flex-wrap items-center gap-2 border-b border-glass-border py-2 text-sm"
          >
            <span class="text-text-sub">{{ t('settings.memory.ghostHint', { name: ghost }) }}</span>
            <Button variant="secondary" @click="createGhost('people')">{{
              t('settings.memory.createPeople')
            }}</Button>
            <Button variant="secondary" @click="createGhost('topics')">{{
              t('settings.memory.createTopic')
            }}</Button>
          </div>

          <!-- 节锁定条 -->
          <div
            v-if="sections.length"
            class="flex flex-wrap items-center gap-1.5 py-2 text-xs"
            :title="t('settings.memory.lockedHint')"
          >
            <span class="text-text-sub">{{ t('settings.memory.sections') }}:</span>
            <button
              v-for="s in sections"
              :key="s.name"
              class="ds-focus rounded-btn border border-glass-border px-2 py-0.5 text-text-main transition ease-ds hover:bg-glass-border"
              :class="s.locked ? 'font-semibold' : 'opacity-80'"
              :title="
                s.locked
                  ? t('settings.memory.unlockSection', { name: s.name })
                  : t('settings.memory.lockSection', { name: s.name })
              "
              @click="toggleLock(s.name)"
            >
              {{ s.locked ? '🔒' : '🔓' }} {{ s.name }}
            </button>
          </div>

          <textarea
            v-if="mode === 'edit'"
            v-model="draft"
            class="ds-control mt-2 min-h-[360px] flex-1 resize-y rounded-input px-3 py-2 font-mono text-sm text-text-main"
            spellcheck="false"
          />
          <!-- eslint-disable-next-line vue/no-v-html -- renderMemoryMarkdown 已转义全部 html 并白名单协议（㉒ §4.5） -->
          <div
            v-else
            class="ds-prose mt-2 min-h-[360px] flex-1 overflow-y-auto text-base text-text-main"
            @click="onPreviewClick"
            v-html="previewHtml"
          />

          <div
            v-if="isDeletable(selected)"
            class="mt-3 flex justify-end border-t border-glass-border pt-3"
          >
            <button
              class="text-sm text-text-sub hover:text-text-main"
              @click="confirmDelete = true"
            >
              {{ t('settings.memory.deletePage') }}
            </button>
          </div>
        </template>
      </div>
    </div>

    <ConfirmDialog
      :open="confirmDelete"
      :title="t('settings.memory.confirmDeleteTitle', { title: selectedNode?.title ?? '' })"
      :detail="t('settings.memory.confirmDeleteDetail')"
      :confirm-label="t('settings.data.clearLabel')"
      @confirm="deletePage"
      @cancel="confirmDelete = false"
    />
    <ConfirmDialog
      :open="confirmClear"
      :title="t('settings.memory.confirmClearTitle')"
      :detail="t('settings.memory.confirmClearDetail')"
      :confirm-label="t('settings.data.clearLabel')"
      typed-word="DELETE"
      @confirm="clearAll"
      @cancel="confirmClear = false"
    />
  </div>
</template>

<style scoped>
.ds-prose :deep(h2) {
  margin: 1em 0 0.4em;
  font-size: 1rem;
  font-weight: 600;
}
.ds-prose :deep(h3) {
  margin: 0.8em 0 0.3em;
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
.ds-prose :deep(code) {
  font-size: 0.85em;
  opacity: 0.8;
}
.ds-prose :deep(a) {
  color: var(--ds-brand-to);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.ds-prose :deep(a.ds-wikilink) {
  text-decoration-thickness: 1px;
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
