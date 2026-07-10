/**
 * J3 错误分级文案（ui-design §14.3）：绝不直抛 `Error: 401`，只给角色化台词 + 操作。
 * 数据源 = chat.done 的 errorKind（已由 Main 转发）。actions 由 UI 映射：
 * retry=重发上一条 user；switchModel/changeKey=打开 Hub D3。
 */
import type { ErrorKind } from '@openpet/protocol';

export type ErrorAction = 'retry' | 'switchModel' | 'changeKey';
export interface ErrorCopy {
  line: string;
  actions: ErrorAction[];
}

// line = i18n key（渲染处 t(line)）。
export function errorCopy(kind?: ErrorKind): ErrorCopy {
  switch (kind) {
    case 'timeout':
    case 'network':
      return { line: 'overlay.error.network', actions: ['retry', 'switchModel'] };
    case 'auth':
      return { line: 'overlay.error.auth', actions: ['changeKey'] };
    case 'rate_limit':
      return { line: 'overlay.error.rateLimit', actions: ['switchModel'] };
    case 'server':
    case 'unknown':
    default:
      return { line: 'overlay.error.fallback', actions: ['retry'] };
  }
}
