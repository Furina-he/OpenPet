/**
 * ㉔ 记忆 v3 DB 契约（MemoryStore / SqliteStore 双实现共用断言）：编译账本 / 删消息夹紧 /
 * 便签 / 来源日志 / messagesBefore / messageCountAfter。
 */
import { expect } from 'vitest';
import type { ConversationStore } from '../../electron/main/db/store.js';

export function runMemoryV3Contract(s: ConversationStore): void {
  const ids: number[] = [];
  for (let i = 1; i <= 6; i++)
    ids.push(
      s.appendMessage({ characterId: 'a', sessionId: 's', role: 'user', text: `m${i}`, ts: i }),
    );
  s.appendMessage({ characterId: 'b', sessionId: 's', role: 'user', text: 'other', ts: 9 });

  // messagesBefore / messageCountAfter（只看本角色本会话）
  expect(s.messagesBefore('a', 's', ids[3]!, 2).map((m) => m.text)).toEqual(['m3', 'm4']);
  expect(s.messagesBefore('a', 's', ids[0]!, 4).map((m) => m.text)).toEqual(['m1']);
  expect(s.messageCountAfter('a', 's', ids[1]!)).toBe(4);
  expect(s.messageCountAfter('b', 's', 0)).toBe(1);

  // 账本：无行 = 默认；put 只改给出的列
  expect(s.compileStateGet('a', 's')).toEqual({
    upto: 0,
    pendingTo: null,
    retries: 0,
    lastError: null,
    lastAttemptAt: null,
  });
  s.compileStatePut('a', 's', { upto: ids[1]!, pendingTo: ids[4]!, lastAttemptAt: 7 });
  s.compileStatePut('a', 's', { retries: 2, lastError: '坏输出' });
  expect(s.compileStateGet('a', 's')).toEqual({
    upto: ids[1]!,
    pendingTo: ids[4]!,
    retries: 2,
    lastError: '坏输出',
    lastAttemptAt: 7,
  });
  expect(s.compileStateGet('b', 's').upto).toBe(0); // 按角色隔离

  // 删消息夹紧：删到待重试段之内 → 段清掉、失败次数归零；水位夹到 fromId − 1
  s.deleteMessagesFrom('a', 's', ids[3]!);
  expect(s.compileStateGet('a', 's')).toMatchObject({ upto: ids[1]!, pendingTo: null, retries: 0 });
  s.compileStatePut('a', 's', { upto: ids[2]!, pendingTo: null });
  s.deleteMessagesFrom('a', 's', ids[1]!);
  expect(s.compileStateGet('a', 's').upto).toBe(ids[0]!);

  // 便签
  const n1 = s.memoryNoteAdd('a', 's', '记住一', 1);
  s.memoryNoteAdd('a', 's', '记住二', 2);
  s.memoryNoteAdd('b', 's', '别人的', 3);
  expect(s.memoryNotes('a', 's').map((n) => n.text)).toEqual(['记住一', '记住二']);
  s.memoryNotesDelete([n1]);
  expect(s.memoryNotes('a', 's')).toEqual([
    expect.objectContaining({ text: '记住二', createdAt: 2 }),
  ]);

  // sessionDelete 连带删本角色账本与便签，他角色不动
  s.compileStatePut('b', 's', { upto: 3 });
  s.sessionDelete('a', 's');
  expect(s.compileStateGet('a', 's').upto).toBe(0);
  expect(s.memoryNotes('a', 's')).toEqual([]);
  expect(s.memoryNotes('b', 's')).toHaveLength(1);
  expect(s.compileStateGet('b', 's').upto).toBe(3);

  // clearMessages 清账本与便签
  s.clearMessages();
  expect(s.compileStateGet('b', 's').upto).toBe(0);
  expect(s.memoryNotes('b', 's')).toEqual([]);
  s.memoryNoteAdd('b', 's', 'x', 1);
  s.memoryNotesClear();
  expect(s.memoryNotes('b', 's')).toEqual([]);

  // 来源日志：at 降序、同 at 按写入序；改名 / 删页 / 清空
  const base = { characterId: 'a', sessionId: 's', msgFrom: 0, msgTo: 4, detail: null };
  s.opLogAdd([
    { ...base, at: 10, path: 'user/profile.md', op: 'upsert_section', detail: '近况' },
    { ...base, at: 10, path: 'user/profile.md', op: 'upsert_section', detail: '身份' },
    { ...base, at: 20, path: 'user/profile.md', op: 'remove_line' },
    { ...base, at: 20, path: 'user/people/小王.md', op: 'create_page', sessionId: null },
  ]);
  expect(s.opLogForPath('user/profile.md', 10).map((r) => [r.at, r.detail])).toEqual([
    [20, null],
    [10, '近况'],
    [10, '身份'],
  ]);
  expect(s.opLogForPath('user/profile.md', 1)).toHaveLength(1);
  expect(s.opLogForPath('user/people/小王.md', 10)[0]).toMatchObject({
    characterId: 'a',
    sessionId: null,
    msgFrom: 0,
    msgTo: 4,
    op: 'create_page',
  });
  s.opLogRenamePath('user/people/小王.md', 'user/people/王小明.md');
  expect(s.opLogForPath('user/people/小王.md', 10)).toEqual([]);
  expect(s.opLogForPath('user/people/王小明.md', 10)).toHaveLength(1);
  s.opLogDeletePath('user/people/王小明.md');
  expect(s.opLogForPath('user/people/王小明.md', 10)).toEqual([]);
  s.opLogClear();
  expect(s.opLogForPath('user/profile.md', 10)).toEqual([]);
}
