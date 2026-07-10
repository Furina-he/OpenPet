/** Hub 左导航树（ui-design §3.3）。M7a 只有 system.display 有真实内容，其余占位。 */
import {
  Home,
  Users,
  MessagesSquare,
  Zap,
  Blocks,
  Database,
  Settings,
  Wrench,
  Link2,
} from 'lucide-vue-next';
import type { Component } from 'vue';

export interface NavLeaf {
  id: string;
  /** i18n key（渲染处 t(label)） */
  label: string;
}
export interface NavGroup {
  id: string;
  label: string;
  icon: Component;
  children: NavLeaf[];
}

export const NAV_TREE: NavGroup[] = [
  { id: 'overview', label: 'settings.nav.overview', icon: Home, children: [] },
  {
    id: 'character',
    label: 'settings.nav.character',
    icon: Users,
    children: [
      { id: 'character.library', label: 'settings.nav.characterLibrary' },
      { id: 'character.editor', label: 'settings.nav.characterEditor' },
    ],
  },
  {
    id: 'conversation',
    label: 'settings.nav.conversation',
    icon: MessagesSquare,
    children: [
      { id: 'conversation.chat', label: 'settings.nav.chat' },
      { id: 'conversation.history', label: 'settings.nav.history' },
      { id: 'conversation.memory', label: 'settings.nav.memory' },
      { id: 'conversation.persona', label: 'settings.nav.persona' },
    ],
  },
  { id: 'model', label: 'settings.nav.model', icon: Zap, children: [] },
  { id: 'tools', label: 'settings.nav.tools', icon: Wrench, children: [] },
  { id: 'connections', label: 'settings.nav.connections', icon: Link2, children: [] },
  { id: 'plugins', label: 'settings.nav.plugins', icon: Blocks, children: [] },
  { id: 'knowledge', label: 'settings.nav.knowledge', icon: Database, children: [] },
  {
    id: 'system',
    label: 'settings.nav.system',
    icon: Settings,
    children: [
      { id: 'system.general', label: 'settings.nav.general' },
      { id: 'system.display', label: 'settings.nav.display' },
      { id: 'system.voice', label: 'settings.nav.voice' },
      { id: 'system.hotkeys', label: 'settings.nav.hotkeys' },
      { id: 'system.privacy', label: 'settings.nav.privacy' },
      { id: 'system.data', label: 'settings.nav.data' },
      { id: 'system.trace', label: 'settings.nav.trace' },
      { id: 'system.about', label: 'settings.nav.about' },
    ],
  },
];

export function flattenRoutes(): string[] {
  return NAV_TREE.flatMap((g) => (g.children.length ? g.children.map((c) => c.id) : [g.id]));
}

export function isActive(route: string, current: string): boolean {
  return route === current;
}
