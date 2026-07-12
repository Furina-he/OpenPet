<!-- settings/pages/AboutPage.vue — D8 关于（ui-design §7.8；参照 1d7669e3 + §2 token）
     做实：版本信息 + 检查更新（⑪ update-service 状态机，映射见 update-view.ts）+
     致谢 + 帮助/法律外链（app.openExternal，仅 http/https）。
     §7.8 逐区：版本卡/法律=按钮行；帮助/诊断=SettingCard 标签+动作行。URL/邮箱为占位，上线前替换。 -->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { UpdateStatus } from '@openpet/protocol';
import SettingSection from '../../components/SettingSection.vue';
import SettingCard from '../../components/SettingCard.vue';
import { updateButtonView } from '../update-view.js';

const { t } = useI18n();
// 版本走 app.version 真值（偿债：原硬编码 '0.1.0'）。
const version = ref('');
// ⑪ 检查更新：mounted 取当前态（只读），此后吃 update.status 广播。
const updateStatus = ref<UpdateStatus>({ state: 'idle' });
const view = computed(() => updateButtonView(updateStatus.value));
let offStatus: (() => void) | null = null;
onMounted(async () => {
  version.value = (await window.openpet.rpc('app.version', {})).version;
  updateStatus.value = await window.openpet.rpc('app.update.status', {});
  offStatus = window.openpet.on('update.status', (st) => {
    updateStatus.value = st as UpdateStatus;
  });
});
onUnmounted(() => offStatus?.());
async function onUpdateClick(): Promise<void> {
  const action = view.value.action;
  if (action === 'check') updateStatus.value = await window.openpet.rpc('app.update.check', {});
  else if (action === 'download') await window.openpet.rpc('app.update.download', {});
  else if (action === 'install') await window.openpet.rpc('app.update.install', {});
}
const BUILD = 'Beta · 2026-04-30';
// 占位 URL / 邮箱（官网 openpet-web 域名定了再换，见改名 spec follow-up；暂全指 GitHub 仓库系）
const LINKS = {
  site: 'https://github.com/Furina-he/openpet',
  github: 'https://github.com/Furina-he/openpet',
  community: 'https://github.com/Furina-he/openpet/discussions',
  manual: 'https://github.com/Furina-he/openpet/blob/main/docs/user-manual.md',
  issues: 'https://github.com/Furina-he/openpet/issues',
  license: 'https://github.com/Furina-he/openpet/blob/main/LICENSE',
  terms: 'https://github.com/Furina-he/openpet',
  privacy: 'https://github.com/Furina-he/openpet',
};
const CONTACT_EMAIL = 'hello@openpet.app';
const ACK = ['AstrBot', 'three-vrm', 'pixi-live2d-display', 'XState', 'better-sqlite3', 'Lucide', 'Vue'];

const BTN = 'ds-control rounded-btn px-3 py-1.5 text-sm';

function open(url: string): void {
  void window.openpet.rpc('app.openExternal', { url });
}

// J5：生成本地脱敏 .dsdiag（真实上报端点留 M9）。
const diagPath = ref('');
async function genDiag(): Promise<void> {
  const r = (await window.openpet.rpc('app.generateDiag', {})) as { path: string };
  diagPath.value = r.path;
}
</script>

