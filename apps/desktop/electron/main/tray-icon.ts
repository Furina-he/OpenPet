/** J1 托盘图标态（纯）：异常 > 思考 > 默认。 */
export type TrayIconKey = 'default' | 'thinking' | 'error';

export function trayIconKey(s: { error: boolean; thinking: boolean }): TrayIconKey {
  if (s.error) return 'error';
  if (s.thinking) return 'thinking';
  return 'default';
}
