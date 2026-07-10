import { describe, it, expect } from 'vitest';
import {
  sessionToMarkdown,
  deriveTitle,
  sanitizeFilename,
} from '../electron/main/session-export.js';
import {
  assertNotImSession,
  nextActiveAfterDelete,
  writeActiveSession,
} from '../electron/main/session-guards.js';

describe('session-export', () => {
  it('deriveTitle：meta 优先 → 首条 user 截 24 字 → id 兜底', () => {
    expect(deriveTitle('有名字', '首句', 's1')).toBe('有名字');
    expect(deriveTitle(null, 'x'.repeat(30), 's1')).toBe('x'.repeat(24));
    expect(deriveTitle(null, null, 's1')).toBe('s1');
  });
  it('sessionToMarkdown：标题 + 角色名 + ts 升序对话', () => {
    const md = sessionToMarkdown('聊天记录', '小企鹅', [
      { role: 'user', text: '你好', ts: Date.UTC(2026, 6, 9, 4), finishReason: null, tokensIn: null, tokensOut: null },
      { role: 'assistant', text: '嗨！', ts: Date.UTC(2026, 6, 9, 4, 1), finishReason: 'stop', tokensIn: 1, tokensOut: 1 },
    ]);
    expect(md).toContain('# 聊天记录');
    expect(md).toContain('**你**：你好');
    expect(md).toContain('**小企鹅**：嗨！');
    expect(md.indexOf('你好')).toBeLessThan(md.indexOf('嗨！'));
  });
  it('sanitizeFilename 去非法字符', () => {
    expect(sanitizeFilename('a/b\\c:d*e?"<>|')).toBe('abcde');
  });
});

describe('session-guards', () => {
  it('assertNotImSession：im:* 抛错，其余放行', () => {
    expect(() => assertNotImSession('im:qq:123')).toThrow();
    expect(() => assertNotImSession('default')).not.toThrow();
    expect(() => assertNotImSession('s_123')).not.toThrow();
  });
  it('nextActiveAfterDelete：非当前会话不改指针；当前会话回退最近桌面会话或 default', () => {
    expect(nextActiveAfterDelete('a', 'b', ['x'])).toBeNull();
    expect(nextActiveAfterDelete('a', 'a', ['x', 'y'])).toBe('x');
    expect(nextActiveAfterDelete('a', 'a', [])).toBe('default');
  });
});

describe('writeActiveSession（2026-07-10 真窗 bug：PrefsStore.set 不广播导致新建无反应）', () => {
  it('写指针 + 广播 prefs.changed（payload 为整个 map）', () => {
    const calls: Array<{ channel: string; params: unknown }> = [];
    let saved: Record<string, string> = { other: 's_1' };
    writeActiveSession(
      {
        getMap: () => saved,
        setMap: (m) => {
          saved = m;
        },
        broadcast: (channel, params) => calls.push({ channel, params }),
      },
      'c1',
      's_42',
    );
    expect(saved).toEqual({ other: 's_1', c1: 's_42' });
    expect(calls).toEqual([
      {
        channel: 'app.prefs.changed',
        params: { key: 'chat.activeSessions', value: { other: 's_1', c1: 's_42' } },
      },
    ]);
  });
});
