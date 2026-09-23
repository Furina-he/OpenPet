<!-- settings/pages/CharacterLibraryPage.vue — Hub「角色库」页（批次④ E1 + ⑩.7 E2 完整详情抽屉，
     照 UI/dc6e09f4 E1 区 + UI/3c9a77c6 E2 区）。卡片网格 220×320（当前角色 ● 暖色描边）；
     双击热切换；单击 E2 详情抽屉 560px（ModelShowcase 预览 + 动作试播 + ⋮ 菜单 + 信息区）；
     右键资源管理菜单；顶栏两段式导入。
     ⑯ 起加「我的角色 / 市场」双 tab（照插件页形态）：市场 = 静态索引浏览 + sha256 校验下载
     + 安装确认弹窗（灵魂包选形象来源 / ref 型外链自备）+ 市场源 CRUD。 -->
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { MoreVertical, X } from 'lucide-vue-next';
import { DEFAULT_ACTIONS, DEFAULT_MARKET_SOURCES, type MarketItem } from '@openpet/protocol';
import Button from '../../components/Button.vue';
import Input from '../../components/Input.vue';
import ConfirmDialog from '../../components/ConfirmDialog.vue';
import ToastHost from '../../components/ToastHost.vue';
import ModelShowcase from '../components/ModelShowcase.vue';
import SpriteThumb from '../components/SpriteThumb.vue';
import { engineLabel } from '../engine-label.js';
import { tryResolveSprite } from '../sprite-thumb.js';
import {
  toCardVm,
  sortCards,
  formatBytes,
  personaSourceOf,
  drawerMenuItems,
  cardContextMenuItems,
  withoutEmotionOverrides,
  type CharacterListItem,
  type CharacterCardVm,
  type CharacterMenuItem,
  type PersonaAllLike,
} from '../character-library-view.js';
import {
  addSource,
  filterMarketCards,
  formatMarketSize,
  isValidSourceUrl,
  toMarketCard,
  type MarketCardVm,
} from '../market-view.js';
import {
  bodiesAsInstalled,
  isCrossEngine,
  swapTargets,
  toBodyCard,
  type BodyCardVm,
  type InstalledBodyLike,
} from '../body-view.js';

const { t } = useI18n();
const emit = defineEmits<{ edit: [id: string] }>();

const items = ref<CharacterListItem[]>([]);
const personaAll = ref<PersonaAllLike>({ personas: [], defaultId: '', bindings: {} });
const selected = ref<CharacterCardVm | null>(null); // 单击 → E2 详情抽屉
const importing = ref(false);
const confirmImport = ref<{
  path: string;
  summary: { id: string; name: string; version: string; engine: string };
} | null>(null);
const removing = ref<CharacterCardVm | null>(null); // ConfirmDialog（②级）
const resetting = ref<CharacterCardVm | null>(null); // 重置情绪映射（②级）
const kebabOpen = ref(false);
const ctxMenu = ref<{ x: number; y: number; card: CharacterCardVm } | null>(null);
const renaming = ref(false);
const renameText = ref('');
const showcase = ref<InstanceType<typeof ModelShowcase> | null>(null);
const toastHost = ref<InstanceType<typeof ToastHost> | null>(null);
const toast = (text: string): void => toastHost.value?.show('float', text);
const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const cards = computed(() => sortCards(items.value.map(toCardVm)));
const selectedItem = computed(
  () => items.value.find((x) => x.characterId === selected.value?.id) ?? null,
);
const personaSource = computed(() =>
  selectedItem.value
    ? personaSourceOf(selectedItem.value.characterId, selectedItem.value.manifest, personaAll.value)
    : 'builtin',
);
// 动作试播 chip：Idle + 词表前 2 个（缺省 wave/nod）；⑳ sprite = 映射到行的动作（LLM 词表内的优先于系统 cue 词）
const previewActions = computed(() => {
  const m = selectedItem.value?.manifest;
  const sprite = m?.engine === 'sprite' ? tryResolveSprite(m.sprite) : null;
  const rank = (a: string): number => (DEFAULT_ACTIONS.includes(a) ? 0 : 1);
  const acts = sprite
    ? Object.keys(sprite.actions).sort((a, b) => rank(a) - rank(b))
    : (m?.actions ?? ['wave', 'nod']);
  return acts.slice(0, 2);
});
const engineText = (engine: string): string => engineLabel(engine, t);

async function load(): Promise<void> {
  const [r, p] = await Promise.all([
    window.openpet.rpc('character.list', {}),
    window.openpet.rpc('persona.getAll', {}),
  ]);
  items.value = r.characters;
  personaAll.value = p;
  if (selected.value) selected.value = cards.value.find((c) => c.id === selected.value?.id) ?? null;
}
onMounted(load);
onMounted(async () => {
  // ⑯「需要升级」判定用（minAppVersion 高于本机版本则灰掉安装）。
  try {
    appVersion.value = (await window.openpet.rpc('app.version', {})).version;
  } catch {
    appVersion.value = '';
  }
});

function openDrawer(c: CharacterCardVm): void {
  selected.value = c;
  kebabOpen.value = false;
  renaming.value = false;
}

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
    toast(t('settings.characters.importFailed', { detail: errText(e) }));
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

