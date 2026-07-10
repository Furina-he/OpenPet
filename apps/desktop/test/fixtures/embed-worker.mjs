import { parentPort } from 'node:worker_threads';

// 测试用 embed worker：收 embed.request → 回 embed.result。
// 特殊输入：含 '__error__' → 回 embed.error；含 '__hang__' → 不回复（验证超时）。
// 正常：每条输入映射成 [文本长度, model 长度]，便于断言。
parentPort.on('message', (m) => {
  if (m.kind !== 'embed.request') return;
  if (m.inputs.includes('__error__')) {
    parentPort.postMessage({
      kind: 'embed.error',
      requestId: m.requestId,
      message: 'boom',
      errorKind: 'network',
    });
    return;
  }
  if (m.inputs.includes('__hang__')) return; // 永不回复 → 触发超时
  const vectors = m.inputs.map((s) => [s.length, m.model.length]);
  parentPort.postMessage({ kind: 'embed.result', requestId: m.requestId, vectors });
});
