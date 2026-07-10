import { describe, it, expect } from 'vitest';
import { createIdleResponder } from '../electron/main/idle-responder';

describe('createIdleResponder', () => {
  it('转发 idle 上报为领域事件（决策全在 InteractionService）', () => {
    let calls = 0;
    const responder = createIdleResponder(() => {
      calls += 1;
    });
    responder.onIdleTimeout(90_000);
    responder.onIdleTimeout(90_000);
    expect(calls).toBe(2);
  });
});
