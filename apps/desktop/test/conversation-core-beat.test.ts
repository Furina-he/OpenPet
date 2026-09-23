import { describe, it, expect } from 'vitest';
import { ConversationCore, beatKindOf, type Notification } from '../electron/main/conversation-core.js';

const CFG = { enabled: true, charMs: 1, minMs: 1, maxMs: 5, rules: [] };

function core(sent: Notification[], cues: string[] = [], rhythm = true) {
  return new ConversationCore((n) => sent.push(n), {
    rhythm: () => (rhythm ? CFG : null),
    cue: (e) => cues.push(e),
  });
}
const beats = (sent: Notification[]) =>
  sent.filter((n) => n.channel === 'behavior.beat').map((n) => (n.params as { kind: string }).kind);

describe('⑱ beatKindOf', () => {
  it('？/! → question/exclaim；其余 period；收尾引号括号不影响', () => {
    expect(beatKindOf('真的吗？')).toBe('question');
    expect(beatKindOf('Really?')).toBe('question');
    expect(beatKindOf('太好了！')).toBe('exclaim');
    expect(beatKindOf('Yes!')).toBe('exclaim');
    expect(beatKindOf('嗯。')).toBe('period');
    expect(beatKindOf('没标点')).toBe('period');
    expect(beatKindOf('“真的吗？”')).toBe('question');
    expect(beatKindOf('（太棒了！）  ')).toBe('exclaim');
  });
});

describe('⑱ behavior.beat 节拍通知', () => {
  it('每段一拍、与段同序（段在前拍在后）；kind 按段尾标点', async () => {
    const sent: Notification[] = [];
    const c = core(sent);
    c.handleEvent('default', { type: 'delta', text: '你来啦！今天怎么样？我在等你。' });
    c.handleEvent('default', { type: 'done', finishReason: 'stop' });
    await new Promise((r) => setTimeout(r, 60));
    expect(beats(sent)).toEqual(['exclaim', 'question', 'period']);
    const idxStream = sent.findIndex((n) => n.channel === 'chat.stream');
    const idxBeat = sent.findIndex((n) => n.channel === 'behavior.beat');
    expect(idxBeat).toBe(idxStream + 1);
    expect(sent[sent.length - 1]!.channel).toBe('chat.done');
  });

  it('非 default 会话（im:/Hub 其它会话）不发拍；节奏关不发拍', () => {
    const sent: Notification[] = [];
    core(sent).handleEvent('im:qq:1', { type: 'delta', text: '好！' });
    expect(beats(sent)).toEqual([]);
    const off: Notification[] = [];
    core(off, [], false).handleEvent('default', { type: 'delta', text: '好！' });
    expect(beats(off)).toEqual([]);
  });

  it('beat.exclaim 领域事件每轮至多 1 次（mood 增量上限）；下一轮重新计', async () => {
    const sent: Notification[] = [];
    const cues: string[] = [];
    const c = core(sent, cues);
    c.handleEvent('default', { type: 'delta', text: '好！棒！赞！' });
    c.handleEvent('default', { type: 'done', finishReason: 'stop' });
    await new Promise((r) => setTimeout(r, 60));
    expect(beats(sent)).toEqual(['exclaim', 'exclaim', 'exclaim']);
    expect(cues.filter((e) => e === 'beat.exclaim')).toHaveLength(1);
    c.handleEvent('default', { type: 'delta', text: '又来！' });
    expect(cues.filter((e) => e === 'beat.exclaim')).toHaveLength(2);
  });
});
