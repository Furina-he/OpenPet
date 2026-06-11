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
    store = new SessionStore(join(testDir, 'sessions.json'));
  });

  afterEach(() => {
    store.dispose();
    rmSync(testDir, { recursive: true, force: true });
  });

  it('records user message', () => {
    const seq = store.appendUser('sess1', 'Hello');
    expect(seq).toBe(1);
    const snap = store.snapshot('sess1');
    expect(snap.messages).toHaveLength(1);
    expect(snap.messages[0]).toMatchObject({ role: 'user', content: 'Hello', seq: 1 });
    expect(snap.streaming).toBe(false);
  });

  it('accumulates deltas, seals on finish', () => {
    store.appendUser('sess1', 'Hi');
    const seq1 = store.beginAssistant('sess1');
    expect(seq1).toBe(2);
    store.appendDelta('sess1', 'Hel');
    store.appendDelta('sess1', 'lo');
    const snap1 = store.snapshot('sess1');
    expect(snap1.streaming).toBe(true);
    expect(snap1.messages).toHaveLength(2);
    expect(snap1.messages[1]).toMatchObject({ role: 'assistant', content: 'Hello', seq: 2 });

    store.finishAssistant('sess1');
    const snap2 = store.snapshot('sess1');
    expect(snap2.streaming).toBe(false);
    expect(snap2.messages[1]).toMatchObject({ role: 'assistant', content: 'Hello', seq: 2 });
  });

  it('snapshot reports streaming=true with the unsealed partial message', () => {
    store.appendUser('sess1', 'Test');
    store.beginAssistant('sess1');
    store.appendDelta('sess1', 'Par');
    const snap = store.snapshot('sess1');
    expect(snap.streaming).toBe(true);
    expect(snap.messages[1].content).toBe('Par');
  });

  it('snapshot limit keeps only the most recent N messages', () => {
    store.appendUser('sess1', 'msg1');
    store.beginAssistant('sess1');
    store.finishAssistant('sess1');
    store.appendUser('sess1', 'msg2');
    store.beginAssistant('sess1');
    store.finishAssistant('sess1');
    store.appendUser('sess1', 'msg3');

    const snap = store.snapshot('sess1', 3);
    expect(snap.messages).toHaveLength(3);
    expect(snap.messages.map((m) => m.seq)).toEqual([3, 4, 5]);
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
    expect(snap1.messages[0].seq).toBe(1);
    expect(snap2.messages[0].seq).toBe(1);
    expect(snap1.messages[0].content).toBe('A');
    expect(snap2.messages[0].content).toBe('B');
  });

  it('defensively opens an assistant message when a delta arrives without begin', () => {
    store.appendUser('sess1', 'Hi');
    store.appendDelta('sess1', 'Auto');
    const snap = store.snapshot('sess1');
    expect(snap.messages).toHaveLength(2);
    expect(snap.messages[1]).toMatchObject({ role: 'assistant', content: 'Auto', seq: 2 });
    expect(snap.streaming).toBe(true);
  });

  it('snapshot returns copies — mutating them does not corrupt the store', () => {
    store.appendUser('sess1', 'Original');
    const snap1 = store.snapshot('sess1');
    snap1.messages[0].content = 'Mutated';
    const snap2 = store.snapshot('sess1');
    expect(snap2.messages[0].content).toBe('Original');
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
    const store1 = new SessionStore(persistPath);
    store1.appendUser('sess1', 'Persisted');
    store1.beginAssistant('sess1');
    store1.finishAssistant('sess1');

    await new Promise((resolve) => setTimeout(resolve, 600));
    store1.dispose();

    const store2 = new SessionStore(persistPath);
    const snap = store2.snapshot('sess1');
    expect(snap.messages).toHaveLength(2);
    expect(snap.messages[0].content).toBe('Persisted');
    store2.dispose();
  });

  it('dispose flushes pending writes synchronously', () => {
    const store = new SessionStore(persistPath);
    store.appendUser('sess1', 'Flush');
    store.dispose();

    const raw = readFileSync(persistPath, 'utf8');
    const data = JSON.parse(raw);
    expect(data.sessions.sess1.messages[0].content).toBe('Flush');
  });

  it('seals a persisted unsealed assistant message as error on load', () => {
    const corrupt = {
      version: 1,
      sessions: {
        sess1: {
          nextSeq: 3,
          messages: [
            { role: 'user', content: 'Hi', seq: 1 },
            { role: 'assistant', content: 'Partial', seq: 2, sealed: false },
          ],
        },
      },
    };
    mkdirSync(testDir, { recursive: true });
    writeFileSync(persistPath, JSON.stringify(corrupt), 'utf8');

    const store = new SessionStore(persistPath);
    const snap = store.snapshot('sess1');
    expect(snap.messages[1]).toMatchObject({
      role: 'assistant',
      content: '[流式中断]',
      seq: 2,
    });
    expect(snap.streaming).toBe(false);
    store.dispose();
  });

  it('ignores a corrupt persist file and starts empty', () => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(persistPath, 'not json', 'utf8');

    const store = new SessionStore(persistPath);
    const snap = store.snapshot('anySess');
    expect(snap.messages).toEqual([]);
    store.dispose();
  });

  it('missing file means first boot — no throw', () => {
    const store = new SessionStore(join(testDir, 'nonexistent.json'));
    const snap = store.snapshot('sess1');
    expect(snap.messages).toEqual([]);
    store.dispose();
  });
});
