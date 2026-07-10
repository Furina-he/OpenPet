/** 会话导出 Markdown 组装（纯函数；spec §2.3）。 */
import type { StoredRow } from './db/store.js';

/** 标题派生：meta 优先 → 首条 user 消息截 24 字 → sessionId 兜底。 */
export function deriveTitle(
  metaTitle: string | null,
  firstUserText: string | null,
  sessionId: string,
): string {
  return metaTitle ?? (firstUserText ? firstUserText.slice(0, 24) : sessionId);
}

export function sanitizeFilename(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '');
}

export function sessionToMarkdown(title: string, characterName: string, rows: StoredRow[]): string {
  const lines = [`# ${title}`, ''];
  for (const r of rows) {
    const who = r.role === 'user' ? '你' : characterName;
    const time = new Date(r.ts).toLocaleString();
    lines.push(`**${who}**：${r.text}`, '', `<sub>${time}</sub>`, '');
  }
  return lines.join('\n');
}
