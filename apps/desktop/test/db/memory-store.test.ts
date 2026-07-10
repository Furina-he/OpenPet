import { describe, it, expect } from 'vitest';
import { MemoryStore } from '../../electron/main/db/memory-store.js';
import { DEFAULT_PERSONA_STATE } from '@openpet/protocol';

describe('MemoryStore', () => {
  it('appends and reads back recent messages in ts order', () => {
    const s = new MemoryStore();
    s.appendMessage({ characterId: 'c', sessionId: 's', role: 'user', text: 'hi', ts: 1 });
    s.appendMessage({
      characterId: 'c',
      sessionId: 's',
      role: 'assistant',
      text: 'yo',
      ts: 2,
      finishReason: 'stop',
    });
    const rows = s.recentMessages('c', 's', 10);
    expect(rows.map((r) => r.text)).toEqual(['hi', 'yo']);
    expect(rows[1]!.finishReason).toBe('stop');
  });

  it('isolates by character_id and session_id', () => {
    const s = new MemoryStore();
    s.appendMessage({ characterId: 'a', sessionId: 's', role: 'user', text: 'A', ts: 1 });
    s.appendMessage({ characterId: 'b', sessionId: 's', role: 'user', text: 'B', ts: 1 });
    s.appendMessage({ characterId: 'a', sessionId: 'other', role: 'user', text: 'A2', ts: 1 });
    expect(s.recentMessages('a', 's', 10).map((r) => r.text)).toEqual(['A']);
  });

  it('recentMessages returns only the last N (ts order preserved)', () => {
    const s = new MemoryStore();
    for (let i = 1; i <= 5; i++) {
      s.appendMessage({ characterId: 'c', sessionId: 's', role: 'user', text: `m${i}`, ts: i });
    }
    expect(s.recentMessages('c', 's', 2).map((r) => r.text)).toEqual(['m4', 'm5']);
  });

  it('persona state round-trips; null before first write', () => {
    const s = new MemoryStore();
    expect(s.getPersonaState('c')).toBeNull();
    s.putPersonaState('c', { ...DEFAULT_PERSONA_STATE, affinity: 60 }, 123);
    expect(s.getPersonaState('c')?.affinity).toBe(60);
  });

  it('storageUsage counts messages and distinct characters', () => {
    const s = new MemoryStore();
    s.appendMessage({ characterId: 'a', sessionId: 's', role: 'user', text: 'x', ts: 1 });
    s.appendMessage({ characterId: 'b', sessionId: 's', role: 'user', text: 'y', ts: 1 });
    const u = s.storageUsage();
    expect(u.messageCount).toBe(2);
    expect(u.characterCount).toBe(2);
  });

  it('appendMessage returns a monotonically increasing id', () => {
    const s = new MemoryStore();
    const id1 = s.appendMessage({ characterId: 'c', sessionId: 's', role: 'user', text: 'a', ts: 1 });
    const id2 = s.appendMessage({ characterId: 'c', sessionId: 's', role: 'user', text: 'b', ts: 2 });
    expect(id2).toBeGreaterThan(id1);
  });

  it('批次⑥ clearMessages：清空全部消息（跨角色/会话）', () => {
    const s = new MemoryStore();
    s.appendMessage({ characterId: 'a', sessionId: 's', role: 'user', text: 'x', ts: 1 });
    s.appendMessage({ characterId: 'b', sessionId: 't', role: 'user', text: 'y', ts: 2 });
    s.clearMessages();
    expect(s.recentMessages('a', 's', 10)).toEqual([]);
    expect(s.recentMessages('b', 't', 10)).toEqual([]);
    expect(s.storageUsage().messageCount).toBe(0);
  });

  it('批次⑥ usageSummary：sinceTs 起聚合 assistant tokens 与条数（无 tokens/user 不计）', () => {
    const s = new MemoryStore();
    const base = { characterId: 'c', sessionId: 's', role: 'assistant' as const, finishReason: 'stop' as const };
    s.appendMessage({ ...base, text: 'early', ts: 50, tokensIn: 100, tokensOut: 10 }); // sinceTs 前
    s.appendMessage({ ...base, text: 'a', ts: 150, tokensIn: 7, tokensOut: 3 });
    s.appendMessage({ ...base, text: 'b', ts: 200, tokensIn: 5, tokensOut: 2 });
    s.appendMessage({ ...base, text: 'no-usage', ts: 250 }); // 无 tokens → 不计
    s.appendMessage({ characterId: 'c', sessionId: 's', role: 'user', text: 'u', ts: 260, tokensIn: 9, tokensOut: 9 }); // user → 不计
    expect(s.usageSummary(100)).toEqual({ tokensIn: 12, tokensOut: 5, messages: 2 });
  });
});

