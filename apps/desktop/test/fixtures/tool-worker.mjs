import { parentPort } from 'node:worker_threads';

// 第一次 start（无 tool 消息）：吐 tool_call 'echo' 然后 done(stop)。
// 第二次 start（request.messages 末尾含 role:'tool'）：把 tool 结果作为 delta 吐回。
parentPort.on('message', (m) => {
  if (m.kind !== 'chat.start') return;
  const { requestId, sessionId } = m;
  const messages = m.request?.messages ?? [];
  const hasToolMsg = messages.some((x) => x.role === 'tool');
  if (!hasToolMsg) {
    parentPort.postMessage({
      kind: 'chat.event',
      requestId,
      sessionId,
      event: { type: 'tool_call', id: 't1', name: 'echo', args: { v: 42 } },
    });
    parentPort.postMessage({
      kind: 'chat.event',
      requestId,
      sessionId,
      event: { type: 'done', finishReason: 'stop' },
    });
  } else {
    const toolMsg = messages.filter((x) => x.role === 'tool').at(-1);
    // §5：把回灌请求尾部两条消息回吐（供测试断言 assistant(tool_calls)+tool 规范序列）。
    const tail = messages.slice(-2);
    parentPort.postMessage({
      kind: 'chat.event',
      requestId,
      sessionId,
      event: {
        type: 'delta',
        text: 'result=' + toolMsg.content + '|tail=' + JSON.stringify(tail),
      },
    });
    parentPort.postMessage({
      kind: 'chat.event',
      requestId,
      sessionId,
      event: { type: 'done', finishReason: 'stop' },
    });
  }
});
