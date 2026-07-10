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
};
export type MenuLabels = Record<keyof typeof ZH, string>;
export function menuLabels(locale: string): MenuLabels {
  return locale === 'en' ? EN : ZH;
}
