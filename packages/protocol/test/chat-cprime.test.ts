import { describe, it, expect } from 'vitest';
import { ChatEventSchema } from '../src/schemas.js';
import { Methods } from '../src/methods.js';

describe('ChatEvent reasoning（C′）', () => {
  it('接受 reasoning 变体', () => {
    expect(ChatEventSchema.safeParse({ type: 'reasoning', text: '思考…' }).success).toBe(true);
  });
});

describe('chat 通知方法（C′）', () => {
  it('注册 chat.reasoning / chat.toolCall', () => {
    expect('chat.reasoning' in Methods).toBe(true);
    expect('chat.toolCall' in Methods).toBe(true);
    expect(Methods['chat.toolCall'].params.safeParse({
      sessionId: 's',
      call: { id: 'c1', name: 'web', phase: 'pending' },
    }).success).toBe(true);
  });

  // 与通知/broadcast 一致：chat.reasoning 是即发即弃的推理流，无快照重放/去重消费者
  // （不同于 chat.stream），故 params 不带 seq —— schema ↔ Notification ↔ renderer on() 三处对齐。
  it('chat.reasoning params = {sessionId, text}（无 seq）', () => {
    expect(Methods['chat.reasoning'].params.safeParse({ sessionId: 's', text: '想' }).success).toBe(
      true,
    );
  });
});