describe('总览统计查询（spec 2026-07-09）', () => {
  const TZ = 8 * 3_600_000; // 东八区
  const DAY = 86_400_000;
  const t1 = Date.UTC(2026, 6, 8, 2); // 本地 07-08 10:00
  const t2 = Date.UTC(2026, 6, 8, 3);
  const t3 = Date.UTC(2026, 6, 9, 2); // 本地 07-09 10:00
  function seed(store: MemoryStore): void {
    store.appendMessage({ characterId: 'c', sessionId: 's', role: 'user', text: 'q1', ts: t1 });
    store.appendMessage({ characterId: 'c', sessionId: 's', role: 'assistant', text: 'a1', ts: t2,
      finishReason: 'stop', tokensIn: 100, tokensOut: 20, model: 'gpt-4o' });
    store.appendMessage({ characterId: 'c', sessionId: 'im:qq:x', role: 'assistant', text: 'a2', ts: t3,
      finishReason: 'stop', tokensIn: 50, tokensOut: 10, model: 'deepseek-v3' });
  }
  it('count/firstTs/series/tokensByModel/tokenSeries 全链路', () => {
    const store = new MemoryStore();
    expect(store.statsFirstMessageTs()).toBeNull();
    expect(store.statsMessageCount(0)).toBe(0);
    expect(store.statsMessageSeries(0, DAY, TZ)).toEqual([]);
    seed(store);
    expect(store.statsFirstMessageTs()).toBe(t1);
    expect(store.statsMessageCount(0)).toBe(3);
    expect(store.statsMessageCount(Date.UTC(2026, 6, 9, 0))).toBe(1);
    // 天桶：本地日界（bucket = floor((ts+tz)/DAY)*DAY - tz）
    const b0 = Math.floor((t1 + TZ) / DAY) * DAY - TZ;
    expect(store.statsMessageSeries(0, DAY, TZ)).toEqual([[b0, 2], [b0 + DAY, 1]]);
    expect(store.statsTokensByModel(0)).toEqual([
      { model: 'gpt-4o', tokens: 120 },
      { model: 'deepseek-v3', tokens: 60 },
    ]);
    const series = store.statsTokenSeriesByModel(0, DAY, TZ);
    expect(series).toContainEqual({ model: 'gpt-4o', points: [[b0, 120]] });
    expect(series).toContainEqual({ model: 'deepseek-v3', points: [[b0 + DAY, 60]] });
  });
});

describe('会话管理查询（spec 2026-07-09-session-management）', () => {
  function seed(s: MemoryStore): void {
    s.appendMessage({ characterId: 'c', sessionId: 'a', role: 'user', text: '第一句话题', ts: 10 });
    s.appendMessage({ characterId: 'c', sessionId: 'a', role: 'assistant', text: '回A', ts: 20, finishReason: 'stop' });
    s.appendMessage({ characterId: 'c', sessionId: 'b', role: 'user', text: 'B首句', ts: 30 });
    s.appendMessage({ characterId: 'other', sessionId: 'z', role: 'user', text: '别的角色', ts: 40 });
  }
  it('sessionList：角色隔离/计数/末句/首句/排序（pinned 优先再 lastTs 降序）', () => {
    const s = new MemoryStore();
    expect(s.sessionList('c')).toEqual([]);
    seed(s);
    let list = s.sessionList('c');
    expect(list.map((x) => x.id)).toEqual(['b', 'a']); // lastTs 降序
    expect(list[1]).toEqual({
      id: 'a', title: null, pinned: false,
      lastText: '回A', lastTs: 20, count: 2, firstUserText: '第一句话题',
    });
    s.sessionSetPinned('a', 'c', true);
    list = s.sessionList('c');
    expect(list.map((x) => x.id)).toEqual(['a', 'b']); // pinned 优先
    expect(list[0]!.pinned).toBe(true);
  });
  it('sessionSetTitle 与 SetPinned 互不覆盖；sessionDelete 清消息+meta；sessionMessages 升序全量', () => {
    const s = new MemoryStore();
    seed(s);
    s.sessionSetPinned('a', 'c', true);
    s.sessionSetTitle('a', 'c', '改过的名');
    const a = s.sessionList('c').find((x) => x.id === 'a')!;
    expect(a.title).toBe('改过的名');
    expect(a.pinned).toBe(true); // rename 不冲掉 pinned
    expect(s.sessionMessages('c', 'a').map((m) => m.text)).toEqual(['第一句话题', '回A']);
    s.sessionDelete('a');
    expect(s.sessionList('c').map((x) => x.id)).toEqual(['b']);
    expect(s.sessionMessages('c', 'a')).toEqual([]);
  });
});
