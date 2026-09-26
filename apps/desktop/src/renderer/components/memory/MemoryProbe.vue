<!-- components/memory/MemoryProbe.vue — ㉒「试一句」输入行（spec §4.6）：如果我这么说，角色会想起什么。
     调 memory.probe（与聊天同一条检索链、同一个记忆块渲染，不记被想起统计）；新请求开始即清空旧结果，
     慢到的旧响应丢弃。结果经 result 事件交给父级：图谱描环 + MemoryProbeResult 侧栏。 -->
<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { MemoryProbeResult } from '@openpet/protocol';
import Button from '../Button.vue';
import Input from '../Input.vue';
import { createLatestRequest } from '../../settings/latest-request.js';

defineProps<{ enabled: boolean }>();
const emit = defineEmits<{
  result: [MemoryProbeResult | null];
  close: [];
}>();
const { t } = useI18n();

const text = ref('');
const busy = ref(false);
const error = ref('');
const guard = createLatestRequest();

async function run(): Promise<void> {
  const q = text.value.trim();
  if (!q) return;
  const n = guard.next();
  error.value = '';
  emit('result', null); // 新请求开始即清空（防把旧结果当新结果）
  busy.value = true;
  try {
    const r = await window.openpet.rpc('memory.probe', { text: q.slice(0, 500) });
    if (!guard.isCurrent(n)) return;
    emit('result', r);
  } catch (e) {
    if (guard.isCurrent(n)) error.value = e instanceof Error ? e.message : String(e);
  } finally {
    if (guard.isCurrent(n)) busy.value = false;
  }
}
function close(): void {
  guard.invalidate();
  busy.value = false;
  emit('result', null);
  emit('close');
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="flex items-center gap-2">
      <div class="min-w-0 flex-1">
        <Input
          v-model="text"
          class="w-full"
          :placeholder="
            enabled
              ? t('settings.memory.graph.probePlaceholder')
              : t('settings.memory.graph.probeDisabled')
          "
          :disabled="!enabled"
          @keydown.enter="run"
          @keydown.esc="close"
        />
      </div>
      <Button variant="primary" :disabled="!enabled || busy || !text.trim()" @click="run">
        {{ busy ? t('settings.memory.graph.probeRunning') : t('settings.memory.graph.probeRun') }}
      </Button>
      <Button variant="ghost" @click="close">{{ t('settings.memory.graph.close') }}</Button>
    </div>
    <div v-if="error" class="text-xs" style="color: var(--ds-danger)">{{ error }}</div>
  </div>
</template>
