/**
 * 90s 主动行为的 Main 侧决策 —— M4 是 stub：从低幅动作池随机挑一个发回
 * character 窗口（回路端到端打通且肉眼可见）。tech-design §7 的完整语义
 * （ConversationCore 决策是否说话）依赖 Persona/记忆，M6+ 在此处替换实现。
 */
export const IDLE_ACTION_POOL = ['stretch', 'sigh', 'tilt'] as const;

export interface IdleResponder {
  onIdleTimeout(idleMs: number): void;
}

export function createIdleResponder(
  sendToCharacter: (channel: string, params: unknown) => void,
  rand: () => number = Math.random,
): IdleResponder {
  return {
    onIdleTimeout(_idleMs: number): void {
      const name = IDLE_ACTION_POOL[Math.floor(rand() * IDLE_ACTION_POOL.length)]!;
      sendToCharacter('behavior.playAction', { name, durationMs: null });
    },
  };
}
