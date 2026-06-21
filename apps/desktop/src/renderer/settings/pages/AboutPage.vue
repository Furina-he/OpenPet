<!-- settings/pages/AboutPage.vue — D8 关于（ui-design §7.8；参照 1d7669e3 + §2 token）
     做实：版本信息 + 致谢 + 帮助/法律外链（app.openExternal，仅 http/https）。
     存而不接：[检查更新]（无 updater）/[生成 .dsdiag]（无诊断聚合后端）。
     §7.8 逐区：版本卡/法律=按钮行；帮助/诊断=SettingCard 标签+动作行。URL/邮箱为占位，上线前替换。 -->
<script setup lang="ts">
import { ref } from 'vue';
import SettingSection from '../../components/SettingSection.vue';
import SettingCard from '../../components/SettingCard.vue';

const VERSION = '0.1.0';
const BUILD = 'Beta · 构建于 2026-04-30';
// 占位 URL / 邮箱（上线前替换为真实站点）
const LINKS = {
  site: 'https://desksoul.app',
  github: 'https://github.com/desksoul/desksoul',
  community: 'https://desksoul.app/community',
  manual: 'https://desksoul.app/docs',
  issues: 'https://github.com/desksoul/desksoul/issues',
  license: 'https://github.com/desksoul/desksoul/blob/main/LICENSE',
  terms: 'https://desksoul.app/terms',
  privacy: 'https://desksoul.app/privacy',
};
const CONTACT_EMAIL = 'hello@desksoul.app';
const ACK = ['three-vrm', 'pixi-live2d-display', 'XState', 'better-sqlite3', 'Lucide', 'Vue'];

const BTN = 'ds-control rounded-btn px-3 py-1.5 text-sm';

function open(url: string): void {
  void window.desksoul.rpc('app.openExternal', { url });
}

// J5：生成本地脱敏 .dsdiag（真实上报端点留 M9）。
const diagPath = ref('');
async function genDiag(): Promise<void> {
  const r = (await window.desksoul.rpc('app.generateDiag', {})) as { path: string };
  diagPath.value = r.path;
}
</script>

<template>
  <div class="max-w-[640px]">
    <!-- 版本：§7.8 logo 占位 + 版本/构建/slogan + 按钮行 -->
    <SettingSection title="DeskSoul">
      <div class="px-4 py-3">
        <div class="text-lg text-text-main">DeskSoul</div>
        <div class="text-sm text-text-sub">v{{ VERSION }} · {{ BUILD }}</div>
        <div class="mt-1 text-base text-text-sub">一个会被你看见的 AI 灵魂体</div>
        <div class="mt-3 flex flex-wrap gap-2">
          <button :class="`${BTN} text-text-sub`" disabled title="暂未接入更新器">检查更新</button>
          <button :class="`${BTN} text-text-main`" @click="open(LINKS.site)">打开官网</button>
          <button :class="`${BTN} text-text-main`" @click="open(LINKS.github)">GitHub</button>
          <button :class="`${BTN} text-text-main`" @click="open(LINKS.community)">社区</button>
        </div>
      </div>
    </SettingSection>

    <!-- 致谢：开源项目列表 + 完整许可证（独立成行） -->
    <SettingSection title="致谢">
      <div class="px-4 py-3">
        <div class="text-base text-text-sub">本产品基于以下开源项目：{{ ACK.join(' · ') }}</div>
        <button :class="`${BTN} mt-2 text-text-main`" @click="open(LINKS.license)">
          完整开源许可证
        </button>
      </div>
    </SettingSection>

    <!-- 反馈与帮助：§7.8 标签+动作行 -->
    <SettingSection title="反馈与帮助">
      <SettingCard label="用户手册">
        <button :class="`${BTN} text-text-main`" @click="open(LINKS.manual)">打开</button>
      </SettingCard>
      <SettingCard label="报告问题">
        <button :class="`${BTN} text-text-main`" @click="open(LINKS.issues)">GitHub Issues</button>
      </SettingCard>
      <SettingCard label="社区交流">
        <button :class="`${BTN} text-text-main`" @click="open(LINKS.community)">Discord</button>
      </SettingCard>
      <SettingCard label="给作者写信">
        <span class="text-base text-text-sub">{{ CONTACT_EMAIL }}</span>
      </SettingCard>
    </SettingSection>

    <!-- 诊断：§7.8 标签+动作行（J5 本地生成脱敏 .dsdiag；真实上报端点留 M9） -->
    <SettingSection title="诊断">
      <SettingCard
        label="一键收集诊断包"
        description="含：脱敏日志 + 系统信息 + 配置摘要（API Key、对话内容自动剔除）"
      >
        <div class="flex items-center gap-2">
          <span v-if="diagPath" class="text-sm text-text-sub">已生成：{{ diagPath }}</span>
          <button :class="`${BTN} text-text-main`" @click="genDiag">生成 .dsdiag</button>
        </div>
      </SettingCard>
    </SettingSection>

    <!-- 法律：§7.8 按钮行 -->
    <SettingSection title="法律">
      <div class="flex flex-wrap gap-2 px-4 py-3">
        <button :class="`${BTN} text-text-main`" @click="open(LINKS.terms)">服务条款</button>
        <button :class="`${BTN} text-text-main`" @click="open(LINKS.privacy)">隐私政策</button>
        <button :class="`${BTN} text-text-main`" @click="open(LINKS.license)">
          开源许可证 (MIT)
        </button>
      </div>
    </SettingSection>
  </div>
</template>
