import { describe, it, expect } from 'vitest';
import { isThinking, shouldFold, groupMessages } from '../../src/renderer/overlay/bubble-view';
import type { ChatMessage } from '../../src/renderer/overlay/chat-view';

const asst = (text: string, fr: ChatMessage['finishReason'] = null): ChatMessage => ({
  role: 'assistant',
  text,
  finishReason: fr,
});
const user = (text: string): ChatMessage => ({ role: 'user', text, finishReason: null });

describe('bubble-view（B2 渲染判定）', () => {
  it('isThinking：assistant 空文本 + streaming + 未结束', () => {
    expect(isThinking(asst(''), true)).toBe(true);
    expect(isThinking(asst('嗨'), true)).toBe(false); // 已有文本
    expect(isThinking(asst(''), false)).toBe(false); // 非 streaming
    expect(isThinking(user(''), true)).toBe(false); // user 不算思考
  });
  it('shouldFold：>200 字才折叠（按字符计）', () => {
    expect(shouldFold('短')).toBe(false);
    expect(shouldFold('字'.repeat(200))).toBe(false);
    expect(shouldFold('字'.repeat(201))).toBe(true);
  });
  it('groupMessages：连续同 role 合并', () => {
    const groups = groupMessages([user('a'), asst('b'), asst('c'), user('d')]);
    expect(groups.map((g) => g.role)).toEqual(['user', 'assistant', 'user']);
    expect(groups[1]!.messages).toHaveLength(2);
  });
});
