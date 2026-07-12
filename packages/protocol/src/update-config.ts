import { z } from 'zod';

/**
 * 自动更新状态（⑪ 发布批次）——update-service 状态机的单一真源。
 * spec：自动检查、手动装（autoDownload:false）；检查失败静默 log 不弹窗；
 * dev/portable 门控（portable 关于页显示「便携版请手动下载更新」）。
 */
export const UpdateStatusSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('idle') }),
  /** 门控：dev（isPackaged=false）/ portable（PORTABLE_EXECUTABLE_DIR 在场）。 */
  z.object({ state: z.literal('disabled'), reason: z.enum(['dev', 'portable']) }),
  z.object({ state: z.literal('checking') }),
  z.object({ state: z.literal('available'), version: z.string(), notes: z.string() }),
  z.object({ state: z.literal('none'), checkedAt: z.number() }),
  z.object({ state: z.literal('downloading'), percent: z.number().min(0).max(100) }),
  z.object({ state: z.literal('ready'), version: z.string() }),
  z.object({ state: z.literal('error'), message: z.string(), checkedAt: z.number() }),
]);
export type UpdateStatus = z.infer<typeof UpdateStatusSchema>;