// --- ⑩.7 E2 操作 ---
async function duplicate(card: CharacterCardVm): Promise<void> {
  try {
    const { newId } = await window.openpet.rpc('character.duplicate', { id: card.id });
    toast(t('settings.characters.duplicated', { id: newId }));
    await load();
  } catch (e) {
    toast(t('settings.characters.opFailed', { detail: errText(e) }));
  }
}
async function exportPack(card: CharacterCardVm): Promise<void> {
  try {
    const r = await window.openpet.rpc('character.export', { id: card.id });
    if (!r.canceled) toast(t('settings.characters.exported', { path: r.path }));
  } catch (e) {
    toast(t('settings.characters.opFailed', { detail: errText(e) }));
  }
}
function reveal(card: CharacterCardVm): void {
  void window.openpet.rpc('character.revealInFolder', { id: card.id });
}
/** 编辑：内置 → 先复制再进编辑器（复制后编辑）；userData → 直接进。 */
async function edit(card: CharacterCardVm): Promise<void> {
  if (!card.builtin) {
    emit('edit', card.id);
    return;
  }
  try {
    const { newId } = await window.openpet.rpc('character.duplicate', { id: card.id });
    await load();
    emit('edit', newId);
  } catch (e) {
    toast(t('settings.characters.opFailed', { detail: errText(e) }));
  }
}
function startRename(card: CharacterCardVm): void {
  renaming.value = true;
  renameText.value = card.name;
}
async function applyRename(): Promise<void> {
  const item = selectedItem.value;
  const name = renameText.value.trim();
  if (!item || !name || name === item.manifest.name) {
    renaming.value = false;
    return;
  }
  try {
    await window.openpet.rpc('character.updateManifest', {
      id: item.characterId,
      manifest: { ...item.manifest, name },
    });
    renaming.value = false;
    await load();
  } catch (e) {
    toast(t('settings.characters.opFailed', { detail: errText(e) }));
  }
}
async function doResetEmotions(): Promise<void> {
  const item = items.value.find((x) => x.characterId === resetting.value?.id);
  resetting.value = null;
  if (!item) return;
  try {
    await window.openpet.rpc('character.updateManifest', {
      id: item.characterId,
      manifest: withoutEmotionOverrides(item.manifest),
    });
    toast(t('settings.characters.emotionsReset'));
    await load();
  } catch (e) {
    toast(t('settings.characters.opFailed', { detail: errText(e) }));
  }
}

// --- ⑯ 市场 tab / ⑰ 形象 tab ---
type Tab = 'mine' | 'bodies' | 'market';
const tab = ref<Tab>('mine');
const appVersion = ref('');
const marketLoading = ref(false);
const marketLoaded = ref(false);
const marketItems = ref<MarketItem[]>([]);
const marketSources = ref<Array<{ url: string; ok: boolean; count: number; error?: string }>>([]);
const marketDropped = ref(0);
const marketQuery = ref('');
const marketType = ref<'all' | 'soul' | 'full' | 'ref' | 'body'>('all');
const sourceErrorDetail = ref<{ url: string; error: string } | null>(null);
const showSources = ref(false);
const sources = ref<string[]>([]);
const newSource = ref('');
/** 下载完成待确认安装（market.download 结果 + 商品条目）。 */
const pendingMarket = ref<{
  item: MarketItem;
  path: string;
  kind: 'pack' | 'soul' | 'body';
  summary: {
    id: string;
    name: string;
    version: string;
    engine?: string;
    author?: string;
    license?: string;
    greetingCount?: number;
    lorebookCount?: number;
  };
} | null>(null);
const marketDonor = ref('default');
const marketBusy = ref(false);
/** 「可更新」二次确认（ui-design §2.8 二级：将替换该角色，自定义修改会丢失）。 */
const updating = ref<MarketCardVm | null>(null);

const marketCards = computed(() =>
  filterMarketCards(
    marketItems.value.map((m) =>
      toMarketCard(m, items.value, appVersion.value, bodiesAsInstalled(bodies.value)),
    ),
    { query: marketQuery.value, type: marketType.value },
  ),
);
const failedSources = computed(() => marketSources.value.filter((s) => !s.ok));

async function loadSources(): Promise<void> {
  const p = await window.openpet.rpc('app.prefs.getAll', {});
  sources.value = p['market.sources'];
}
async function saveSources(next: string[]): Promise<void> {
  sources.value = next;
  await window.openpet.rpc('app.prefs.set', { key: 'market.sources', value: next });
}
async function addMarketSource(): Promise<void> {
  const url = newSource.value.trim();
  if (!isValidSourceUrl(url)) {
    toast(t('settings.characters.market.sourceInvalid'));
    return;
  }
  newSource.value = '';
  await saveSources(addSource(sources.value, url));
  await refreshMarket();
}
async function restoreDefaultSources(): Promise<void> {
  await saveSources([...DEFAULT_MARKET_SOURCES]);
  await refreshMarket();
}

async function refreshMarket(): Promise<void> {
  marketLoading.value = true;
  try {
    const r = await window.openpet.rpc('market.fetchIndex', {});
    marketItems.value = r.items;
    marketSources.value = r.sources;
    marketDropped.value = r.dropped;
    marketLoaded.value = true;
  } catch (e) {
    marketSources.value = [];
    toast(t('settings.characters.market.fetchFailed', { detail: errText(e) }));
  } finally {
    marketLoading.value = false;
  }
}

/** 打开市场 tab 时拉一次（v1 = 不后台轮询，spec §6）。 */
async function switchTab(next: Tab): Promise<void> {
  tab.value = next;
  if (next === 'market') {
    if (!sources.value.length) await loadSources();
    if (!marketLoaded.value) await refreshMarket();
  }
}

/** 下载（sha256 校验在 Main）→ 弹安装确认；ref 型形象须自备，同样走 donor 下拉。 */
async function download(card: MarketCardVm): Promise<void> {
  marketBusy.value = true;
  try {
    const r = await window.openpet.rpc('market.download', {
      url: card.item.downloadUrl,
      sha256: card.item.sha256,
      type: card.item.type,
    });
    marketDonor.value = items.value.some((x) => x.characterId === 'default')
      ? 'default'
      : (items.value[0]?.characterId ?? 'default');
    pendingMarket.value = { item: card.item, path: r.path, kind: r.kind, summary: r.summary };
  } catch (e) {
    toast(t('settings.characters.market.downloadFailed', { detail: errText(e) }));
  } finally {
    marketBusy.value = false;
  }
}

async function applyMarketInstall(): Promise<void> {
  const pending = pendingMarket.value;
  if (!pending) return;
  marketBusy.value = true;
  try {
    if (pending.kind === 'pack') {
      await window.openpet.rpc('character.importApply', { path: pending.path });
    } else if (pending.kind === 'body') {
      // ⑰ 肉体包装进形象库（不进角色列表，见「形象」tab）。
      await window.openpet.rpc('character.importBodyApply', { path: pending.path });
      await loadBodies();
    } else {
      await window.openpet.rpc('character.importSoulApply', {
        path: pending.path,
        donorId: marketDonor.value,
      });
    }
    toast(t('settings.characters.importedToast', { name: pending.summary.name }));
    pendingMarket.value = null;
    await load();
  } catch (e) {
    toast(t('settings.characters.importFailed', { detail: errText(e) }));
  } finally {
    marketBusy.value = false;
  }
}

