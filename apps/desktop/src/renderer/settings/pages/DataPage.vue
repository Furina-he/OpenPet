<!-- settings/pages/DataPage.vue — Hub「数据」页（D7，批次⑥，照 UI/1d7669e3 D7 区简化）。
     存储占用 / 导出 .dsbak / 导入（重启换库）/ 危险区（清空对话·清空记忆，红描边+确认）/ 诊断。 -->
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import Button from '../../components/Button.vue';
import ConfirmDialog from '../../components/ConfirmDialog.vue';

const { t } = useI18n();
const usage = ref<{ dbBytes: number; messageCount: number; characterCount: number } | null>(null);
const memoryCount = ref(0);
const tip = ref('');
const error = ref('');
const importReady = ref(false); // 导入已 stage，等重启
const confirmClearMsg = ref(false);
const confirmClearMem = ref(false);
const busy = ref(false);

async function load(): Promise<void> {
  usage.value = await window.openpet.rpc('app.storageUsage', {});
  const m = (await window.openpet.rpc('memory.list', {})) as { facts: unknown[] };
  memoryCount.value = m.facts.length;
}
onMounted(load);

function fmtBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

async function run(fn: () => Promise<void>): Promise<void> {
  busy.value = true;
  tip.value = '';
  error.value = '';
  try {
    await fn();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

const exportData = (): Promise<void> =>
  run(async () => {
    const r = await window.openpet.rpc('app.exportDataPick', {});
    if (!r.cancelled) tip.value = t('settings.data.exported', { size: fmtBytes(r.bytes), path: r.path });
  });

const importData = (): Promise<void> =>
  run(async () => {
    const r = await window.openpet.rpc('app.importData', {});
    if (!r.cancelled && r.requiresRestart) importReady.value = true;
  });

const relaunch = (): Promise<void> => run(() => window.openpet.rpc('app.relaunch', {}).then(() => {}));

const openDataDir = (): Promise<void> =>
  run(() => window.openpet.rpc('app.openDataDir', {}).then(() => {}));

const generateDiag = (): Promise<void> =>
  run(async () => {
    const r = await window.openpet.rpc('app.generateDiag', {});
    tip.value = t('settings.data.diagGenerated', { path: r.path });
  });

const clearMessages = (): Promise<void> =>
  run(async () => {
    confirmClearMsg.value = false;
    await window.openpet.rpc('app.clearMessages', {});
    tip.value = t('settings.data.messagesCleared');
    await load();
  });

const clearMemory = (): Promise<void> =>
  run(async () => {
    confirmClearMem.value = false;
    await window.openpet.rpc('memory.clear', {});
    tip.value = t('settings.data.memoryCleared');
    await load();
  });
</script>

<template>
  <div class="mx-auto max-w-[720px] space-y-4">
    <div
      v-if="error"
      class="rounded-card px-3 py-2 text-sm"
      style="color: var(--ds-danger); background: var(--ds-warm-soft)"
    >
      {{ error }}
    </div>
    <div v-if="tip" class="rounded-card px-3 py-2 text-sm" style="color: var(--ds-brand-to)">
      {{ tip }}
    </div>

    <!-- 导入已就绪：重启生效 -->
    <div
      v-if="importReady"
      class="ds-glass flex items-center justify-between rounded-panel p-4"
      style="outline: 2px solid var(--ds-brand-to); outline-offset: -1px"
    >
      <div>
        <div class="font-semibold text-text-main">{{ t('settings.data.importReady') }}</div>
        <div class="text-sm text-text-sub">{{ t('settings.data.importReadyDesc') }}</div>
      </div>
      <Button variant="primary" @click="relaunch">{{ t('settings.data.relaunchNow') }}</Button>
    </div>

    <!-- 存储占用 -->
    <div class="ds-glass rounded-panel p-5">
      <div class="mb-3 flex items-center justify-between">
        <h3 class="font-semibold text-text-main">{{ t('settings.data.storageTitle') }}</h3>
        <Button variant="secondary" @click="openDataDir">{{ t('settings.data.openDataDir') }}</Button>
      </div>
      <div v-if="usage" class="space-y-2 text-base">
        <div class="flex justify-between">
          <span class="text-text-sub">{{ t('settings.data.dbSize') }}</span>
          <span class="text-text-main">{{ fmtBytes(usage.dbBytes) }}</span>
        </div>
        <div class="flex justify-between">
          <span class="text-text-sub">{{ t('settings.data.messages') }}</span>
          <span class="text-text-main">{{ t('settings.data.countItems', { n: usage.messageCount }) }}</span>
        </div>
        <div class="flex justify-between">
          <span class="text-text-sub">{{ t('settings.data.characterData') }}</span>
          <span class="text-text-main">{{ t('settings.data.countCharacters', { n: usage.characterCount }) }}</span>
        </div>
        <div class="flex justify-between">
          <span class="text-text-sub">{{ t('settings.data.longTermMemory') }}</span>
          <span class="text-text-main">{{ t('settings.data.countItems', { n: memoryCount }) }}</span>
        </div>
      </div>
    </div>

    <!-- 备份与恢复 -->
    <div class="ds-glass rounded-panel p-5">
      <h3 class="mb-1 font-semibold text-text-main">{{ t('settings.data.backupTitle') }}</h3>
      <p class="mb-3 text-sm text-text-sub">
        {{ t('settings.data.backupDesc') }}
      </p>
      <div class="flex gap-2">
        <Button variant="primary" :disabled="busy" @click="exportData">{{ t('settings.data.exportBtn') }}</Button>
        <Button variant="secondary" :disabled="busy" @click="importData">{{ t('settings.data.importBtn') }}</Button>
      </div>
    </div>

    <!-- 诊断 -->
    <div class="ds-glass rounded-panel p-5">
      <h3 class="mb-1 font-semibold text-text-main">{{ t('settings.data.diagTitle') }}</h3>
      <p class="mb-3 text-sm text-text-sub">{{ t('settings.data.diagDesc') }}</p>
      <Button variant="secondary" :disabled="busy" @click="generateDiag">{{ t('settings.data.diagBtn') }}</Button>
    </div>

    <!-- 危险区 -->
    <div class="rounded-panel p-5" style="border: 1px solid var(--ds-danger); background: transparent">
      <h3 class="mb-1 font-semibold" style="color: var(--ds-danger)">{{ t('settings.data.dangerTitle') }}</h3>
      <p class="mb-3 text-sm text-text-sub">{{ t('settings.data.dangerDesc') }}</p>
      <div class="flex gap-2">
        <Button variant="secondary" :disabled="busy" @click="confirmClearMsg = true">
          {{ t('settings.data.clearMessagesBtn') }}
        </Button>
        <Button variant="secondary" :disabled="busy" @click="confirmClearMem = true">
          {{ t('settings.data.clearMemoryBtn') }}
        </Button>
      </div>
    </div>

    <ConfirmDialog
      :open="confirmClearMsg"
      :title="t('settings.data.confirmClearMsgTitle')"
      :detail="t('settings.data.confirmClearMsgDetail')"
      :confirm-label="t('settings.data.clearLabel')"
      @confirm="clearMessages"
      @cancel="confirmClearMsg = false"
    />
    <ConfirmDialog
      :open="confirmClearMem"
      :title="t('settings.data.confirmClearMemTitle')"
      :detail="t('settings.data.confirmClearMemDetail')"
      :confirm-label="t('settings.data.clearLabel')"
      @confirm="clearMemory"
      @cancel="confirmClearMem = false"
    />
  </div>
</template>
