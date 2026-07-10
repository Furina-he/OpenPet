// 线 B-1：IM 平台配置 + 会话源（照 AstrBot MessageSession 语义）。
import { z } from 'zod';

export const ImPlatformTypeSchema = z.enum(['onebot-v11', 'telegram']);
export type ImPlatformType = z.infer<typeof ImPlatformTypeSchema>;

/** 凭证明文随配置存（F-ST-04 用户裁定口径，与 provider source key 一致）。 */
export const ImPlatformSchema = z.object({
  id: z.string().min(1),
  type: ImPlatformTypeSchema,
  name: z.string().min(1),
  enable: z.boolean().default(true),
  /** onebot-v11：NapCat/Lagrange 正向 WS 地址（ws://host:port）。 */
  wsUrl: z.string().default(''),
  /** onebot-v11：access token（可空）。 */
  accessToken: z.string().default(''),
  /** telegram：Bot token。 */
  botToken: z.string().default(''),
  /** telegram：API 网关（默认官方；国内可指自建代理）。 */
  apiBase: z.string().default('https://api.telegram.org'),
});
export type ImPlatform = z.infer<typeof ImPlatformSchema>;

export function validateImPlatform(p: ImPlatform): void {
  if (p.type === 'onebot-v11' && !p.wsUrl.trim()) throw new Error('onebot-v11 requires wsUrl');
  if (p.type === 'telegram' && !p.botToken.trim()) throw new Error('telegram requires botToken');
}

export const ImStatusSchema = z.object({
  platformId: z.string(),
  status: z.enum(['pending', 'running', 'reconnecting', 'error', 'stopped']),
  errorCount: z.number().int().nonnegative().default(0),
  lastError: z.string().optional(),
});
export type ImStatus = z.infer<typeof ImStatusSchema>;

export type ImChatKind = 'group' | 'private';

/** openpet sessionId 命名空间：im:<platformId>:<kind>:<chatId>（桌面会话是 'default'）。 */
export function imOrigin(platformId: string, kind: ImChatKind, chatId: string): string {
  return `im:${platformId}:${kind}:${chatId}`;
}
export function parseImOrigin(
  sessionId: string,
): { platformId: string; kind: ImChatKind; chatId: string } | null {
  if (!sessionId.startsWith('im:')) return null;
  const rest = sessionId.slice(3);
  const i = rest.indexOf(':');
  const j = rest.indexOf(':', i + 1);
  if (i < 0 || j < 0) return null;
  const kind = rest.slice(i + 1, j);
  if (kind !== 'group' && kind !== 'private') return null;
  return { platformId: rest.slice(0, i), kind, chatId: rest.slice(j + 1) };
}
export function isImSession(sessionId: string): boolean {
  return sessionId.startsWith('im:');
}

/** 入站归一化消息（首版纯文本；非文本段由适配器转占位）。 */
export interface ImIncoming {
  platformId: string;
  kind: ImChatKind;
  chatId: string;
  senderId: string;
  senderName: string;
  text: string;
  atMe: boolean;
  replyToMe: boolean;
  ts: number;
}
