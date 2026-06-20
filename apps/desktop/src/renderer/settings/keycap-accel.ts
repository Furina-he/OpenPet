/** 把 keydown 事件转 Electron accelerator 串（纯）。纯修饰键 → ''（录制未完成）。 */
export interface KeyEventLike {
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  key: string;
}
const MOD_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'OS', 'AltGraph']);

export function toAccelerator(e: KeyEventLike): string {
  if (MOD_KEYS.has(e.key)) return '';
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('CommandOrControl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  parts.push(key);
  return parts.join('+');
}
