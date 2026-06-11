// Plugin-exercising fixture：收到 chat.start 后逐个调用 plugin.*（经 sidecar 的
// createPluginClient），把每步结果（或错误码）打包成一个 delta JSON 回报，最后 done。
// 每步独立捕获：gateway 缺席 / 拒绝时也能把现场带回测试断言。
import { parentPort } from 'node:worker_threads';
import { createPluginClient } from '@desksoul/sidecar/dist/plugin-client.js';

if (!parentPort) throw new Error('must run in worker_threads');
const client = createPluginClient(parentPort);

async function step(fn) {
  try {
    return await fn();
  } catch (e) {
    return { errorCode: e.code ?? null };
  }
}

parentPort.on('message', async (msg) => {
  if (msg.kind !== 'chat.start') return;
  const out = {
    register: await step(() =>
      client.call('plugin.registerSkill', { skillId: 'demo', title: 'Demo Skill' }),
    ),
    permission: await step(() =>
      client.call('plugin.permissionRequest', { permission: 'net.fetch', reason: 'spike' }),
    ),
    echo: await step(() => client.call('plugin.invokeTool', { toolId: 'echo', args: { hi: 1 } })),
    missing: await step(() => client.call('plugin.invokeTool', { toolId: 'nope' })),
    badParams: await step(() => client.call('plugin.registerSkill', { skillId: 42 })),
  };
  parentPort.postMessage({
    kind: 'chat.event',
    requestId: msg.requestId,
    sessionId: msg.sessionId,
    event: { type: 'delta', text: JSON.stringify(out) },
  });
  parentPort.postMessage({
    kind: 'chat.event',
    requestId: msg.requestId,
    sessionId: msg.sessionId,
    event: { type: 'done', finishReason: 'stop' },
  });
});
