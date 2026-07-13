import { describe, it, expect } from 'vitest';
import {
  bubbleSegments,
  ChatView,
  explodeSegments,
  isEmptyReply,
} from '../src/renderer/overlay/chat-view';

const S = 'default';

function make(): { view: ChatView; changes: () => number } {
  let n = 0;
  const view = new ChatView(S, () => n++);
  return { view, changes: () => n };
}

describe('ChatView · 快照重建', () => {
  it('buffers events until the snapshot lands, then drops duplicates by seq', () => {
    const { view } = make();
    // 快照在途时陆续到达的流事件：seq 1-2 已含在快照文本中，3 是新增量
    view.onStream({ sessionId: S, text: 'a', seq: 1 });
    view.onStream({ sessionId: S, text: 'b', seq: 2 });
    view.onStream({ sessionId: S, text: 'c', seq: 3 });
    expect(view.messages).toEqual([]); // 未同步前不渲染
    view.applySnapshot({
      sessionId: S,
      messages: [
        { role: 'user', text: 'hi', finishReason: null },
        { role: 'assistant', text: 'ab', finishReason: null },
      ],
      streaming: true,
      seq: 2,
    });
    expect(view.messages).toEqual([
      { role: 'user', text: 'hi', finishReason: null },
      { role: 'assistant', text: 'abc', finishReason: null }, // c 重放，ab 不重复
    ]);
    expect(view.streaming).toBe(true);
    expect(view.ready).toBe(true);
  });

  it('replays a buffered done after the snapshot', () => {
    const { view } = make();
    view.onStream({ sessionId: S, text: 'x', seq: 1 });
    view.onDone({ sessionId: S, finishReason: 'stop' });
    view.applySnapshot({
      sessionId: S,
      messages: [{ role: 'assistant', text: 'x', finishReason: null }],
      streaming: true,
      seq: 1,
    });
    expect(view.messages).toEqual([{ role: 'assistant', text: 'x', finishReason: 'stop' }]);
    expect(view.streaming).toBe(false);
  });

  it('applies an empty snapshot (fresh install) and goes live', () => {
    const { view } = make();
    view.applySnapshot({ sessionId: S, messages: [], streaming: false, seq: 0 });
    view.onStream({ sessionId: S, text: 'live', seq: 1 });
    expect(view.messages).toEqual([{ role: 'assistant', text: 'live', finishReason: null }]); // 防御性开消息
  });
});

describe('ChatView · 实时流', () => {
  function live(): { view: ChatView; changes: () => number } {
    const m = make();
    m.view.applySnapshot({ sessionId: S, messages: [], streaming: false, seq: 0 });
    return m;
  }

  it('echoUser appends user + assistant placeholder; stream fills the placeholder', () => {
    const { view } = live();
    view.echoUser('你好');
    expect(view.messages).toEqual([
      { role: 'user', text: '你好', finishReason: null },
      { role: 'assistant', text: '', finishReason: null },
    ]);
    expect(view.streaming).toBe(true);
    view.onStream({ sessionId: S, text: '嗯', seq: 1 });
    view.onStream({ sessionId: S, text: '…', seq: 2 });
    expect(view.messages[1]!.text).toBe('嗯…');
  });

  it('rollbackEcho removes the optimistic pair on send failure', () => {
    const { view } = live();
    view.echoUser('fail');
    view.rollbackEcho();
    expect(view.messages).toEqual([]);
    expect(view.streaming).toBe(false);
  });

  it('done seals the open assistant message and stops streaming', () => {
    const { view } = live();
    view.echoUser('hi');
    view.onStream({ sessionId: S, text: 'r', seq: 1 });
    view.onDone({ sessionId: S, finishReason: 'cancel' });
    expect(view.messages[1]).toEqual({ role: 'assistant', text: 'r', finishReason: 'cancel' });
    expect(view.streaming).toBe(false);
  });

  it('ignores events from other sessions', () => {
    const { view } = live();
    view.onStream({ sessionId: 'other', text: 'x', seq: 1 });
    view.onDone({ sessionId: 'other', finishReason: 'stop' });
    expect(view.messages).toEqual([]);
  });

  it('notifies onChange for every visible mutation', () => {
    const { view, changes } = live();
    const before = changes();
    view.echoUser('hi');
    view.onStream({ sessionId: S, text: 'a', seq: 1 });
    view.onDone({ sessionId: S, finishReason: 'stop' });
    expect(changes()).toBe(before + 3);
  });
});

describe('isEmptyReply（上游空回复防御，2026-07-09 真窗反馈）', () => {
  it('assistant + stop + 空文本 = 空回复；其余不是', () => {
    expect(isEmptyReply({ role: 'assistant', text: '', finishReason: 'stop' })).toBe(true);
    expect(isEmptyReply({ role: 'assistant', text: '  \n', finishReason: 'stop' })).toBe(true);
    expect(isEmptyReply({ role: 'assistant', text: 'hi', finishReason: 'stop' })).toBe(false);
    expect(isEmptyReply({ role: 'assistant', text: '', finishReason: null })).toBe(false); // 流中
    expect(isEmptyReply({ role: 'assistant', text: '', finishReason: 'error' })).toBe(false); // 走错误台词
    expect(isEmptyReply({ role: 'user', text: '', finishReason: 'stop' })).toBe(false);
  });
});

describe('⑭ 气泡分段显示（newBubble，display-only）', () => {
  function live(): ChatView {
    const view = new ChatView(S, () => {});
    view.applySnapshot({ sessionId: S, messages: [], streaming: false, seq: 0 });
    return view;
  }

  it('连续 stream 无标记合并一段；带 newBubble 开新段', () => {
    const view = live();
    view.echoUser('hi');
    view.onStream({ sessionId: S, text: '你来啦！', seq: 1 });
    expect(view.messages[1]!.splits).toBeUndefined(); // 无标记不生分段点
    view.onStream({ sessionId: S, text: '今天怎么样？', seq: 2, newBubble: true });
    view.onStream({ sessionId: S, text: '还好吗？', seq: 3, newBubble: true });
    const m = view.messages[1]!;
    expect(m.text).toBe('你来啦！今天怎么样？还好吗？'); // 存储侧仍单条完整
    expect(bubbleSegments(m)).toEqual(['你来啦！', '今天怎么样？', '还好吗？']);
  });

  it('done 后段结构冻结；explodeSegments 前段视为完成、末段继承收尾', () => {
    const view = live();
    view.echoUser('hi');
    view.onStream({ sessionId: S, text: '第一段。', seq: 1 });
    view.onStream({ sessionId: S, text: '第二段。', seq: 2, newBubble: true });
    view.onDone({ sessionId: S, finishReason: 'stop' });
    const m = view.messages[1]!;
    expect(bubbleSegments(m)).toEqual(['第一段。', '第二段。']); // done 不动分段
    const shown = explodeSegments(view.messages);
    expect(shown).toHaveLength(3); // user + 2 段
    expect(shown[1]).toMatchObject({ role: 'assistant', text: '第一段。', finishReason: 'stop' });
    expect(shown[2]).toMatchObject({ role: 'assistant', text: '第二段。', finishReason: 'stop' });
  });

  it('占位空文本时的 newBubble 不生分段点；无分段消息 explode 原样透传', () => {
    const view = live();
    view.echoUser('hi');
    view.onStream({ sessionId: S, text: '首段即新段', seq: 1, newBubble: true });
    expect(view.messages[1]!.splits).toBeUndefined();
    expect(explodeSegments(view.messages)).toEqual(view.messages); // 引用透传（情绪 chip 判定依赖）
  });
});
