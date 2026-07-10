/**
 * 90s 空闲上报的 Main 侧转发 —— 决策全部在 InteractionService（cue 表 idle.timeout：
 * mood 偏置动作池 + proactiveFreq/DND 策略门），本文件只是 RPC → 领域事件的薄转发。
 */
export interface IdleResponder {
  onIdleTimeout(idleMs: number): void;
}

export function createIdleResponder(onIdle: () => void): IdleResponder {
  return {
    onIdleTimeout(_idleMs: number): void {
      onIdle();
    },
  };
}
