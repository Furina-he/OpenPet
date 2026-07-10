/** character 窗微型字典（非 Vue 表面，vue-i18n 不进来）。 */
const ZH = {
  clickThroughOn: '🔇 鼠标穿透已开启',
  clickThroughOff: '✋ 已恢复互动',
} as const;
const EN: Record<keyof typeof ZH, string> = {
  clickThroughOn: '🔇 Click-through enabled',
  clickThroughOff: '✋ Interaction restored',
};
export function charStrings(locale: string): Record<keyof typeof ZH, string> {
  return locale === 'en' ? EN : ZH;
}
