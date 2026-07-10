<!-- settings/pages/ConnectionsPage.vue — Hub「连接」页（线 B-1 F-IM，照 AstrBot PlatformPage）。
     顶 = 明文凭证/白名单建议信息条；中 = 标题行 + 平台卡片网格（logo 水印/状态 chip/错误详情）；
     下 = 全局设置卡（唤醒前缀/私聊须前缀/白名单/管理员/群记忆/到桌提醒）。 -->
<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { AlertCircle, Link2, ShieldAlert } from 'lucide-vue-next';
import type { ImPlatform, ImStatus, Prefs, PrefKey } from '@openpet/protocol';
import { DEFAULT_PREFS } from '@openpet/protocol';
import Switch from '../../components/Switch.vue';
import Button from '../../components/Button.vue';
import Input from '../../components/Input.vue';
import ConfirmDialog from '../../components/ConfirmDialog.vue';
import SettingSection from '../../components/SettingSection.vue';
import SettingCard from '../../components/SettingCard.vue';
import ImPlatformCard from '../../components/im/ImPlatformCard.vue';
import ImPlatformDialog from '../../components/im/ImPlatformDialog.vue';

const emit = defineEmits<{ saved: [] }>();
const { t } = useI18n();

const platforms = ref<ImPlatform[]>([]);
const statuses = ref<Record<string, ImStatus>>({});
const prefs = ref<Prefs>({ ...DEFAULT_PREFS });

const dialogOpen = ref(false);
const editing = ref<ImPlatform | undefined>(undefined);
const pendingDelete = ref<ImPlatform | null>(null);
/** 错误详情弹窗目标（照 AstrBot errorDialog）。 */
const errorFor = ref<ImPlatform | null>(null);

// 逗号分隔/逐行文本的本地缓冲：失焦才写回 prefs（避免逐键持久化）。
const wakeText = ref('');
const adminsText = ref('');
const whitelistText = ref('');

async function reload(): Promise<void> {
  const cfg = await window.openpet.rpc('im.getConfig', {});
  platforms.value = cfg.platforms;
  statuses.value = Object.fromEntries(cfg.statuses.map((s) => [s.platformId, s]));
}

let offStatus: (() => void) | null = null;
onMounted(async () => {
  await reload();
  prefs.value = (await window.openpet.rpc('app.prefs.getAll', {})) as Prefs;
  wakeText.value = prefs.value['im.wakePrefixes'].join(', ');
  adminsText.value = prefs.value['im.admins'].join(', ');
  whitelistText.value = prefs.value['im.whitelist'].join('\n');
  offStatus = window.openpet.on('im.status', (s) => {
    statuses.value = { ...statuses.value, [s.platformId]: s };
  });
});
onUnmounted(() => offStatus?.());

async function set<K extends PrefKey>(key: K, value: Prefs[K]): Promise<void> {
  prefs.value = { ...prefs.value, [key]: value };
  await window.openpet.rpc('app.prefs.set', {
    key,
    value: value as string | number | boolean | string[],
  });
  emit('saved');
}

