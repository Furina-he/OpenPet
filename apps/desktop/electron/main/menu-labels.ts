/** main 侧唯一 i18n 表面（托盘 + 角色右键菜单）。renderer 的 vue-i18n 不进 main，用微型字典。 */
const ZH = {
  chat: '跟小灵聊聊',
  switchCharacter: '切换角色',
  clickThrough: '鼠标穿透',
  toggleVisible: '显示 / 隐藏角色',
  dnd: '不打扰',
  openHub: '打开 Hub',
  settings: '设置',
  quit: '退出',
  connected: '已连接',
  disconnected: '未连接',
  // ㉓ 大小子菜单（{pct} / {k} 由调用方手动替换）
  size: '大小',
  sizeCurrent: '大小（当前 {pct}%）',
  characterSize: '角色大小',
  characterSizeCurrent: '角色大小（当前 {pct}%）',
  sizeReset: '恢复 100%',
  sizePixel: '{k}×（{pct}%）',
} as const;
const EN: Record<keyof typeof ZH, string> = {
  chat: 'Chat',
  switchCharacter: 'Switch character',
  clickThrough: 'Click-through',
  toggleVisible: 'Show / hide character',
  dnd: 'Do not disturb',
  openHub: 'Open Hub',
  settings: 'Settings',
  quit: 'Quit',
  connected: 'Connected',
  disconnected: 'Disconnected',
  size: 'Size',
  sizeCurrent: 'Size (now {pct}%)',
  characterSize: 'Character size',
  characterSizeCurrent: 'Character size (now {pct}%)',
  sizeReset: 'Reset to 100%',
  sizePixel: '{k}× ({pct}%)',
};
export type MenuLabels = Record<keyof typeof ZH, string>;
export function menuLabels(locale: string): MenuLabels {
  return locale === 'en' ? EN : ZH;
}