<template>
  <div class="max-w-[640px]">
    <!-- 版本：§7.8 logo 占位 + 版本/构建/slogan + 按钮行；⑪ 新版 badge + 更新按钮状态机 -->
    <SettingSection title="openpet">
      <div class="px-4 py-3">
        <div class="text-lg text-text-main">openpet</div>
        <div class="flex items-center gap-2 text-sm text-text-sub">
          <span>v{{ version }} · {{ BUILD }}</span>
          <span
            v-if="view.badge"
            class="rounded-full bg-brand-from px-1.5 py-0.5 text-xs leading-none text-white"
            >{{ t('settings.about.updateNewBadge') }}</span
          >
        </div>
        <div class="mt-1 text-base text-text-sub">{{ t('settings.about.slogan') }}</div>
        <div class="mt-3 flex flex-wrap items-center gap-2">
          <button
            :class="`${BTN} ${view.disabled ? 'text-text-sub' : 'text-text-main'}`"
            :disabled="view.disabled"
            :title="view.errorMessage"
            @click="onUpdateClick"
          >
            {{ t(view.labelKey, view.labelParams) }}
          </button>
          <span v-if="view.hintKey" class="text-sm text-text-sub">{{ t(view.hintKey) }}</span>
          <button :class="`${BTN} text-text-main`" @click="open(LINKS.site)">{{ t('settings.about.openSite') }}</button>
          <button :class="`${BTN} text-text-main`" @click="open(LINKS.github)">GitHub</button>
          <button :class="`${BTN} text-text-main`" @click="open(LINKS.community)">{{ t('settings.about.community') }}</button>
        </div>
        <!-- 更新内容摘要（available 态，Release body 用户向中文） -->
        <div v-if="view.notes" class="mt-3 rounded-card border border-glass-border px-3 py-2">
          <div class="text-sm text-text-main">{{ t('settings.about.updateNotesTitle') }}</div>
          <div class="mt-1 whitespace-pre-wrap text-sm text-text-sub">{{ view.notes }}</div>
        </div>
      </div>
    </SettingSection>

    <!-- 致谢：开源项目列表 + 完整许可证（独立成行） -->
    <SettingSection :title="t('settings.about.secAck')">
      <div class="px-4 py-3">
        <div class="text-base text-text-sub">{{ t('settings.about.ackDesc') }}{{ ACK.join(' · ') }}</div>
        <button :class="`${BTN} mt-2 text-text-main`" @click="open(LINKS.license)">
          {{ t('settings.about.fullLicense') }}
        </button>
      </div>
    </SettingSection>

    <!-- 反馈与帮助：§7.8 标签+动作行 -->
    <SettingSection :title="t('settings.about.secHelp')">
      <SettingCard :label="t('settings.about.manual')">
        <button :class="`${BTN} text-text-main`" @click="open(LINKS.manual)">{{ t('common.open') }}</button>
      </SettingCard>
      <SettingCard :label="t('settings.about.reportIssue')">
        <button :class="`${BTN} text-text-main`" @click="open(LINKS.issues)">GitHub Issues</button>
      </SettingCard>
      <SettingCard :label="t('settings.about.communityChat')">
        <button :class="`${BTN} text-text-main`" @click="open(LINKS.community)">Discord</button>
      </SettingCard>
      <SettingCard :label="t('settings.about.mailAuthor')">
        <span class="text-base text-text-sub">{{ CONTACT_EMAIL }}</span>
      </SettingCard>
    </SettingSection>

    <!-- 诊断：§7.8 标签+动作行（J5 本地生成脱敏 .dsdiag；真实上报端点留 M9） -->
    <SettingSection :title="t('settings.about.secDiag')">
      <SettingCard
        :label="t('settings.about.collectDiag')"
        :description="t('settings.about.collectDiagDesc')"
      >
        <div class="flex items-center gap-2">
          <span v-if="diagPath" class="text-sm text-text-sub">{{ t('settings.about.generated') }}{{ diagPath }}</span>
          <button :class="`${BTN} text-text-main`" @click="genDiag">{{ t('settings.data.diagBtn') }}</button>
        </div>
      </SettingCard>
    </SettingSection>

    <!-- 法律：§7.8 按钮行 -->
    <SettingSection :title="t('settings.about.secLegal')">
      <div class="flex flex-wrap gap-2 px-4 py-3">
        <button :class="`${BTN} text-text-main`" @click="open(LINKS.terms)">{{ t('settings.about.terms') }}</button>
        <button :class="`${BTN} text-text-main`" @click="open(LINKS.privacy)">{{ t('settings.about.privacyPolicy') }}</button>
        <button :class="`${BTN} text-text-main`" @click="open(LINKS.license)">
          {{ t('settings.about.licenseMit') }}
        </button>
      </div>
    </SettingSection>
  </div>
</template>
