<!-- settings/pages/PluginsPage.vue — Hub「插件」页（线 B-2，照 AstrBot ExtensionPage 信息结构）。
     单一运行时：Desktop 插件列表 + 市场源。
     安装两段式：pick/URL 下载 → InstallConfirmDialog 权限清单（硬要求）→ apply。
     市场：源 URL CRUD（prefs plugins.marketSources）+ 拉取浏览 + 从 URL 安装。 -->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ConfigItemMetaSchema, type ConfigItemMeta } from '@openpet/protocol';
import type { DesktopPluginManifest, PluginRuntimeStatus } from '@openpet/protocol';
import Button from '../../components/Button.vue';
import ConfirmDialog from '../../components/ConfirmDialog.vue';
import Input from '../../components/Input.vue';
import PluginCard from '../../components/plugins/PluginCard.vue';
import InstallConfirmDialog from '../../components/plugins/InstallConfirmDialog.vue';
import ConfigItemRenderer from '../../components/config/ConfigItemRenderer.vue';

const { t } = useI18n();

type DesktopEntry = {
  manifest: DesktopPluginManifest;
  enabled: boolean;
  status: PluginRuntimeStatus;
  lastError?: string;
};

const desktop = ref<DesktopEntry[]>([]);
const busy = ref(false);

async function reload(): Promise<void> {
  const r = await window.openpet.rpc('plugins.list', {});
  desktop.value = r.desktop;
}
let offStatus: (() => void) | null = null;
onMounted(async () => {
  await reload();
  offStatus = window.openpet.on('plugin.status', () => void reload());
});
onUnmounted(() => offStatus?.());

// --- 安装（两段式：pick → 权限确认 → apply）---
const pendingInstall = ref<{ path: string; manifest: DesktopPluginManifest } | null>(null);
async function pickInstall(kind: 'dsplug' | 'folder'): Promise<void> {
  const r = await window.openpet.rpc('plugins.installDesktop', { kind });
  if (!r.cancelled) pendingInstall.value = { path: r.path, manifest: r.manifest };
}
async function confirmInstall(): Promise<void> {
  const p = pendingInstall.value;
  pendingInstall.value = null;
  if (!p) return;
  busy.value = true;
  try {
    await window.openpet.rpc('plugins.installDesktopApply', { path: p.path });
    await reload();
  } finally {
    busy.value = false;
  }
}

// --- 卡片操作 ---
const pendingUninstall = ref<DesktopEntry | null>(null);
async function confirmUninstall(): Promise<void> {
  const e = pendingUninstall.value;
  pendingUninstall.value = null;
  if (!e) return;
  await window.openpet.rpc('plugins.uninstallDesktop', { id: e.manifest.id });
  await reload();
}
async function toggle(e: DesktopEntry, enabled: boolean): Promise<void> {
  await window.openpet.rpc('plugins.setEnabled', { id: e.manifest.id, enabled });
  await reload();
}
async function reloadPlugin(e: DesktopEntry): Promise<void> {
  await window.openpet.rpc('plugins.reload', { id: e.manifest.id });
  await reload();
}

// --- 配置对话框（configSchema = { key: meta } → 线 A §2 渲染器）---
const configOpen = ref<DesktopEntry | null>(null);
const configItems = ref<ConfigItemMeta[]>([]);
const configValues = ref<Record<string, unknown>>({});
async function openConfig(e: DesktopEntry): Promise<void> {
  const r = await window.openpet.rpc('plugins.getConfig', { id: e.manifest.id });
  const schema = (r.schema ?? {}) as Record<string, Record<string, unknown>>;
  configItems.value = Object.entries(schema).flatMap(([key, meta]) => {
    const parsed = ConfigItemMetaSchema.safeParse({ key, ...meta });
    return parsed.success ? [parsed.data] : [];
  });
  configValues.value = { ...r.values };
  configOpen.value = e;
}
async function saveConfig(): Promise<void> {
  const e = configOpen.value;
  configOpen.value = null;
  if (!e) return;
  await window.openpet.rpc('plugins.setConfig', { id: e.manifest.id, values: configValues.value });
}

