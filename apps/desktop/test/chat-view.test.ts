import { describe, it, expect } from 'vitest';
import { ChatView } from '../src/renderer/overlay/chat-view';

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
