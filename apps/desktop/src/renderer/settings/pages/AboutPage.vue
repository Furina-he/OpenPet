<!-- settings/pages/AboutPage.vue — D8 关于（ui-design §7.8；参照 1d7669e3 + §2 token）
     做实：版本信息 + 致谢 + 帮助/法律外链（app.openExternal，仅 http/https）。
     存而不接：[检查更新]（无 updater）/[生成 .dsdiag]（无诊断聚合后端）。
     URL 为占位，上线前替换。 -->
<script setup lang="ts">
import SettingSection from '../../components/SettingSection.vue';

const VERSION = '0.1.0';
const BUILD = 'Beta · 构建于 2026-04-30';
// 占位 URL（上线前替换为真实站点）
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
const ACK = ['three-vrm', 'pixi-live2d-display', 'XState', 'better-sqlite3', 'Lucide', 'Vue'];

function open(url: string): void {
  void window.desksoul.rpc('app.openExternal', { url });
}
</script>

<template>
  <div class="max-w-[640px]">
    <SettingSection title="DeskSoul">
      <div class="px-4 py-3">
        <div class="text-lg text-text-main">DeskSoul</div>
        <div class="text-sm text-text-sub">v{{ VERSION }} · {{ BUILD }}</div>
        <div class="mt-1 text-base text-text-sub">一个会被你看见的 AI 灵魂体</div>
        <div class="mt-3 flex flex-wrap gap-2">
          <button
            class="rounded-btn border border-glass-border px-3 py-1.5 text-sm text-text-sub"
            disabled
            title="暂未接入更新器"
          >
            检查更新
          </button>
          <button
            class="rounded-btn border border-glass-border px-3 py-1.5 text-sm text-text-main"
            @click="open(LINKS.site)"
          >
            打开官网
          </button>
          <button
            class="rounded-btn border border-glass-border px-3 py-1.5 text-sm text-text-main"
            @click="open(LINKS.github)"
          >
            GitHub
          </button>
          <button
            class="rounded-btn border border-glass-border px-3 py-1.5 text-sm text-text-main"
            @click="open(LINKS.community)"
          >
            社区
          </button>
        </div>
      </div>
    </SettingSection>

    <SettingSection title="致谢">
      <div class="px-4 py-3 text-base text-text-sub">
        本产品基于以下开源项目：{{ ACK.join(' · ') }}
        <button class="ml-2 text-text-main underline" @click="open(LINKS.license)">
          完整开源许可证
        </button>
      </div>
    </SettingSection>

    <SettingSection title="反馈与帮助">
      <div class="flex flex-wrap gap-2 px-4 py-3">
        <button
          class="rounded-btn border border-glass-border px-3 py-1.5 text-sm text-text-main"
          @click="open(LINKS.manual)"
        >
          📖 用户手册
        </button>
        <button
          class="rounded-btn border border-glass-border px-3 py-1.5 text-sm text-text-main"
          @click="open(LINKS.issues)"
        >
          🐛 报告问题
        </button>
        <button
          class="rounded-btn border border-glass-border px-3 py-1.5 text-sm text-text-main"
          @click="open(LINKS.community)"
        >
          💬 社区交流
        </button>
      </div>
    </SettingSection>

    <SettingSection title="诊断">
      <div class="px-4 py-3 text-base text-text-sub">
        <button
          class="rounded-btn border border-glass-border px-3 py-1.5 text-sm text-text-sub"
          disabled
          title="诊断包生成留后续"
        >
          生成 .dsdiag
        </button>
        <span class="ml-2 text-sm"
          >含脱敏日志 + 系统信息 + 配置摘要（自动剔除 Key / 对话）—— 留后续</span
        >
      </div>
    </SettingSection>

    <SettingSection title="法律">
      <div class="flex flex-wrap gap-2 px-4 py-3">
        <button
          class="rounded-btn border border-glass-border px-3 py-1.5 text-sm text-text-main"
          @click="open(LINKS.terms)"
        >
          服务条款
        </button>
        <button
          class="rounded-btn border border-glass-border px-3 py-1.5 text-sm text-text-main"
          @click="open(LINKS.privacy)"
        >
          隐私政策
        </button>
        <button
          class="rounded-btn border border-glass-border px-3 py-1.5 text-sm text-text-main"
          @click="open(LINKS.license)"
        >
          开源许可证 (MIT)
        </button>
      </div>
    </SettingSection>
  </div>
</template>
