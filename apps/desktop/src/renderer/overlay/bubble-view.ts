/** B2 气泡渲染判定（纯函数）：思考态 / 长文折叠 / 连续同发言合并（ui-design §6.1/§6.2）。 */
import type { ChatMessage } from './chat-view';

/** 思考中：assistant 占位（空文本）且正在流、未结束 → 三点呼吸光。 */
export function isThinking(msg: ChatMessage, streaming: boolean): boolean {
  return streaming && msg.role === 'assistant' && msg.text === '' && msg.finishReason === null;
}

const FOLD_THRESHOLD = 200;
/** 长文（>200 字）默认折叠前 N 行。按 Unicode 码点计数。 */
export function shouldFold(text: string): boolean {
  return [...text].length > FOLD_THRESHOLD;
}

export interface BubbleGroup {
  role: ChatMessage['role'];
  messages: ChatMessage[];
}
/** 连续同 role 的消息合并为一个渲染组（共享头像，气泡纵向堆叠）。 */
export function groupMessages(messages: ChatMessage[]): BubbleGroup[] {
  const groups: BubbleGroup[] = [];
  for (const m of messages) {
    const last = groups[groups.length - 1];
    if (last && last.role === m.role) last.messages.push(m);
    else groups.push({ role: m.role, messages: [m] });
  }
  return groups;
}