/** 更新 = 先卸载旧版再装新版（v1 不做原地升级，spec §3）。 */
async function doUpdate(): Promise<void> {
  const card = updating.value;
  updating.value = null;
  if (!card) return;
  marketBusy.value = true;
  try {
    await window.openpet.rpc('character.remove', { id: card.item.id });
    await load();
  } catch (e) {
    toast(t('settings.characters.opFailed', { detail: errText(e) }));
    marketBusy.value = false;
    return;
  }
  marketBusy.value = false;
  await download(card);
}

function openModelSource(url: string): void {
  void window.openpet.rpc('app.openExternal', { url });
}

/** 源 chip 只显示 host（长 URL 塞不下）；畸形 URL 原样兜底。 */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

// --- ⑰ 形象库（.dsbody）+ 换形象 ---
const bodies = ref<InstalledBodyLike[]>([]);
const bodyCards = computed(() => bodies.value.map(toBodyCard));
const bodyImport = ref<{
  path: string;
  summary: { id: string; name: string; version: string; engine: string };
} | null>(null);
const removingBody = ref<BodyCardVm | null>(null);
/** 换形象弹窗（从形象卡片进 = 预选形象；从 E2 抽屉进 = 预选角色）。 */
const swapping = ref<{ bodyId: string; targetId: string } | null>(null);
const swapBusy = ref(false);

const targets = computed(() => swapTargets(items.value));
const swapTargetItem = computed(
  () => items.value.find((x) => x.characterId === swapping.value?.targetId) ?? null,
);
const swapBodyCard = computed(
  () => bodyCards.value.find((b) => b.id === swapping.value?.bodyId) ?? null,
);
const swapCrossEngine = computed(() => isCrossEngine(swapTargetItem.value, swapBodyCard.value));

async function loadBodies(): Promise<void> {
  bodies.value = (await window.openpet.rpc('body.list', {})).bodies;
}
onMounted(loadBodies);

async function pickBodyImport(): Promise<void> {
  try {
    const r = await window.openpet.rpc('body.importPick', {});
    if (!r.cancelled) bodyImport.value = { path: r.path, summary: r.summary };
  } catch (e) {
    toast(t('settings.characters.importFailed', { detail: errText(e) }));
  }
}
async function applyBodyImport(): Promise<void> {
  if (!bodyImport.value) return;
  importing.value = true;
  try {
    await window.openpet.rpc('character.importBodyApply', { path: bodyImport.value.path });
    toast(t('settings.characters.bodies.importedToast', { name: bodyImport.value.summary.name }));
    bodyImport.value = null;
    await loadBodies();
  } catch (e) {
    toast(t('settings.characters.importFailed', { detail: errText(e) }));
  } finally {
    importing.value = false;
  }
}
async function doRemoveBody(): Promise<void> {
  const card = removingBody.value;
  removingBody.value = null;
  if (!card) return;
  try {
    await window.openpet.rpc('body.remove', { id: card.id });
    await loadBodies();
  } catch (e) {
    toast(t('settings.characters.opFailed', { detail: errText(e) }));
  }
}

/** 打开换形象弹窗：缺的那一半取列表首项（两个下拉都可改）。 */
function openSwap(opts: { bodyId?: string; targetId?: string }): void {
  swapping.value = {
    bodyId: opts.bodyId ?? bodyCards.value[0]?.id ?? '',
    targetId: opts.targetId ?? targets.value[0]?.id ?? '',
  };
}
async function applySwap(): Promise<void> {
  const s = swapping.value;
  if (!s || !s.bodyId || !s.targetId) return;
  const name = swapBodyCard.value?.name ?? s.bodyId;
  swapBusy.value = true;
  try {
    await window.openpet.rpc('character.swapBody', { characterId: s.targetId, bodyId: s.bodyId });
    toast(t('settings.characters.swap.done', { name }));
    swapping.value = null;
    await load();
  } catch (e) {
    toast(t('settings.characters.swap.failed', { detail: errText(e) }));
  } finally {
    swapBusy.value = false;
  }
}

function onMenu(key: CharacterMenuItem['key'], card: CharacterCardVm): void {  kebabOpen.value = false;
  ctxMenu.value = null;
  if (key === 'activate') void activate(card.id);
  else if (key === 'edit') void edit(card);
  else if (key === 'duplicate') void duplicate(card);
  else if (key === 'export') void exportPack(card);
  else if (key === 'rename') startRename(card);
  else if (key === 'resetEmotions') resetting.value = card;
  else if (key === 'reveal') reveal(card);
  else if (key === 'remove') removing.value = card;
}
function openCtxMenu(e: MouseEvent, card: CharacterCardVm): void {
  ctxMenu.value = { x: Math.min(e.clientX, window.innerWidth - 200), y: Math.min(e.clientY, window.innerHeight - 240), card };
}
const menuLabel = (key: CharacterMenuItem['key'], card: { builtin: boolean }): string =>
  key === 'edit' && card.builtin
    ? t('settings.characters.menu.editAsCopy')
    : t(`settings.characters.menu.${key}`);
</script>

