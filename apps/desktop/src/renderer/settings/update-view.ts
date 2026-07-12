/**
 * 关于页「检查更新」按钮状态映射（⑪ T4）——UpdateStatus → 视图 props 纯函数，
 * SFC 薄渲染（项目约定：逻辑下沉纯 TS 测）。
 * 文案 key 均挂 settings.about.*；error 的原始 message 走 errorMessage 字段
 * （显示在按钮 title，不进 i18n）。
 */
import type { UpdateStatus } from '@openpet/protocol';

export interface UpdateButtonView {
  labelKey: string;
  labelParams: Record<string, string | number>;
  action: 'check' | 'download' | 'install' | 'none';
  disabled: boolean;
  /** 版本号旁「新」badge（发现新版/就绪未装）。 */
  badge: boolean;
  /** available 态的 release notes 原文（'' 无）。 */
  notes: string;
  /** 辅助行文案 key（'' 无）：已最新 / 便携版指引 / 检查失败。 */
  hintKey: string;
  /** error 态原始信息（按钮 title 展示；'' 无）。 */
  errorMessage: string;
}

export function updateButtonView(st: UpdateStatus): UpdateButtonView {
  const base: UpdateButtonView = {
    labelKey: 'settings.about.checkUpdate',
    labelParams: {},
    action: 'check',
    disabled: false,
    badge: false,
    notes: '',
    hintKey: '',
    errorMessage: '',
  };
  switch (st.state) {
    case 'idle':
      return base;
    case 'disabled':
      return {
        ...base,
        action: 'none',
        disabled: true,
        hintKey:
          st.reason === 'portable'
            ? 'settings.about.updatePortableHint'
            : 'settings.about.updateDevHint',
      };
    case 'checking':
      return { ...base, labelKey: 'settings.about.updateChecking', action: 'none', disabled: true };
    case 'available':
      return {
        ...base,
        labelKey: 'settings.about.updateDownload',
        labelParams: { version: st.version },
        action: 'download',
        badge: true,
        notes: st.notes,
      };
    case 'none':
      return { ...base, hintKey: 'settings.about.updateUpToDate' };
    case 'downloading':
      return {
        ...base,
        labelKey: 'settings.about.updateDownloading',
        labelParams: { percent: Math.round(st.percent) },
        action: 'none',
        disabled: true,
      };
    case 'ready':
      return {
        ...base,
        labelKey: 'settings.about.updateRestart',
        labelParams: { version: st.version },
        action: 'install',
        badge: true,
      };
    case 'error':
      return { ...base, hintKey: 'settings.about.updateFailed', errorMessage: st.message };
  }
}
