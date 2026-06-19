/**
 * J3 错误分级文案（ui-design §14.3）：绝不直抛 `Error: 401`，只给角色化台词 + 操作。
 * 数据源 = chat.done 的 errorKind（已由 Main 转发）。actions 由 UI 映射：
 * retry=重发上一条 user；switchModel/changeKey=打开 Hub D3。
 */
import type { ErrorKind } from '@desksoul/protocol';

export type ErrorAction = 'retry' | 'switchModel' | 'changeKey';
export interface ErrorCopy {
  line: string;
  actions: ErrorAction[];
}

export function errorCopy(kind?: ErrorKind): ErrorCopy {
  switch (kind) {
    case 'timeout':
    case 'network':
      return { line: '「歪头」我没法连上大脑诶…', actions: ['retry', 'switchModel'] };
    case 'auth':
      return { line: '「眨眼」哎，钥匙好像不对', actions: ['changeKey'] };
    case 'rate_limit':
      return { line: '「叹气」今天的额度用完啦', actions: ['switchModel'] };
    case 'server':
    case 'unknown':
    default:
      return { line: '「困惑」大脑卡了一下，再说一次？', actions: ['retry'] };
  }
}
