import { parentPort } from 'node:worker_threads';

// 收到 chat.start 后立刻崩溃（不发任何 delta）——模拟 provider worker 在首 delta 前
// 意外死亡。配合降级链验证：onDeath 清算里触发的「降级 re-send」遇到 worker 已死
// 不能抛出未捕获异常，否则会打断 ProviderHost.onDeath 的重生调度 + 让本 session 永挂。
parentPort.on('message', (m) => {
  if (m.kind === 'chat.start') process.exit(1);
});