function splitCsv(text: string): string[] {
  return text
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean);
}
function commitWake(): void {
  void set('im.wakePrefixes', splitCsv(wakeText.value));
}
function commitAdmins(): void {
  void set('im.admins', splitCsv(adminsText.value));
}
function commitWhitelist(): void {
  void set(
    'im.whitelist',
    whitelistText.value
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

function openAdd(): void {
  editing.value = undefined;
  dialogOpen.value = true;
}
function openEdit(p: ImPlatform): void {
  editing.value = p;
  dialogOpen.value = true;
}
async function onSave(p: ImPlatform): Promise<void> {
  dialogOpen.value = false;
  await window.openpet.rpc('im.savePlatform', { platform: p });
  await reload();
  emit('saved');
}
async function toggleEnable(p: ImPlatform, enable: boolean): Promise<void> {
  await window.openpet.rpc('im.savePlatform', { platform: { ...p, enable } });
  await reload();
}
async function confirmDelete(): Promise<void> {
  const p = pendingDelete.value;
  pendingDelete.value = null;
  if (!p) return;
  await window.openpet.rpc('im.deletePlatform', { id: p.id });
  await reload();
}
</script>

<template>
  <div class="max-w-[1080px]">
    <!-- 顶部信息条：凭证明文存储 + 私人伙伴白名单建议 -->
    <div class="ds-glass mb-4 flex items-start gap-3 rounded-panel px-4 py-3 text-sm text-text-sub">
      <ShieldAlert
        class="mt-0.5 shrink-0"
        :size="16"
        :stroke-width="1.5"
        style="color: var(--ds-warning)"
      />
      <span>{{ t('settings.im.infoBanner') }}</span>
    </div>

    <!-- 平台区（照 AstrBot PlatformPage：标题行 + item-card 网格） -->
    <div class="mb-3 flex items-end justify-between gap-4">
      <div>
        <h2 class="text-md font-semibold text-text-main">{{ t('settings.im.title') }}</h2>
        <p class="mt-0.5 text-sm text-text-sub">{{ t('settings.im.subtitle') }}</p>
      </div>
      <Button variant="primary" @click="openAdd">{{ t('settings.im.addPlatform') }}</Button>
    </div>

    <div v-if="!platforms.length" class="ds-glass mb-4 rounded-panel px-4 py-12 text-center">
      <Link2 :size="44" :stroke-width="1.2" class="mx-auto text-text-sub opacity-50" />
      <p class="mt-3 text-sm text-text-sub">{{ t('settings.im.empty') }}</p>
    </div>
    <div v-else class="mb-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <ImPlatformCard
        v-for="p in platforms"
        :key="p.id"
        :platform="p"
        :status="statuses[p.id]"
        @toggle="(v) => toggleEnable(p, v)"
        @edit="openEdit(p)"
        @remove="pendingDelete = p"
        @errors="errorFor = p"
      />
    </div>

    <!-- 全局设置（直接 app.prefs.set；im-service 实时读，无需重载） -->
    <SettingSection :title="t('settings.im.secGlobal')">
      <SettingCard :label="t('settings.im.wakePrefixes')" :description="t('settings.im.wakePrefixesDesc')">
        <Input v-model="wakeText" placeholder="/" @focusout="commitWake" />
      </SettingCard>
      <SettingCard
        :label="t('settings.im.friendNeedsWake')"
        :description="t('settings.im.friendNeedsWakeDesc')"
      >
        <Switch
          :model-value="prefs['im.friendNeedsWake']"
          @update:model-value="(v) => set('im.friendNeedsWake', v)"
        />
      </SettingCard>
      <SettingCard
        :label="t('settings.im.whitelistEnabled')"
        :description="t('settings.im.whitelistEnabledDesc')"
      >
        <Switch
          :model-value="prefs['im.whitelistEnabled']"
          @update:model-value="(v) => set('im.whitelistEnabled', v)"
        />
      </SettingCard>
      <div class="px-4 py-3">
        <div class="mb-1 text-base font-medium text-text-main">{{ t('settings.im.whitelist') }}</div>
        <div class="mb-2 text-sm text-text-sub">{{ t('settings.im.whitelistDesc') }}</div>
        <textarea
          v-model="whitelistText"
          rows="4"
          class="ds-control w-full rounded-input p-2 text-sm text-text-main"
          :placeholder="'im:qq1:private:10000\n10000'"
          @focusout="commitWhitelist"
        />
      </div>
      <SettingCard :label="t('settings.im.admins')" :description="t('settings.im.adminsDesc')">
        <Input v-model="adminsText" placeholder="10000, 10086" @focusout="commitAdmins" />
      </SettingCard>
      <SettingCard
        :label="t('settings.im.groupIntoMemory')"
        :description="t('settings.im.groupIntoMemoryDesc')"
      >
        <Switch
          :model-value="prefs['im.groupIntoMemory']"
          @update:model-value="(v) => set('im.groupIntoMemory', v)"
        />
      </SettingCard>
      <SettingCard
        :label="t('settings.im.notifyDesktop')"
        :description="t('settings.im.notifyDesktopDesc')"
      >
        <Switch
          :model-value="prefs['im.notifyDesktop']"
          @update:model-value="(v) => set('im.notifyDesktop', v)"
        />
      </SettingCard>
    </SettingSection>

    <ImPlatformDialog
      :open="dialogOpen"
      :platform="editing"
      @save="onSave"
      @cancel="dialogOpen = false"
    />
    <ConfirmDialog
      :open="!!pendingDelete"
      :title="t('settings.im.confirmDeleteTitle')"
      :detail="pendingDelete ? t('settings.im.confirmDeleteDetail', { name: pendingDelete.name }) : ''"
      :confirm-label="t('common.delete')"
      @confirm="confirmDelete"
      @cancel="pendingDelete = null"
    />

    <!-- 错误详情（照 AstrBot errorDialog：平台 / 累计错误 / 最近错误） -->
    <div
      v-if="errorFor"
      class="fixed inset-0 z-[60] flex items-center justify-center"
      style="background: rgba(0, 0, 0, 0.32)"
      @click.self="errorFor = null"
    >
      <div class="ds-glass w-[520px] rounded-panel p-5">
        <div class="flex items-center gap-2 text-md font-semibold text-text-main">
          <AlertCircle :size="18" :stroke-width="1.5" style="color: var(--ds-danger)" />
          {{ t('settings.im.errorDialogTitle') }}
        </div>
        <div class="mt-3 space-y-2 text-sm text-text-main">
          <div>
            <span class="text-text-sub">{{ t('settings.im.name') }}：</span>{{ errorFor.name }}
          </div>
          <div>
            <span class="text-text-sub">{{ t('settings.im.errorTimesLabel') }}：</span
            >{{ statuses[errorFor.id]?.errorCount ?? 0 }}
          </div>
          <div v-if="statuses[errorFor.id]?.lastError">
            <div class="text-text-sub">{{ t('settings.im.lastError') }}：</div>
            <pre
              class="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-card px-3 py-2 text-sm"
              style="background: var(--ds-warm-soft); color: var(--ds-danger)"
              >{{ statuses[errorFor.id]?.lastError }}</pre
            >
          </div>
        </div>
        <div class="mt-4 flex justify-end">
          <Button variant="primary" @click="errorFor = null">{{ t('common.close') }}</Button>
        </div>
      </div>
    </div>
  </div>
</template>
