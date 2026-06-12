import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  startCursorPublisher,
  CURSOR_INTERVAL_MS,
  CURSOR_KEEPALIVE_MS,
} from '../electron/main/cursor-publisher';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('startCursorPublisher', () => {
  it('emits the first sample immediately, then only on change (within keepalive window)', () => {
    const sent: Array<{ x: number; y: number }> = [];
    let cursor = { x: 10, y: 20 };
    const pub = startCursorPublisher({ getCursor: () => cursor, send: (p) => sent.push(p) });

    expect(sent).toEqual([{ x: 10, y: 20 }]); // 首拍必发（静止光标也要有初始朝向）

    vi.advanceTimersByTime(CURSOR_INTERVAL_MS * 3);
    expect(sent).toHaveLength(1); // 不动不发

    cursor = { x: 11, y: 20 };
    vi.advanceTimersByTime(CURSOR_INTERVAL_MS);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual({ x: 11, y: 20 });
    pub.stop();
  });

  it('polls at ~30Hz', () => {
    expect(CURSOR_INTERVAL_MS).toBe(33);
  });

  it('re-sends a keepalive frame when idle >2s (renderer 崩溃自愈后能拿到朝向)', () => {
    const sent: Array<{ x: number; y: number }> = [];
    const cursor = { x: 7, y: 8 };
    const pub = startCursorPublisher({ getCursor: () => cursor, send: (p) => sent.push(p) });
    expect(sent).toHaveLength(1);
    vi.advanceTimersByTime(CURSOR_KEEPALIVE_MS + CURSOR_INTERVAL_MS * 2);
    expect(sent.length).toBeGreaterThanOrEqual(2); // 静止也周期重发
    expect(sent[sent.length - 1]).toEqual({ x: 7, y: 8 });
    pub.stop();
  });

  it('stop() halts polling', () => {
    const sent: unknown[] = [];
    let cursor = { x: 0, y: 0 };
    const pub = startCursorPublisher({ getCursor: () => cursor, send: (p) => sent.push(p) });
    pub.stop();
    cursor = { x: 5, y: 5 };
    vi.advanceTimersByTime(CURSOR_INTERVAL_MS * 5);
    expect(sent).toHaveLength(1); // 只剩首拍
  });

  it('swallows getCursor failures (e.g. screen API transient error)', () => {
    let throwing = true;
    const sent: unknown[] = [];
    const pub = startCursorPublisher({
      getCursor: () => {
        if (throwing) throw new Error('boom');
        return { x: 1, y: 1 };
      },
      send: (p) => sent.push(p),
    });
    expect(sent).toHaveLength(0); // 首拍失败被吞
    throwing = false;
    vi.advanceTimersByTime(CURSOR_INTERVAL_MS);
    expect(sent).toEqual([{ x: 1, y: 1 }]);
    pub.stop();
  });
});
