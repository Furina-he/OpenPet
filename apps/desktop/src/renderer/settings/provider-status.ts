/** §7.3 左栏状态点：红=测失败 / 绿=已配置可用 / 灰=待填 Key。 */
export type ProviderDot = 'ok' | 'pending' | 'fail';

export function providerDot(input: { hasKey: boolean; lastTestOk?: boolean | null }): ProviderDot {
  if (input.lastTestOk === false) return 'fail';
  if (input.hasKey) return 'ok';
  return 'pending';
}

/** 点色 → CSS 变量（绿用品牌暖色，红用 danger，灰用 sub）。 */
export const DOT_COLOR: Record<ProviderDot, string> = {
  ok: 'var(--ds-brand-to)',
  fail: 'var(--ds-danger)',
  pending: 'var(--ds-text-sub)',
};
