/** A4 角色存在感模式（纯函数）。优先级：隐藏 > 专注 > 勿扰 > 正常。 */
export type DesktopMode = 'normal' | 'dnd' | 'focus' | 'hidden';

export function resolveMode(s: {
  fullscreenHidden: boolean;
  focus: boolean;
  dnd: boolean;
}): DesktopMode {
  if (s.fullscreenHidden) return 'hidden';
  if (s.focus) return 'focus';
  if (s.dnd) return 'dnd';
  return 'normal';
}
