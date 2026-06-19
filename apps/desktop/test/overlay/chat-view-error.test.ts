import { describe, it, expect } from 'vitest';
import { ChatView } from '../../src/renderer/overlay/chat-view';

function viewReady(): ChatView {
  const v = new ChatView('default', () => {});
  v.applySnapshot({ sessionId: 'default', messages: [], streaming: false, seq: 0 });
  return v;
}

describe('ChatView 捕获 errorKind（J3）', () => {
  it('done(error, errorKind) 写到末条 assistant', () => {
    const v = viewReady();
    v.echoUser('在吗');
    v.onStream({ sessionId: 'default', text: '', seq: 1 });
    v.onDone({ sessionId: 'default', finishReason: 'error', errorKind: 'auth' });
    const last = v.messages.at(-1)!;
    expect(last.finishReason).toBe('error');
    expect(last.errorKind).toBe('auth');
  });
  it('done(stop) 不带 errorKind', () => {
    const v = viewReady();
    v.echoUser('hi');
    v.onStream({ sessionId: 'default', text: '你好', seq: 1 });
    v.onDone({ sessionId: 'default', finishReason: 'stop' });
    expect(v.messages.at(-1)!.errorKind).toBeUndefined();
  });
});