// --- 市场源（prefs plugins.marketSources）---
const sources = ref<string[]>([]);
const newSource = ref('');
const marketItems = ref<Array<Record<string, unknown>>>([]);
const marketError = ref('');
onMounted(async () => {
  const p = await window.openpet.rpc('app.prefs.getAll', {});
  sources.value = p['plugins.marketSources'];
});
async function saveSources(next: string[]): Promise<void> {
  sources.value = next;
  await window.openpet.rpc('app.prefs.set', { key: 'plugins.marketSources', value: next });
}
async function addSource(): Promise<void> {
  const url = newSource.value.trim();
  if (!url) return;
  newSource.value = '';
  await saveSources([...sources.value.filter((s) => s !== url), url]);
}
async function browseSource(url: string): Promise<void> {
  marketError.value = '';
  marketItems.value = [];
  try {
    const r = await window.openpet.rpc('plugins.marketFetch', { url });
    marketItems.value = r.items.filter(
      (x): x is Record<string, unknown> => typeof x === 'object' && x !== null,
    );
  } catch (e) {
    marketError.value = e instanceof Error ? e.message : String(e);
  }
}
function itemStr(item: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = item[k];
    if (typeof v === 'string' && v) return v;
  }
  return '';
}
async function installFromUrl(item: Record<string, unknown>): Promise<void> {
  const url = itemStr(item, 'url', 'download', 'repo');
  if (!url) return;
  busy.value = true;
  try {
    const r = await window.openpet.rpc('plugins.installFromUrl', { url });
    pendingInstall.value = r;
  } catch (e) {
    marketError.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}

const desktopEmpty = computed(() => desktop.value.length === 0);
</script>
<template>
  <div class="space-y-6">
    <!-- 安全提示条（照 MCP 工具页风格） -->
    <div
      class="rounded-panel border border-glass-border bg-white/30 px-4 py-2.5 text-sm text-text-sub"
    >
      {{ t('settings.plugins.securityNote') }}
    </div>

    <section class="ds-glass rounded-panel p-5">
      <div class="mb-3 flex items-center justify-between">
        <h2 class="text-md font-semibold text-text-main">
          {{ t('settings.plugins.installedTitle') }}
        </h2>
        <div class="flex gap-2">
          <Button variant="secondary" :disabled="busy" @click="pickInstall('folder')">
            {{ t('settings.plugins.installFolder') }}
          </Button>
          <Button variant="primary" :disabled="busy" @click="pickInstall('dsplug')">
            {{ t('settings.plugins.installDsplug') }}
          </Button>
        </div>
      </div>

      <div v-if="desktopEmpty" class="px-3 py-8 text-center text-sm text-text-sub">
        {{ t('settings.plugins.empty') }}
      </div>
      <div v-else class="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <PluginCard
          v-for="e in desktop"
          :key="e.manifest.id"
          :name="e.manifest.name"
          :version="e.manifest.version"
          :author="e.manifest.author"
          :description="e.manifest.description"
          :enabled="e.enabled"
          :status="e.status"
          :last-error="e.lastError"
          :has-config="!!e.manifest.configSchema"
          :reloadable="true"
          @toggle="(v) => toggle(e, v)"
          @configure="openConfig(e)"
          @reload="reloadPlugin(e)"
          @uninstall="pendingUninstall = e"
        />
      </div>
    </section>

    <!-- 市场源 -->
    <section class="ds-glass rounded-panel p-5">
      <h2 class="mb-3 text-md font-semibold text-text-main">
        {{ t('settings.plugins.marketTitle') }}
      </h2>
      <div class="flex gap-2">
        <Input
          v-model="newSource"
          class="flex-1"
          :placeholder="t('settings.plugins.marketSourcePlaceholder')"
          @keydown.enter="addSource"
        />
        <Button variant="secondary" @click="addSource">{{ t('common.add') }}</Button>
      </div>

      <div v-if="!sources.length" class="px-3 py-6 text-center text-sm text-text-sub">
        {{ t('settings.plugins.marketEmpty') }}
      </div>
      <div
        v-for="s in sources"
        :key="s"
        class="flex items-center gap-3 border-b border-glass-border py-2 last:border-0"
      >
        <span class="min-w-0 flex-1 truncate text-sm text-text-main">{{ s }}</span>
        <button class="text-sm text-text-sub hover:text-text-main" @click="browseSource(s)">
          {{ t('settings.plugins.marketBrowse') }}
        </button>
        <button
          class="text-sm text-text-sub hover:text-text-main"
          @click="saveSources(sources.filter((x) => x !== s))"
        >
          {{ t('common.delete') }}
        </button>
      </div>

      <div v-if="marketError" class="mt-2 text-sm" style="color: var(--ds-danger)">
        {{ marketError }}
      </div>
      <div v-if="marketItems.length" class="mt-3 space-y-2">
        <div
          v-for="(item, i) in marketItems"
          :key="i"
          class="flex items-center gap-3 rounded-btn border border-glass-border px-3 py-2"
        >
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm font-medium text-text-main">
              {{ itemStr(item, 'name', 'id') || '—' }}
              <span class="ml-1 text-xs text-text-sub">{{ itemStr(item, 'version') }}</span>
            </div>
            <div class="truncate text-sm text-text-sub">
              {{ itemStr(item, 'description', 'desc') }}
            </div>
          </div>
          <Button
            variant="secondary"
            :disabled="busy || !itemStr(item, 'url', 'download', 'repo')"
            @click="installFromUrl(item)"
          >
            {{ t('settings.plugins.marketInstall') }}
          </Button>
        </div>
      </div>
    </section>

    <!-- 权限确认（安装硬要求） -->
    <InstallConfirmDialog
      :open="!!pendingInstall"
      :manifest="pendingInstall?.manifest ?? null"
      @confirm="confirmInstall"
      @cancel="pendingInstall = null"
    />

    <!-- 卸载二次确认 -->
    <ConfirmDialog
      :open="!!pendingUninstall"
      :title="t('settings.plugins.confirmUninstallTitle')"
      :detail="
        pendingUninstall
          ? t('settings.plugins.confirmUninstallDetail', { name: pendingUninstall.manifest.name })
          : ''
      "
      :confirm-label="t('settings.plugins.uninstall')"
      @confirm="confirmUninstall"
      @cancel="pendingUninstall = null"
    />

    <!-- 配置对话框（动态表单） -->
    <div
      v-if="configOpen"
      role="dialog"
      aria-modal="true"
      :aria-label="t('settings.plugins.configTitle', { name: configOpen.manifest.name })"
      class="fixed inset-0 z-[60] flex items-center justify-center"
      style="background: rgba(0, 0, 0, 0.32)"
      @keydown.esc.stop="configOpen = null"
    >
      <div class="ds-glass max-h-[80vh] w-[520px] overflow-y-auto rounded-panel p-5">
        <div class="text-md font-semibold text-text-main">
          {{ t('settings.plugins.configTitle', { name: configOpen.manifest.name }) }}
        </div>
        <div v-if="!configItems.length" class="mt-3 text-sm text-text-sub">
          {{ t('settings.plugins.configEmpty') }}
        </div>
        <div v-for="m in configItems" :key="m.key" class="mt-3">
          <div class="mb-1 text-sm text-text-main">{{ m.label ?? m.key }}</div>
          <div v-if="m.hint" class="mb-1 text-xs text-text-sub">{{ m.hint }}</div>
          <ConfigItemRenderer
            :meta="m"
            :model-value="configValues[m.key]"
            @update:model-value="(v) => (configValues[m.key] = v)"
          />
        </div>
        <div class="mt-5 flex justify-end gap-2">
          <button
            class="ds-focus rounded-btn px-4 py-2 text-base text-text-sub"
            @click="configOpen = null"
          >
            {{ t('common.cancel') }}
          </button>
          <Button variant="primary" @click="saveConfig">{{ t('common.save') }}</Button>
        </div>
      </div>
    </div>
  </div>
</template>
