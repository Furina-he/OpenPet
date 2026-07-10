import { describe, it, expect, vi } from 'vitest';
import {
  splitSessions,
  formatSessionTime,
  resolveActiveSession,
  newSessionId,
  UndoTimers,
  type SessionVm,
} from '../src/renderer/settings/history-view.js';

const s = (over: Partial<SessionVm>): SessionVm => ({
  id: 'x',
  title: 'T',
  pinned: false,
  lastText: 'l',
  lastTs: 0,
  count: 1,
  origin: 'desktop',
  ...over,
});

describe('history-view', () => {
  it('splitSessions：query 过滤 title+lastText（大小写不敏感）+ 置顶/常规分组（保持入参序）', () => {
    const list = [
      s({ id: 'p', pinned: true, title: '置顶会话' }),
      s({ id: 'a', title: '早安' }),
      s({ id: 'b', lastText: '晚安喵' }),
    ];
    expect(splitSessions(list, '').pinned.map((x) => x.id)).toEqual(['p']);
    expect(splitSessions(list, '').recent.map((x) => x.id)).toEqual(['a', 'b']);
    expect(splitSessions(list, '晚').recent.map((x) => x.id)).toEqual(['b']);
    expect(splitSessions(list, '置顶').pinned).toHaveLength(1);
  });

  it('formatSessionTime：今天=HH:mm / 昨天=yesterday / 更早=M-D', () => {
    const now = new Date(2026, 6, 9, 12, 0).getTime();
    expect(formatSessionTime(new Date(2026, 6, 9, 9, 5).getTime(), now)).toEqual({
      kind: 'time',
      text: '09:05',
    });
    expect(formatSessionTime(new Date(2026, 6, 8, 23, 0).getTime(), now)).toEqual({
      kind: 'yesterday',
      text: '',
    });
    expect(formatSessionTime(new Date(2026, 5, 1).getTime(), now)).toEqual({
      kind: 'date',
      text: '6-1',
    });
  });

  it('resolveActiveSession 缺省 default；newSessionId 以 s_ 开头', () => {
    expect(resolveActiveSession({}, 'c')).toBe('default');
    expect(resolveActiveSession({ c: 's_9' }, 'c')).toBe('s_9');
    expect(newSessionId(1234)).toBe('s_1234');
  });

  it('UndoTimers：到点执行、cancel 阻止、pending 查询', () => {
    vi.useFakeTimers();
    const u = new UndoTimers(5000);
    const fired: string[] = [];
    u.schedule('a', () => fired.push('a'));
    expect(u.pending('a')).toBe(true);
    u.cancel('a');
    vi.advanceTimersByTime(6000);
    expect(fired).toEqual([]);
    u.schedule('b', () => fired.push('b'));
    vi.advanceTimersByTime(5001);
    expect(fired).toEqual(['b']);
    expect(u.pending('b')).toBe(false);
    vi.useRealTimers();
  });
});
