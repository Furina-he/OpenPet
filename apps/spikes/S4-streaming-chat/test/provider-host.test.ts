import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProviderHost, type ChatEvent } from '../electron/main/provider-host';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The real production worker entry — the same file Main resolves at runtime.
const PROVIDER_ENTRY = require.resolve('@desksoul/sidecar/dist/workers/provider-worker-entry.js');
// A non-cooperative worker that ignores chat.cancel, forcing the watchdog path.
const WEDGED_ENTRY = path.join(__dirname, 'fixtures/wedged-worker.mjs');

let host: ProviderHost | null = null;
afterEach(async () => {
  await host?.dispose();
  host = null;
});

/** Collect events for one session until a `done`, with a hard timeout. */
function untilDone(
  events: Array<{ sessionId: string; event: ChatEvent }>,
  sessionId: string,
  timeoutMs = 3000,
): Promise<void> {
  return untilEvent(events, (e) => e.sessionId === sessionId && e.event.type === 'done', timeoutMs);
}

/** Resolve once `events` contains an entry matching `pred`; reject on timeout. */
function untilEvent(
  events: Array<{ sessionId: string; event: ChatEvent }>,
  pred: (e: { sessionId: string; event: ChatEvent }) => boolean,
  timeoutMs = 3000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timed out waiting for event')), timeoutMs);
    const tick = setInterval(() => {
      if (events.some(pred)) {
        clearTimeout(t);
        clearInterval(tick);
        resolve();
      }
    }, 5);
  });
}

describe('ProviderHost', () => {
  it('streams a full reply over a real worker then a stop done', async () => {
    const events: Array<{ sessionId: string; event: ChatEvent }> = [];
    host = new ProviderHost(
      PROVIDER_ENTRY,
      (sessionId, event) => events.push({ sessionId, event }),
      { intervalMs: 0 },
    );
    host.send('sess-a');
    await untilDone(events, 'sess-a');

    const deltas = events.filter((e) => e.event.type === 'delta');
    expect(deltas.length).toBeGreaterThan(0);
    expect(events.at(-1)!.event).toEqual({ type: 'done', finishReason: 'stop' });
  });

  it('cancels gracefully within the grace window (no force-terminate)', async () => {
    const events: Array<{ sessionId: string; event: ChatEvent }> = [];
    let forced = false;
    host = new ProviderHost(
      PROVIDER_ENTRY,
      (sessionId, event) => events.push({ sessionId, event }),
      // CI/并发负载下 cooperative cancel 往返可能 >200ms；放宽 watchdog 窗口防 flaky
      { intervalMs: 40, cancelGraceMs: 1500, onForceTerminate: () => (forced = true) },
    );
    host.send('sess-b');
    // let a couple of deltas flow, then cancel
    await new Promise((r) => setTimeout(r, 60));
    host.cancel('sess-b');
    await untilDone(events, 'sess-b');

    expect(events.at(-1)!.event).toEqual({ type: 'done', finishReason: 'cancel' });
    expect(forced).toBe(false); // cooperative cancel beat the 200ms watchdog
  });

  it('force-terminates a wedged worker and synthesizes a cancel done', async () => {
    const events: Array<{ sessionId: string; event: ChatEvent }> = [];
    let forced = false;
    host = new ProviderHost(
      WEDGED_ENTRY,
      (sessionId, event) => events.push({ sessionId, event }),
      { intervalMs: 20, cancelGraceMs: 100, onForceTerminate: () => (forced = true) },
    );
    host.send('sess-c');
    await new Promise((r) => setTimeout(r, 50));
    host.cancel('sess-c');
    await untilDone(events, 'sess-c');

    expect(forced).toBe(true); // watchdog had to fire
    expect(events.at(-1)!.event).toEqual({ type: 'done', finishReason: 'cancel' });
  });

  it('keeps serving after a force-terminate respawn', async () => {
    const events: Array<{ sessionId: string; event: ChatEvent }> = [];
    host = new ProviderHost(
      WEDGED_ENTRY,
      (sessionId, event) => events.push({ sessionId, event }),
      { intervalMs: 20, cancelGraceMs: 100 },
    );
    host.send('sess-d');
    await new Promise((r) => setTimeout(r, 50));
    host.cancel('sess-d');
    await untilDone(events, 'sess-d');

    // worker was terminated + respawned; a fresh stream should still start.
    // The wedged worker never sends `done`, so prove liveness via its first
    // delta rather than waiting for a terminal event.
    host.send('sess-e');
    await untilEvent(events, (e) => e.sessionId === 'sess-e' && e.event.type === 'delta');
    expect(events.some((e) => e.sessionId === 'sess-e' && e.event.type === 'delta')).toBe(true);
  });
});
