<!-- settings/pages/McpToolsPage.vue — Hub「工具」页（§4，照 AstrBot MCP/工具页 + §2 glass）。
     上 = MCP server 列表（状态/active/编辑/删除/测连）；下 = 工具表（按 server 分组，逐工具 active 安全门）。 -->
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { McpServer, McpServerStatus, McpTool } from '@openpet/protocol';
import Switch from '../../components/Switch.vue';
import Button from '../../components/Button.vue';
import ConfirmDialog from '../../components/ConfirmDialog.vue';
import AddMcpServerDialog from '../../components/mcp/AddMcpServerDialog.vue';

const { t } = useI18n();
const servers = ref<McpServer[]>([]);
const tools = ref<McpTool[]>([]);
const status = ref<Record<string, McpServerStatus>>({});
const loading = ref(false);

const dialogOpen = ref(false);
const editing = ref<McpServer | undefined>(undefined);
const pendingDelete = ref<McpServer | null>(null);

async function reload(): Promise<void> {
  loading.value = true;
  try {
    const cfg = await window.openpet.rpc('mcp.getConfig', {});
    servers.value = cfg.servers;
    tools.value = cfg.tools;
    status.value = cfg.status;
  } finally {
    loading.value = false;
  }
}
onMounted(reload);

const toolsByServer = computed<Map<string, McpTool[]>>(() => {
  const m = new Map<string, McpTool[]>();
  for (const tool of tools.value) {
    const arr = m.get(tool.serverId) ?? [];
    arr.push(tool);
    m.set(tool.serverId, arr);
  }
  return m;
});

function connected(id: string): boolean {
  return status.value[id]?.connected ?? false;
}
function errlogs(id: string): string[] {
  return status.value[id]?.errlogs ?? [];
}
function reconnecting(id: string): number {
  return status.value[id]?.reconnectAttempts ?? 0;
}

function openAdd(): void {
  editing.value = undefined;
  dialogOpen.value = true;
}
function openEdit(s: McpServer): void {
  editing.value = s;
  dialogOpen.value = true;
}
async function onSave(server: McpServer): Promise<void> {
  dialogOpen.value = false;
  await window.openpet.rpc('mcp.upsertServer', { server });
  await reload();
}
async function confirmDelete(): Promise<void> {
  const s = pendingDelete.value;
  pendingDelete.value = null;
  if (!s) return;
  await window.openpet.rpc('mcp.deleteServer', { id: s.id });
  await reload();
}
async function toggleServer(s: McpServer, active: boolean): Promise<void> {
  await window.openpet.rpc('mcp.setServerActive', { id: s.id, active });
  await reload();
}
async function toggleTool(tool: McpTool, active: boolean): Promise<void> {
  await window.openpet.rpc('mcp.setToolActive', {
    serverId: tool.serverId,
    toolName: tool.name,
    active,
  });
  await reload();
}
</script>

<template>
  <div class="space-y-6">
    <!-- MCP server 列表 -->
    <section class="ds-glass rounded-panel p-5">
      <div class="mb-3 flex items-center justify-between">
        <h2 class="text-md font-semibold text-text-main">{{ t('settings.mcp.title') }}</h2>
        <Button variant="primary" @click="openAdd">{{ t('settings.mcp.addServer') }}</Button>
      </div>

      <div v-if="!servers.length" class="px-3 py-8 text-center text-sm text-text-sub">
        {{ t('settings.mcp.empty') }}
      </div>

      <div
        v-for="s in servers"
        :key="s.id"
        class="flex items-center gap-3 border-b border-glass-border py-3 last:border-0"
      >
        <span
          class="h-2.5 w-2.5 shrink-0 rounded-full"
          :title="
            connected(s.id)
              ? t('settings.mcp.connected')
              : reconnecting(s.id) > 0
                ? t('settings.mcp.reconnecting', { n: reconnecting(s.id) })
                : errlogs(s.id).join('; ') || t('settings.mcp.disconnected')
          "
          :style="{
            background: !s.active
              ? 'var(--ds-text-sub)'
              : connected(s.id)
                ? 'var(--ds-success)'
                : reconnecting(s.id) > 0
                  ? 'var(--ds-warning)'
                  : 'var(--ds-danger)',
          }"
        />
        <div class="min-w-0 flex-1">
          <div class="truncate font-semibold text-text-main">{{ s.name }}</div>
          <div class="truncate text-sm text-text-sub">
            {{ s.transport }} ·
            {{ s.transport === 'stdio' ? `${s.command} ${s.args.join(' ')}` : s.url }}
          </div>
          <div
            v-if="s.active && !connected(s.id) && reconnecting(s.id) > 0"
            class="truncate text-sm"
            style="color: var(--ds-warning)"
          >
            {{ t('settings.mcp.reconnecting', { n: reconnecting(s.id) }) }}
          </div>
          <div
            v-else-if="s.active && !connected(s.id) && errlogs(s.id).length"
            class="truncate text-sm"
            style="color: var(--ds-danger)"
          >
            {{ errlogs(s.id)[0] }}
          </div>
        </div>
        <Switch :model-value="s.active" @update:model-value="(v) => toggleServer(s, v)" />
        <button class="text-sm text-text-sub hover:text-text-main" @click="openEdit(s)">{{ t('common.edit') }}</button>
        <button class="text-sm text-text-sub hover:text-text-main" @click="pendingDelete = s">
          {{ t('common.delete') }}
        </button>
      </div>
    </section>

    <!-- 工具表（逐工具 active 安全门） -->
    <section class="ds-glass rounded-panel p-5">
      <h2 class="mb-3 text-md font-semibold text-text-main">{{ t('settings.mcp.tools') }}</h2>
      <div v-if="!tools.length" class="px-3 py-6 text-center text-sm text-text-sub">
        {{ t('settings.mcp.noTools') }}
      </div>

      <template v-for="s in servers" :key="`tools-${s.id}`">
        <div v-if="toolsByServer.get(s.id)?.length" class="mb-4">
          <div class="mb-1 text-sm text-text-sub">{{ s.name }}</div>
          <div
            v-for="tool in toolsByServer.get(s.id)"
            :key="tool.name"
            class="flex items-center gap-3 border-b border-glass-border py-2 last:border-0"
          >
            <div class="min-w-0 flex-1">
              <div class="truncate font-medium text-text-main">{{ tool.name }}</div>
              <div class="truncate text-sm text-text-sub">{{ tool.description || '—' }}</div>
            </div>
            <Switch :model-value="tool.active" @update:model-value="(v) => toggleTool(tool, v)" />
          </div>
        </div>
      </template>
    </section>

    <AddMcpServerDialog
      :open="dialogOpen"
      :server="editing"
      @save="onSave"
      @cancel="dialogOpen = false"
    />
    <ConfirmDialog
      :open="!!pendingDelete"
      :title="t('settings.mcp.confirmDeleteTitle')"
      :detail="pendingDelete ? t('settings.mcp.confirmDeleteDetail', { name: pendingDelete.name }) : ''"
      :confirm-label="t('common.delete')"
      @confirm="confirmDelete"
      @cancel="pendingDelete = null"
    />
  </div>
</template>
