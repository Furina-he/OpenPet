/**
 * Hub 壳层小逻辑（发布门真窗反馈回修）——纯函数，SFC 薄渲染。
 */
import type { ThemePref } from '@openpet/protocol';

/** 顶栏主题按钮：三态循环 light → dark → system → light。 */
export function nextTheme(cur: ThemePref): ThemePref {
  return cur === 'light' ? 'dark' : cur === 'dark' ? 'system' : 'light';
}

/** 主题按钮的 i18n title key（告知当前态，点击切下一态）。 */
export function themeTitleKey(cur: ThemePref): string {
  return cur === 'light'
    ? 'settings.shell.themeLight'
    : cur === 'dark'
      ? 'settings.shell.themeDark'
      : 'settings.shell.themeSystem';
}

/** 角色卡头像字符：名字首字符（码点安全，emoji 不劈半）；空名回退 'O'。 */
export function avatarInitialOf(name: string): string {
  const first = [...name.trim()][0];
  return first ?? 'O';
}
