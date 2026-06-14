import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionStore } from '../electron/main/session-store.js';

describe('SessionStore - 会话记录', () => {
  let store: SessionStore;
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'session-store-test-'));
    store = new SessionStore({ persistPath: join(testDir, 'sessions.json') });
  });

  afterEach(() => {
    store.dispose();
    rmSync(testDir, { recursive: true, force: true });
  });

  it('records user message', () => {
    store.appendUser('sess1', 'Hello');
    const snap = store.snapshot('sess1');
    expect(snap.messages).toHaveLength(1);
    expect(snap.messages[0]).toMatchObject({ role: 'user', text: 'Hello', finishReason: null });
    expect(snap.streaming).toBe(false);
    expect(snap.seq).toBe(0);
  });

  it('accumulates deltas, seals on finish', () => {
    store.appendUser('sess1', 'Hi');
    store.beginAssistant('sess1');
    const seq1 = store.appendDelta('sess1', 'Hel');
    expect(seq1).toBe(1);
    store.appendDelta('sess1', 'lo');
    const snap1 = store.snapshot('sess1');
    expect(snap1.streaming).toBe(true);
    expect(snap1.messages).toHaveLength(2);
    expect(snap1.messages[1]).toMatchObject({ role: 'assistant', text: 'Hello', finishReason: null });

    store.finishAssistant('sess1', 'stop');
    const snap2 = store.snapshot('sess1');
    expect(snap2.streaming).toBe(false);
    expect(snap2.messages[1]).toMatchObject({ role: 'assistant', text: 'Hello', finishReason: 'stop' });
  });

  it('snapshot reports streaming=true with the unsealed partial message', () => {
    store.appendUser('sess1', 'Test');
    store.beginAssistant('sess1');
    store.appendDelta('sess1', 'Par');
    const snap = store.snapshot('sess1');
    expect(snap.streaming).toBe(true);
    expect(snap.messages[1].text).toBe('Par');
  });

  it('snapshot limit keeps only the most recent N messages', () => {
    store.appendUser('sess1', 'msg1');
    store.beginAssistant('sess1');
    store.finishAssistant('sess1', 'stop');
    store.appendUser('sess1', 'msg2');
    store.beginAssistant('sess1');
    store.finishAssistant('sess1', 'stop');
    store.appendUser('sess1', 'msg3');

    const snap = store.snapshot('sess1', 3);
    expect(snap.messages).toHaveLength(3);
  });

  it('snapshot of an unknown session is empty, not an error', () => {
    const snap = store.snapshot('unknown');
    expect(snap.messages).toEqual([]);
    expect(snap.streaming).toBe(false);
  });

  it('keeps sessions independent (seq and messages)', () => {
    store.appendUser('sess1', 'A');
    store.appendUser('sess2', 'B');
    const snap1 = store.snapshot('sess1');
    const snap2 = store.snapshot('sess2');
    expect(snap1.messages[0].text).toBe('A');
    expect(snap2.messages[0].text).toBe('B');
  });

  it('defensively opens an assistant message when a delta arrives without begin', () => {
    store.appendUser('sess1', 'Hi');
    store.appendDelta('sess1', 'Auto');
    const snap = store.snapshot('sess1');
    expect(snap.messages).toHaveLength(2);
    expect(snap.messages[1]).toMatchObject({ role: 'assistant', text: 'Auto', finishReason: null });
    expect(snap.streaming).toBe(true);
  });

  it('snapshot returns copies — mutating them does not corrupt the store', () => {
    store.appendUser('sess1', 'Original');
    const snap1 = store.snapshot('sess1');
    snap1.messages[0].text = 'Mutated';
    const snap2 = store.snapshot('sess1');
    expect(snap2.messages[0].text).toBe('Original');
  });

  it('recordUsage writes tokens onto the current assistant message', () => {
    store.appendUser('sess1', 'hi');
    store.beginAssistant('sess1');
    store.appendDelta('sess1', 'yo');
    store.recordUsage('sess1', 3, 2);
    store.finishAssistant('sess1', 'stop');
    const assistant = store.snapshot('sess1').messages.at(-1)!;
    expect(assistant.tokensIn).toBe(3);
    expect(assistant.tokensOut).toBe(2);
  });
});

describe('SessionStore - JSON 持久化', () => {
  let testDir: string;
  let persistPath: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'session-store-persist-'));
    persistPath = join(testDir, 'sessions.json');
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('persists after the throttle delay and reloads in a fresh instance', async () => {
    const store1 = new SessionStore({ persistPath, persistDelayMs: 500 });
    store1.appendUser('sess1', 'Persisted');
    store1.beginAssistant('sess1');
    store1.finishAssistant('sess1', 'stop');

    await new Promise((resolve) => setTimeout(resolve, 600));
    store1.dispose();

    const store2 = new SessionStore({ persistPath });
    const snap = store2.snapshot('sess1');
    expect(snap.messages).toHaveLength(2);
    expect(snap.messages[0].text).toBe('Persisted');
    store2.dispose();
  });

  it('dispose flushes pending writes synchronously', () => {
    const store = new SessionStore({ persistPath });
    store.appendUser('sess1', 'Flush');
    store.dispose();

    const raw = readFileSync(persistPath, 'utf8');
    const data = JSON.parse(raw);
    expect(data.sessions.sess1[0].text).toBe('Flush');
  });

  it('seals a persisted unsealed assistant message as error on load', () => {
    const corrupt = {
      version: 1,
      sessions: {
        sess1: [
          { role: 'user', text: 'Hi', finishReason: null },
          { role: 'assistant', text: 'Partial', finishReason: null },
        ],
      },
    };
    mkdirSync(testDir, { recursive: true });
    writeFileSync(persistPath, JSON.stringify(corrupt), 'utf8');

    const store = new SessionStore({ persistPath });
    const snap = store.snapshot('sess1');
    expect(snap.messages[1]).toMatchObject({
      role: 'assistant',
      text: 'Partial',
      finishReason: 'error',
    });
    expect(snap.streaming).toBe(false);
    store.dispose();
  });

  it('ignores a corrupt persist file and starts empty', () => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(persistPath, 'not json', 'utf8');

    const store = new SessionStore({ persistPath });
    const snap = store.snapshot('anySess');
    expect(snap.messages).toEqual([]);
    store.dispose();
  });

  it('missing file means first boot — no throw', () => {
    const store = new SessionStore({ persistPath: join(testDir, 'nonexistent.json') });
    const snap = store.snapshot('sess1');
    expect(snap.messages).toEqual([]);
    store.dispose();
  });
});
