import { describe, it, expect } from 'vitest';
import { ConversationCore, type Notification } from '../electron/main/conversation-core';

function collect(): {
  core: ConversationCore;
  out: Notification[];
  cues: Array<['chat.reasoning' | 'chat.tool', string]>;
} {
  const out: Notification[] = [];
  const cues: Array<['chat.reasoning' | 'chat.tool', string]> = [];
  return {
    core: new ConversationCore((n) => out.push(n), { cue: (e, sid) => cues.push([e, sid]) }),
    out,
    cues,
  };
}

describe('ConversationCore C′ 路由', () => {
  it('reasoning → chat.reasoning + 首块一次 chat.reasoning 领域事件；不产生 chat.stream', () => {
    const { core, out, cues } = collect();
    core.handleEvent('s', { type: 'reasoning', text: '先想想' });
    core.handleEvent('s', { type: 'reasoning', text: '再想想' });
    const reasoning = out.filter((n) => n.channel === 'chat.reasoning');
    const stream = out.filter((n) => n.channel === 'chat.stream');
    expect(reasoning).toHaveLength(2);
    expect(reasoning[0]!.params).toMatchObject({ sessionId: 's', text: '先想想' });
    expect(cues).toEqual([['chat.reasoning', 's']]); // 仅首块一次线索（领域事件，表现归 cue 表）
    expect(stream).toHaveLength(0); // 不进气泡
  });

  it('tool_call → chat.toolCall(pending) + chat.tool 领域事件', () => {
    const { core, out, cues } = collect();
    core.handleEvent('s', { type: 'tool_call', id: 'c1', name: 'web_search', args: { q: 'x' } });
    expect(out.filter((n) => n.channel === 'chat.toolCall')).toHaveLength(1);
    expect(out.find((n) => n.channel === 'chat.toolCall')!.params).toMatchObject({
      sessionId: 's',
      call: { id: 'c1', name: 'web_search', phase: 'pending' },
    });
    expect(cues).toEqual([['chat.tool', 's']]);
  });

  it('reasoning 线索每轮只发一次：done 后新一轮 reasoning 再发', () => {
    const { core, cues } = collect();
    core.handleEvent('s', { type: 'reasoning', text: 'a' });
    core.handleEvent('s', { type: 'done', finishReason: 'stop' });
    core.handleEvent('s', { type: 'reasoning', text: 'b' });
    expect(cues.filter(([e]) => e === 'chat.reasoning')).toHaveLength(2);
  });
});
