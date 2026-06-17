/** Hub 左导航树（ui-design §3.3）。M7a 只有 system.display 有真实内容，其余占位。 */
export interface NavLeaf {
  id: string;
  label: string;
}
export interface NavGroup {
  id: string;
  label: string;
  children: NavLeaf[];
}

export const NAV_TREE: NavGroup[] = [
  { id: 'overview', label: '总览', children: [] },
  {
    id: 'character',
    label: '角色',
    children: [
      { id: 'character.library', label: '角色库' },
      { id: 'character.editor', label: '编辑器' },
    ],
  },
  {
    id: 'conversation',
    label: '对话',
    children: [
      { id: 'conversation.history', label: '历史' },
      { id: 'conversation.memory', label: '记忆' },
      { id: 'conversation.persona', label: '人格' },
    ],
  },
  { id: 'model', label: '模型 API', children: [] },
  { id: 'plugins', label: '插件', children: [] },
  { id: 'knowledge', label: '知识库', children: [] },
  {
    id: 'system',
    label: '系统',
    children: [
      { id: 'system.display', label: '显示与窗口' },
      { id: 'system.voice', label: '语音' },
      { id: 'system.hotkeys', label: '热键' },
      { id: 'system.privacy', label: '隐私' },
      { id: 'system.data', label: '数据' },
      { id: 'system.about', label: '关于' },
    ],
  },
];

export function flattenRoutes(): string[] {
  return NAV_TREE.flatMap((g) => (g.children.length ? g.children.map((c) => c.id) : [g.id]));
}

export function isActive(route: string, current: string): boolean {
  return route === current;
}
