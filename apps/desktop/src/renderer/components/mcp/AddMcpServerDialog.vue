<!-- components/mcp/AddMcpServerDialog.vue — MCP server 新增/编辑（§4，照 AstrBot MCP 表单 + §2 glass）。
     stdio = command + args + env；sse/http = url + headers。「测试连接」调 mcp.testServer 显示发现工具数。 -->
<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { ref, watch } from 'vue';
import { McpServerSchema, type McpServer, type McpTransport } from '@openpet/protocol';
import Input from '../Input.vue';
import Select from '../Select.vue';
import Button from '../Button.vue';
import DictEditor from '../config/widgets/DictEditor.vue';

const { t } = useI18n();
const props = defineProps<{ open: boolean; server?: McpServer }>();
const emit = defineEmits<{ save: [McpServer]; cancel: [] }>();

const TRANSPORTS: ReadonlyArray<{ value: McpTransport; label: string }> = [
  { value: 'stdio', label: 'stdio' },
  { value: 'http', label: 'streamable http' },
  { value: 'sse', label: 'sse' },
];

const id = ref('');
const name = ref('');
const transport = ref<McpTransport>('stdio');
const command = ref('');
const argsText = ref('');
const env = ref<Record<string, string>>({});
const url = ref('');
const headers = ref<Record<string, string>>({});
const note = ref('');
const active = ref(true);

const testing = ref(false);
const testMsg = ref('');
const testOk = ref<boolean | null>(null);

function uuid(): string {
  return crypto.randomUUID();
}

// 打开时按 props.server 回填（编辑）或重置（新增）。
watch(
  () => [props.open, props.server] as const,
  ([open]) => {
    if (!open) return;
    const s = props.server;
    id.value = s?.id ?? uuid();
    name.value = s?.name ?? '';
    transport.value = s?.transport ?? 'stdio';
    command.value = s?.command ?? '';
    argsText.value = (s?.args ?? []).join('\n');
    env.value = { ...(s?.env ?? {}) };
    url.value = s?.url ?? '';
    headers.value = { ...(s?.headers ?? {}) };
    note.value = s?.note ?? '';
    active.value = s?.active ?? true;
    testMsg.value = '';
    testOk.value = null;
  },
  { immediate: true },
);

function collect(): McpServer {
  return McpServerSchema.parse({
    id: id.value || uuid(),
    name: name.value.trim() || id.value,
    transport: transport.value,
    command: command.value.trim(),
    args: argsText.value
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean),
    env: env.value,
    url: url.value.trim(),
    headers: headers.value,
    active: active.value,
    note: note.value,
  });
}

async function test(): Promise<void> {
  testing.value = true;
  testMsg.value = '';
  testOk.value = null;
  try {
    const r = await window.openpet.rpc('mcp.testServer', { server: collect() });
    testOk.value = r.ok;
    testMsg.value = r.ok ? t('settings.mcp.testOk', { n: r.tools.length }) : t('settings.model.connectFail', { detail: r.error ?? t('settings.chat.unknown') });
  } catch (e) {
    testOk.value = false;
    testMsg.value = t('settings.model.connectFail', { detail: e instanceof Error ? e.message : String(e) });
  } finally {
    testing.value = false;
  }
}

function save(): void {
  emit('save', collect());
}
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 z-[60] flex items-center justify-center"
    style="background: rgba(0, 0, 0, 0.32)"
    @click.self="emit('cancel')"
  >
    <div class="ds-glass max-h-[88vh] w-[520px] overflow-y-auto rounded-panel p-5">
      <div class="text-md font-semibold text-text-main">
        {{ props.server ? t('settings.mcp.editServer') : t('settings.mcp.addServerTitle') }}
      </div>

      <div class="mt-4 space-y-3">
        <label class="block">
          <span class="mb-1 block text-sm text-text-sub">{{ t('settings.persona.name') }}</span>
          <Input v-model="name" :placeholder="t('settings.mcp.namePlaceholder')" />
        </label>

        <label class="block">
          <span class="mb-1 block text-sm text-text-sub">{{ t('settings.mcp.transport') }}</span>
          <Select v-model="transport" :options="TRANSPORTS" />
        </label>

        <template v-if="transport === 'stdio'">
          <label class="block">
            <span class="mb-1 block text-sm text-text-sub">{{ t('settings.mcp.command') }}</span>
            <Input v-model="command" :placeholder="t('settings.mcp.commandPlaceholder')" />
          </label>
          <label class="block">
            <span class="mb-1 block text-sm text-text-sub">{{ t('settings.mcp.args') }}</span>
            <textarea
              v-model="argsText"
              rows="4"
              class="ds-control w-full rounded-input p-2 text-sm text-text-main"
              placeholder="-y&#10;@modelcontextprotocol/server-everything"
            />
          </label>
          <div>
            <span class="mb-1 block text-sm text-text-sub">{{ t('settings.mcp.env') }}</span>
            <DictEditor v-model="env" />
          </div>
        </template>

        <template v-else>
          <label class="block">
            <span class="mb-1 block text-sm text-text-sub">{{ t('settings.mcp.url') }}</span>
            <Input v-model="url" placeholder="https://example.com/mcp" />
          </label>
          <div>
            <span class="mb-1 block text-sm text-text-sub">{{ t('settings.mcp.headers') }}</span>
            <DictEditor v-model="headers" />
          </div>
        </template>

        <label class="block">
          <span class="mb-1 block text-sm text-text-sub">{{ t('settings.mcp.note') }}</span>
          <Input v-model="note" :placeholder="t('settings.mcp.optional')" />
        </label>
      </div>

      <div
        v-if="testMsg"
        class="mt-3 rounded-card px-3 py-2 text-sm"
        :style="{
          color: testOk ? 'var(--ds-success)' : 'var(--ds-danger)',
          background: 'var(--ds-warm-soft)',
        }"
      >
        {{ testMsg }}
      </div>

      <div class="mt-5 flex items-center justify-between gap-2">
        <Button variant="secondary" :disabled="testing" @click="test">
          {{ testing ? t('settings.providerUi.testing') : t('settings.providerUi.testConnection') }}
        </Button>
        <div class="flex gap-2">
          <Button variant="ghost" @click="emit('cancel')">{{ t('common.cancel') }}</Button>
          <Button variant="primary" @click="save">{{ t('common.save') }}</Button>
        </div>
      </div>
    </div>
  </div>
</template>
