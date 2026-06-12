import { describe, it, expect } from 'vitest';
import { createIdleResponder, IDLE_ACTION_POOL } from '../electron/main/idle-responder';

describe('createIdleResponder', () => {
  it('broadcasts a low-key playAction picked from the pool', () => {
    const sent: Array<{ channel: string; params: unknown }> = [];
    const responder = createIdleResponder(
      (channel, params) => sent.push({ channel, params }),
      () => 0,
    );
    responder.onIdleTimeout(90_000);
    expect(sent).toEqual([
      {
        channel: 'behavior.playAction',
        params: { name: IDLE_ACTION_POOL[0], durationMs: null },
      },
    ]);
  });

  it('rand picks across the whole pool', () => {
    const names: string[] = [];
    const responder = createIdleResponder(
      (_c, params) => names.push((params as { name: string }).name),
      () => 0.999,
    );
    responder.onIdleTimeout(90_000);
    expect(names[0]).toBe(IDLE_ACTION_POOL[IDLE_ACTION_POOL.length - 1]);
  });

  it('pool only contains low-key actions', () => {
    expect(IDLE_ACTION_POOL).toEqual(['stretch', 'sigh', 'tilt']);
  });
});