<template>
  <div class="space-y-6">
    <!-- ⑯ 双 tab + ⑰ 形象 tab：我的角色 / 形象 / 市场（形态照插件页） -->
    <div class="flex gap-2">
      <button
        v-for="k in (['mine', 'bodies', 'market'] as const)"
        :key="k"
        class="rounded-full px-4 py-1.5 text-sm transition ease-ds"
        :class="tab === k ? 'text-white' : 'text-text-sub hover:text-text-main'"
        :style="
          tab === k
            ? 'background: linear-gradient(90deg, var(--ds-brand-from), var(--ds-brand-to))'
            : 'border: 1px solid var(--ds-glass-border)'
        "
        @click="switchTab(k)"
      >
        {{ t(`settings.characters.tab.${k}`) }}
      </button>
    </div>

    <section v-if="tab === 'mine'" class="ds-glass rounded-panel p-5">
      <div class="mb-4 flex items-center justify-between">
        <h2 class="text-md font-semibold text-text-main">{{ t('settings.characters.title') }}</h2>
        <div class="flex gap-2">
          <Button variant="primary" @click="pickImport('pack')">{{ t('settings.characters.importPack') }}</Button>
          <Button variant="secondary" @click="pickImport('folder')">{{ t('settings.characters.importFolder') }}</Button>
        </div>
      </div>

      <!-- 卡片网格 220×320（ui-design §9.1）：双击热切换，单击详情，右键资源管理菜单 -->
      <div class="flex flex-wrap gap-4">
        <div
          v-for="c in cards"
          :key="c.id"
          class="relative h-[320px] w-[220px] cursor-pointer overflow-hidden rounded-card border transition ease-ds hover:-translate-y-1"
          :class="c.active ? 'border-2' : 'border-glass-border'"
          :style="c.active ? { borderColor: 'var(--ds-brand-from)' } : {}"
          @click="openDrawer(c)"
          @dblclick="activate(c.id)"
          @contextmenu.prevent="openCtxMenu($event, c)"
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
          <!-- ⑳ 无立绘的帧动画角色：CSS 帧预览（悬停播 idle） -->
          <SpriteThumb
            v-else-if="c.sprite"
            :source="c.sprite"
            :width="200"
            :height="200"
            class="mx-auto mt-2.5 rounded-card bg-white/20"
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
              <span class="rounded-btn border border-glass-border px-1.5 py-0.5">{{
                engineText(c.engine)
              }}</span>
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

    <!-- ⑰ 形象 tab：已装肉体包网格（换形象 / 删除 / 导入本地 .dsbody） -->
    <section v-if="tab === 'bodies'" class="ds-glass rounded-panel p-5">
      <div class="mb-4 flex items-center justify-between">
        <div>
          <h2 class="text-md font-semibold text-text-main">
            {{ t('settings.characters.bodies.title') }}
          </h2>
          <p class="mt-1 text-xs text-text-sub">{{ t('settings.characters.bodies.hint') }}</p>
        </div>
        <div class="flex gap-2">
          <Button variant="primary" @click="pickBodyImport">
            {{ t('settings.characters.bodies.import') }}
          </Button>
          <Button variant="secondary" @click="switchTab('market')">
            {{ t('settings.characters.bodies.goMarket') }}
          </Button>
        </div>
      </div>

      <div class="flex flex-wrap gap-4">
        <div
          v-for="b in bodyCards"
          :key="b.id"
          class="relative flex h-[320px] w-[220px] flex-col overflow-hidden rounded-card border border-glass-border"
        >
          <span
            class="absolute left-2 top-2 z-10 rounded-btn border border-glass-border bg-white/60 px-1.5 py-0.5 text-xs text-text-sub"
          >
            {{ engineText(b.engine) }}
          </span>
          <img
            v-if="b.previewUrl"
            :src="b.previewUrl"
            :alt="b.name"
            class="mx-auto mt-2.5 h-[160px] w-[200px] rounded-card object-cover"
          />
          <SpriteThumb
            v-else-if="b.sprite"
            :source="b.sprite"
            :width="200"
            :height="160"
            class="mx-auto mt-2.5 rounded-card bg-white/20"
          />
          <div
            v-else
            class="mx-auto mt-2.5 flex h-[160px] w-[200px] items-center justify-center rounded-card text-5xl font-semibold text-white"
            :style="{
              background: 'linear-gradient(135deg, var(--ds-brand-from), var(--ds-brand-to))',
            }"
          >
            {{ b.name.slice(0, 1) }}
          </div>
          <div class="flex min-h-0 flex-1 flex-col px-3 py-2">
            <div class="truncate font-semibold text-text-main">{{ b.name }}</div>
            <div class="mt-0.5 truncate text-xs text-text-sub">
              v{{ b.version }} · {{ formatBytes(b.sizeBytes) }}
            </div>
            <div class="mt-1 min-h-0 flex-1 truncate text-[11px] text-text-sub">
              {{ b.license ?? '—' }}
            </div>
            <div class="mt-1 flex gap-2">
              <Button class="flex-1" variant="primary" @click="openSwap({ bodyId: b.id })">
                {{ t('settings.characters.bodies.applyTo') }}
              </Button>
              <Button variant="ghost" @click="removingBody = b">{{ t('common.delete') }}</Button>
            </div>
          </div>
        </div>

        <div v-if="!bodyCards.length" class="w-full px-3 py-8 text-center text-sm text-text-sub">
          {{ t('settings.characters.bodies.empty') }}
        </div>
      </div>
    </section>

    <!-- ⑯ 市场 tab：静态索引浏览 + 搜索/类型过滤 + 源状态 chip + 安装 -->
    <template v-if="tab === 'market'">
      <section class="ds-glass rounded-panel p-5">
        <div class="mb-4 flex flex-wrap items-center gap-2">
          <h2 class="text-md mr-auto font-semibold text-text-main">
            {{ t('settings.characters.market.title') }}
          </h2>
          <Input
            v-model="marketQuery"
            class="w-[220px]"
            :placeholder="t('settings.characters.market.searchPlaceholder')"
          />
          <select
            v-model="marketType"
            class="ds-control h-9 rounded-input px-2 text-sm text-text-main"
          >
            <option v-for="k in (['all', 'soul', 'full', 'body', 'ref'] as const)" :key="k" :value="k">
              {{ t(`settings.characters.market.types.${k}`) }}
            </option>
          </select>
          <Button variant="secondary" :disabled="marketLoading" @click="refreshMarket">
            {{ marketLoading ? t('settings.characters.market.loading') : t('common.refresh') }}
          </Button>
          <Button variant="ghost" @click="showSources = !showSources">
            {{ t('settings.characters.market.manageSources') }}
          </Button>
        </div>

        <!-- 源状态 chip（失败源可展开错误详情，照连接页错误详情弹窗） -->
        <div v-if="marketSources.length" class="mb-3 flex flex-wrap items-center gap-2">
          <button
            v-for="s in marketSources"
            :key="s.url"
            class="rounded-full border border-glass-border px-2.5 py-0.5 text-xs"
            :style="s.ok ? {} : { color: 'var(--ds-danger)' }"
            :disabled="s.ok"
            @click="sourceErrorDetail = { url: s.url, error: s.error ?? '' }"
          >
            {{ s.ok ? '●' : '⚠' }} {{ hostOf(s.url) }}
            <span class="text-text-sub">{{
              s.ok
                ? t('settings.characters.market.sourceCount', { n: s.count })
                : t('settings.characters.market.sourceFailed')
            }}</span>
          </button>
          <span v-if="marketDropped > 0" class="text-xs text-text-sub">
            {{ t('settings.characters.market.droppedHint', { n: marketDropped }) }}
          </span>
        </div>

        <!-- 市场源管理（T5：CRUD + 恢复默认） -->
        <div v-if="showSources" class="mb-4 rounded-card border border-glass-border p-3">
          <div class="mb-2 flex gap-2">
            <Input
              v-model="newSource"
              class="flex-1"
              :placeholder="t('settings.characters.market.sourcePlaceholder')"
              @keydown.enter="addMarketSource"
            />
            <Button variant="secondary" @click="addMarketSource">{{ t('common.add') }}</Button>
            <Button variant="ghost" @click="restoreDefaultSources">
              {{ t('settings.characters.market.restoreDefaults') }}
            </Button>
          </div>
          <div v-if="!sources.length" class="px-2 py-3 text-center text-sm text-text-sub">
            {{ t('settings.characters.market.noSources') }}
          </div>
          <div
            v-for="s in sources"
            :key="s"
            class="flex items-center gap-3 border-b border-glass-border py-2 last:border-0"
          >
            <span class="min-w-0 flex-1 truncate text-sm text-text-main">{{ s }}</span>
            <button
              class="text-sm text-text-sub hover:text-text-main"
              @click="saveSources(sources.filter((x) => x !== s)).then(refreshMarket)"
            >
              {{ t('common.delete') }}
            </button>
          </div>
          <p class="mt-2 text-xs text-text-sub">{{ t('settings.characters.market.sourcesHint') }}</p>
        </div>

        <div v-if="marketLoading" class="px-3 py-8 text-center text-sm text-text-sub">
          {{ t('settings.characters.market.loading') }}
        </div>
        <div v-else-if="!marketCards.length" class="px-3 py-8 text-center text-sm text-text-sub">
          {{
            failedSources.length === marketSources.length && marketSources.length
              ? t('settings.characters.market.allSourcesFailed')
              : t('settings.characters.market.empty')
          }}
        </div>

        <!-- 卡片网格（沿用 E1 220×320 尺寸） -->
        <div v-else class="flex flex-wrap gap-4">
          <div
            v-for="c in marketCards"
            :key="c.item.id"
            class="relative flex h-[320px] w-[220px] flex-col overflow-hidden rounded-card border border-glass-border"
          >
            <span
              class="absolute left-2 top-2 z-10 rounded-btn border border-glass-border bg-white/60 px-1.5 py-0.5 text-xs uppercase text-text-sub"
            >
              {{ t(`settings.characters.market.types.${c.item.type}`) }}
            </span>
            <img
              v-if="c.item.preview"
              :src="c.item.preview"
              :alt="c.item.name"
              class="mx-auto mt-2.5 h-[160px] w-[200px] rounded-card object-cover"
            />
            <div
              v-else
              class="mx-auto mt-2.5 flex h-[160px] w-[200px] items-center justify-center rounded-card text-5xl font-semibold text-white"
              :style="{
                background: 'linear-gradient(135deg, var(--ds-brand-from), var(--ds-brand-to))',
              }"
            >
              {{ c.item.name.slice(0, 1) }}
            </div>
            <div class="flex min-h-0 flex-1 flex-col px-3 py-2">
              <div class="truncate font-semibold text-text-main">{{ c.item.name }}</div>
              <div class="mt-0.5 truncate text-xs text-text-sub">
                v{{ c.item.version }} · {{ c.item.author || '—' }} ·
                {{ formatMarketSize(c.item.size) }}
              </div>
              <div class="mt-1 line-clamp-2 min-h-0 flex-1 text-xs text-text-sub">
                {{ c.item.summary }}
              </div>
              <div class="mt-1 truncate text-[11px] text-text-sub">{{ c.item.license }}</div>
              <Button
                class="mt-2"
                :variant="c.state === 'updatable' ? 'primary' : 'secondary'"
                :disabled="marketBusy || c.state === 'installed' || c.state === 'needsUpgrade'"
                @click="c.state === 'updatable' ? (updating = c) : download(c)"
              >
                {{ t(`settings.characters.market.state.${c.state}`) }}
              </Button>
            </div>
          </div>
        </div>
      </section>
    </template>
    <div v-if="ctxMenu" class="fixed inset-0 z-[70]" @click="ctxMenu = null" @contextmenu.prevent="ctxMenu = null">
      <div
        class="ds-glass absolute w-[180px] rounded-card border border-glass-border py-1 shadow-lg"
        :style="{ left: `${ctxMenu.x}px`, top: `${ctxMenu.y}px` }"
      >
        <button
          v-for="mi in cardContextMenuItems(ctxMenu.card)"
          :key="mi.key"
          class="flex w-full items-center px-3 py-2 text-left text-sm transition ease-ds"
          :class="[
            mi.disabled ? 'cursor-not-allowed text-text-sub/50' : 'hover:bg-white/40',
            mi.danger && !mi.disabled ? '' : 'text-text-main',
          ]"
          :style="mi.danger && !mi.disabled ? { color: 'var(--ds-danger)' } : {}"
          :disabled="mi.disabled"
          @click.stop="!mi.disabled && onMenu(mi.key, ctxMenu.card)"
        >
          {{ menuLabel(mi.key, ctxMenu.card) }}
        </button>
      </div>
    </div>

    <!-- ⑩.7 E2 完整详情抽屉 560px（ui-design §9.2） -->
    <div
      v-if="selected && selectedItem"
      class="ds-glass fixed bottom-4 right-4 top-4 z-50 flex w-[560px] flex-col rounded-panel p-5"
    >
      <div class="mb-3 flex items-center justify-between">
        <h3 class="text-md font-semibold text-text-main">{{ t('settings.characters.drawerTitle') }}</h3>
        <button class="ds-icon-button" :aria-label="t('common.close')" @click="selected = null">
          <X :size="16" :stroke-width="1.5" />
        </button>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto">
        <!-- 预览 320×400 + 动作试播 chip（VRM live；Live2D 降级 preview 图） -->
        <div class="mx-auto flex h-[400px] w-[320px] flex-col">
          <ModelShowcase
            ref="showcase"
            :key="selected.id"
            :character-id="selectedItem.characterId"
            :manifest="selectedItem.manifest"
            compact
          />
        </div>
        <div class="mt-2 flex justify-center gap-2">
          <button
            class="rounded-full border border-glass-border px-3 py-1 text-xs text-text-sub transition ease-ds hover:text-text-main"
            @click="showcase?.playIdle()"
          >
            Idle
          </button>
          <button
            v-for="a in previewActions"
            :key="a"
            class="rounded-full border border-glass-border px-3 py-1 text-xs text-text-sub transition ease-ds hover:text-text-main"
            @click="showcase?.playAction(a)"
          >
            {{ a }}
          </button>
        </div>

        <!-- 名称行 + 徽章；重命名 = 行内输入 -->
        <div class="mt-3">
          <div v-if="!renaming" class="flex items-center gap-2">
            <span class="text-lg font-semibold text-text-main">{{ selected.name }}</span>
            <span class="rounded-btn border border-glass-border px-1.5 py-0.5 text-xs text-text-sub">{{ engineText(selected.engine) }}</span>
            <span class="rounded-btn border border-glass-border px-1.5 py-0.5 text-xs text-text-sub">v{{ selected.version }}</span>
            <span v-if="selected.builtin" class="rounded-btn border border-glass-border px-1.5 py-0.5 text-xs text-text-sub">{{ t('settings.characters.builtin') }}</span>
          </div>
          <div v-else class="flex items-center gap-2">
            <input
              v-model="renameText"
              class="ds-control h-9 flex-1 rounded-input px-3 text-sm text-text-main"
              @keydown.enter="applyRename"
              @keydown.esc="renaming = false"
            />
            <Button variant="primary" @click="applyRename">{{ t('common.save') }}</Button>
            <Button variant="ghost" @click="renaming = false">{{ t('common.cancel') }}</Button>
          </div>
        </div>

        <!-- 主操作：[设为当前角色] [编辑] ⋮ -->
        <div class="relative mt-3 flex items-center gap-2">
          <Button class="flex-1" variant="primary" :disabled="selected.active" @click="activate(selected.id)">
            {{ selected.active ? t('settings.characters.isCurrent') : t('settings.characters.makeCurrent') }}
          </Button>
          <Button variant="secondary" @click="edit(selected)">
            {{ selected.builtin ? t('settings.characters.menu.editAsCopy') : t('settings.characters.menu.edit') }}
          </Button>
          <Button
            variant="secondary"
            :disabled="selected.builtin"
            :title="selected.builtin ? t('settings.characters.swap.noTargets') : ''"
            @click="openSwap({ targetId: selected.id })"
          >
            {{ t('settings.characters.swap.entry') }}
          </Button>
          <button
            class="ds-icon-button"
            :aria-label="t('settings.characters.moreActions')"
            @click="kebabOpen = !kebabOpen"
          >
            <MoreVertical :size="16" :stroke-width="1.5" />
          </button>
          <div
            v-if="kebabOpen"
            class="ds-glass absolute right-0 top-11 z-10 w-[180px] rounded-card border border-glass-border py-1 shadow-lg"
          >
            <button
              v-for="mi in drawerMenuItems(selected)"
              :key="mi.key"
              class="flex w-full items-center px-3 py-2 text-left text-sm transition ease-ds"
              :class="[
                mi.disabled ? 'cursor-not-allowed text-text-sub/50' : 'hover:bg-white/40',
                mi.danger && !mi.disabled ? '' : 'text-text-main',
              ]"
              :style="mi.danger && !mi.disabled ? { color: 'var(--ds-danger)' } : {}"
              :disabled="mi.disabled"
              @click="!mi.disabled && onMenu(mi.key, selected)"
            >
              {{ menuLabel(mi.key, selected) }}
            </button>
          </div>
        </div>

        <!-- 信息区：元数据 -->
        <div class="mt-4 text-sm">
          <div class="mb-1 text-xs font-medium uppercase tracking-wide text-text-sub">{{ t('settings.characters.metaSection') }}</div>
          <div class="grid grid-cols-2 gap-x-6">
            <div class="flex justify-between border-b border-glass-border py-2">
              <span class="text-text-sub">{{ t('settings.characters.author') }}</span>
              <span class="text-text-main">{{ selected.author ?? '—' }}</span>
            </div>
            <div class="flex justify-between border-b border-glass-border py-2">
              <span class="text-text-sub">{{ t('settings.characters.version') }}</span>
              <span class="text-text-main">v{{ selected.version }}</span>
            </div>
            <div class="flex justify-between border-b border-glass-border py-2">
              <span class="text-text-sub">{{ t('settings.characters.license') }}</span>
              <span class="text-text-main">{{ selected.license ?? '—' }}</span>
            </div>
            <div class="flex justify-between border-b border-glass-border py-2">
              <span class="text-text-sub">{{ t('settings.characters.size') }}</span>
              <span class="text-text-main">{{ formatBytes(selected.sizeBytes) }}</span>
            </div>
            <div class="flex justify-between border-b border-glass-border py-2">
              <span class="text-text-sub">{{ t('settings.characters.installedAt') }}</span>
              <span class="text-text-main">{{ selected.installedAt ? new Date(selected.installedAt).toLocaleDateString() : '—' }}</span>
            </div>
            <div class="flex justify-between border-b border-glass-border py-2">
              <span class="text-text-sub">{{ t('settings.characters.source') }}</span>
              <span class="text-text-main">{{ selected.builtin ? t('settings.characters.builtin') : t('settings.characters.imported') }}</span>
            </div>
          </div>
        </div>

        <!-- 信息区：绑定 -->
        <div class="mt-4 text-sm">
          <div class="mb-1 text-xs font-medium uppercase tracking-wide text-text-sub">{{ t('settings.characters.bindingSection') }}</div>
          <div class="flex justify-between border-b border-glass-border py-2">
            <span class="text-text-sub">{{ t('settings.characters.engine') }}</span>
            <span class="text-text-main">{{ engineText(selected.engine) }}</span>
          </div>
          <div class="flex justify-between border-b border-glass-border py-2">
            <span class="text-text-sub">{{ t('settings.characters.modelFile') }}</span>
            <span class="truncate pl-4 text-text-main">{{ selected.modelPath }}</span>
          </div>
          <div class="flex justify-between border-b border-glass-border py-2">
            <span class="text-text-sub">{{ t('settings.characters.voiceBinding') }}</span>
            <span class="text-text-main">{{ selected.voice ?? t('settings.characters.voiceDefault') }}</span>
          </div>
          <div class="flex justify-between border-b border-glass-border py-2">
            <span class="text-text-sub">{{ t('settings.characters.personaSource') }}</span>
            <span class="text-text-main">{{ t(`settings.characters.personaFrom.${personaSource}`) }}</span>
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

        <!-- 信息区：描述 / 标签 -->
        <div v-if="selected.description || selected.tags.length" class="mt-4 text-sm">
          <div class="mb-1 text-xs font-medium uppercase tracking-wide text-text-sub">{{ t('settings.characters.descSection') }}</div>
          <p v-if="selected.description" class="py-1 leading-relaxed text-text-main">{{ selected.description }}</p>
          <div v-if="selected.tags.length" class="mt-1 flex flex-wrap gap-1.5">
            <span
              v-for="tag in selected.tags"
              :key="tag"
              class="rounded-full border border-glass-border px-2 py-0.5 text-xs text-text-sub"
              >{{ tag }}</span
            >
          </div>
        </div>
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
            <span class="text-text-main">{{ engineText(confirmImport.summary.engine) }}</span>
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

    <!-- ⑯ 市场安装确认（license 原文必展示；soul/ref 选形象来源；ref 附模型获取指引） -->
    <div
      v-if="pendingMarket"
      class="fixed inset-0 z-[60] flex items-center justify-center"
      style="background: rgba(0, 0, 0, 0.32)"
    >
      <div class="ds-glass max-h-[86vh] w-[460px] overflow-y-auto rounded-panel p-5">
        <div class="text-md text-text-main">{{ t('settings.characters.market.confirmTitle') }}</div>
        <div class="mt-3 space-y-1.5 text-sm">
          <div class="flex justify-between">
            <span class="text-text-sub">{{ t('settings.persona.name') }}</span>
            <span class="text-text-main">{{ pendingMarket.summary.name }}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-text-sub">ID</span>
            <span class="text-text-main">{{ pendingMarket.summary.id }}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-text-sub">{{ t('settings.characters.version') }}</span>
            <span class="text-text-main">v{{ pendingMarket.summary.version }}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-text-sub">{{ t('settings.characters.author') }}</span>
            <span class="text-text-main">{{ pendingMarket.summary.author || '—' }}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-text-sub">{{ t('settings.characters.size') }}</span>
            <span class="text-text-main">{{ formatMarketSize(pendingMarket.item.size) }}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-text-sub">{{ t('settings.characters.market.typeLabel') }}</span>
            <span class="text-text-main">{{
              t(`settings.characters.market.types.${pendingMarket.item.type}`)
            }}</span>
          </div>
        </div>

        <!-- license 原文（不做翻译/概括，责任在上传者，spec §4） -->
        <div class="mt-3 rounded-card border border-glass-border p-2.5">
          <div class="text-xs font-medium uppercase tracking-wide text-text-sub">
            {{ t('settings.characters.license') }}
          </div>
          <p class="mt-1 break-words text-sm text-text-main">
            {{ pendingMarket.summary.license || pendingMarket.item.license }}
          </p>
          <p class="mt-1 text-xs text-text-sub">
            {{ t('settings.characters.market.licenseHint') }}
          </p>
        </div>

        <!-- ref 型：模型不托管，给获取指引 + 外链 -->
        <div
          v-if="pendingMarket.item.type === 'ref' && pendingMarket.item.modelSource"
          class="mt-3 rounded-card border border-glass-border p-2.5"
        >
          <div class="text-xs font-medium uppercase tracking-wide text-text-sub">
            {{ t('settings.characters.market.modelSourceTitle') }}
          </div>
          <p class="mt-1 text-sm text-text-main">{{ pendingMarket.item.modelSource.name }}</p>
          <p v-if="pendingMarket.item.modelSource.note" class="mt-1 text-xs text-text-sub">
            {{ pendingMarket.item.modelSource.note }}
          </p>
          <div class="mt-2 flex gap-2">
            <Button variant="secondary" @click="openModelSource(pendingMarket.item.modelSource.url)">
              {{ t('settings.characters.market.openModelSource') }}
            </Button>
          </div>
          <p class="mt-2 text-xs text-text-sub">{{ t('settings.characters.market.refHint') }}</p>
        </div>

        <!-- soul/ref：形象来源（donor）下拉，照 ⑫ ST 卡导入 -->
        <div v-if="pendingMarket.kind === 'soul'" class="mt-4">
          <p class="mb-1 text-sm text-text-sub">{{ t('settings.characters.donorBody') }}</p>
          <select
            v-model="marketDonor"
            class="ds-control h-9 w-full rounded-input px-2 text-sm text-text-main"
          >
            <option v-for="c in items" :key="c.characterId" :value="c.characterId">
              {{ c.manifest.name }}（{{ c.characterId }}）
            </option>
          </select>
          <p class="mt-1 text-xs text-text-sub">{{ t('settings.characters.donorBodyHint') }}</p>
        </div>

        <div class="mt-5 flex justify-end gap-2">
          <Button variant="ghost" :disabled="marketBusy" @click="pendingMarket = null">{{
            t('common.cancel')
          }}</Button>
          <Button variant="primary" :disabled="marketBusy" @click="applyMarketInstall">
            {{ marketBusy ? t('settings.characters.importing') : t('settings.characters.importLabel') }}
          </Button>
        </div>
      </div>
    </div>

    <!-- ⑰ 换形象弹窗（形象卡片 / E2 抽屉共用；灵魂·记忆·会话保留，词表随肉体变） -->
    <div
      v-if="swapping"
      class="fixed inset-0 z-[60] flex items-center justify-center"
      style="background: rgba(0, 0, 0, 0.32)"
    >
      <div class="ds-glass w-[460px] rounded-panel p-5">
        <div class="text-md text-text-main">{{ t('settings.characters.swap.title') }}</div>

        <div class="mt-4">
          <p class="mb-1 text-sm text-text-sub">{{ t('settings.characters.swap.target') }}</p>
          <select
            v-model="swapping.targetId"
            class="ds-control h-9 w-full rounded-input px-2 text-sm text-text-main"
            :disabled="!targets.length"
          >
            <option v-for="c in targets" :key="c.id" :value="c.id">
              {{ c.name }}（{{ c.id }}）
            </option>
          </select>
          <p v-if="!targets.length" class="mt-1 text-xs" :style="{ color: 'var(--ds-danger)' }">
            {{ t('settings.characters.swap.noTargets') }}
          </p>
        </div>

        <div class="mt-3">
          <p class="mb-1 text-sm text-text-sub">{{ t('settings.characters.swap.body') }}</p>
          <select
            v-model="swapping.bodyId"
            class="ds-control h-9 w-full rounded-input px-2 text-sm text-text-main"
            :disabled="!bodyCards.length"
          >
            <option v-for="b in bodyCards" :key="b.id" :value="b.id">
              {{ b.name }}（{{ engineText(b.engine) }}）
            </option>
          </select>
          <p v-if="!bodyCards.length" class="mt-1 text-xs" :style="{ color: 'var(--ds-danger)' }">
            {{ t('settings.characters.swap.noBodies') }}
          </p>
          <!-- ⑳ 所选形象预览：立绘 / 帧动画常动 -->
          <div v-if="swapBodyCard?.previewUrl || swapBodyCard?.sprite" class="mt-2 flex justify-center">
            <img
              v-if="swapBodyCard.previewUrl"
              :src="swapBodyCard.previewUrl"
              :alt="swapBodyCard.name"
              class="h-[120px] w-[120px] rounded-card object-cover"
            />
            <SpriteThumb
              v-else-if="swapBodyCard.sprite"
              :key="swapBodyCard.id"
              :source="swapBodyCard.sprite"
              :width="120"
              :height="120"
              autoplay
              class="rounded-card bg-white/20"
            />
          </div>
        </div>

        <div class="mt-3 rounded-card border border-glass-border p-2.5 text-sm">
          <p class="text-text-main">{{ t('settings.characters.swap.keepHint') }}</p>
          <p class="mt-1 text-xs text-text-sub">{{ t('settings.characters.swap.vocabHint') }}</p>
          <p v-if="swapCrossEngine" class="mt-1 text-xs text-text-sub">
            {{
              t('settings.characters.swap.crossEngineHint', {
                from: engineText(swapTargetItem?.manifest.engine ?? ''),
                to: engineText(swapBodyCard?.engine ?? ''),
              })
            }}
          </p>
        </div>

        <div class="mt-5 flex justify-end gap-2">
          <Button variant="ghost" :disabled="swapBusy" @click="swapping = null">
            {{ t('common.cancel') }}
          </Button>
          <Button
            variant="primary"
            :disabled="swapBusy || !swapping.targetId || !swapping.bodyId"
            @click="applySwap"
          >
            {{ swapBusy ? t('settings.characters.swap.busy') : t('settings.characters.swap.confirm') }}
          </Button>
        </div>
      </div>
    </div>

    <!-- ⑰ 本地 .dsbody 导入确认（两段式②前的摘要确认） -->
    <div
      v-if="bodyImport"
      class="fixed inset-0 z-[60] flex items-center justify-center"
      style="background: rgba(0, 0, 0, 0.32)"
    >
      <div class="ds-glass w-[420px] rounded-panel p-5">
        <div class="text-md text-text-main">
          {{ t('settings.characters.bodies.confirmImportTitle') }}
        </div>
        <div class="mt-3 space-y-1.5 text-sm">
          <div class="flex justify-between">
            <span class="text-text-sub">{{ t('settings.persona.name') }}</span>
            <span class="text-text-main">{{ bodyImport.summary.name }}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-text-sub">ID</span>
            <span class="text-text-main">{{ bodyImport.summary.id }}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-text-sub">{{ t('settings.characters.version') }}</span>
            <span class="text-text-main">v{{ bodyImport.summary.version }}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-text-sub">{{ t('settings.characters.engine') }}</span>
            <span class="text-text-main">{{ engineText(bodyImport.summary.engine) }}</span>
          </div>
        </div>
        <div class="mt-5 flex justify-end gap-2">
          <Button variant="ghost" :disabled="importing" @click="bodyImport = null">
            {{ t('common.cancel') }}
          </Button>
          <Button variant="primary" :disabled="importing" @click="applyBodyImport">
            {{ importing ? t('settings.characters.importing') : t('settings.characters.importLabel') }}
          </Button>
        </div>
      </div>
    </div>

    <!-- 源错误详情（照连接页错误详情弹窗） -->
    <div
      v-if="sourceErrorDetail"
      class="fixed inset-0 z-[60] flex items-center justify-center"
      style="background: rgba(0, 0, 0, 0.32)"
      @click="sourceErrorDetail = null"
    >
      <div class="ds-glass w-[460px] rounded-panel p-5" @click.stop>
        <div class="text-md text-text-main">
          {{ t('settings.characters.market.sourceErrorTitle') }}
        </div>
        <p class="mt-2 break-all text-sm text-text-sub">{{ sourceErrorDetail.url }}</p>
        <pre
          class="mt-3 max-h-[240px] overflow-auto whitespace-pre-wrap rounded-card border border-glass-border p-2.5 text-xs text-text-main"
          >{{ sourceErrorDetail.error }}</pre
        >
        <p class="mt-2 text-xs text-text-sub">{{ t('settings.characters.market.sourceErrorHint') }}</p>
        <div class="mt-4 flex justify-end">
          <Button variant="secondary" @click="sourceErrorDetail = null">{{
            t('common.close')
          }}</Button>
        </div>
      </div>
    </div>

    <ConfirmDialog
      :open="!!updating"
      :title="t('settings.characters.market.confirmUpdateTitle')"
      :detail="
        updating
          ? t('settings.characters.market.confirmUpdateDetail', {
              name: updating.item.name,
              from: updating.localVersion ?? '',
              to: updating.item.version,
            })
          : ''
      "
      :confirm-label="t('settings.characters.market.updateLabel')"
      @confirm="doUpdate"
      @cancel="updating = null"
    />

    <ConfirmDialog
      :open="!!removing"
      :title="t('settings.characters.confirmRemoveTitle')"
      :detail="removing ? t('settings.characters.confirmRemoveDetail', { name: removing.name }) : ''"
      :confirm-label="t('settings.characters.uninstall')"
      @confirm="doRemove"
      @cancel="removing = null"
    />
    <ConfirmDialog
      :open="!!removingBody"
      :title="t('settings.characters.bodies.confirmRemoveTitle')"
      :detail="
        removingBody ? t('settings.characters.bodies.confirmRemoveDetail', { name: removingBody.name }) : ''
      "
      :confirm-label="t('common.delete')"
      @confirm="doRemoveBody"
      @cancel="removingBody = null"
    />
    <ConfirmDialog
      :open="!!resetting"
      :title="t('settings.characters.confirmResetTitle')"
      :detail="t('settings.characters.confirmResetDetail')"
      :confirm-label="t('settings.characters.menu.resetEmotions')"
      @confirm="doResetEmotions"
      @cancel="resetting = null"
    />
    <ToastHost ref="toastHost" />
  </div>
</template>
