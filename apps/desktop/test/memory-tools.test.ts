import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Prefs } from '@openpet/protocol';
import { MemoryStore } from '../electron/main/db/index.js';
import { createMemoryCompiler } from '../electron/main/memory-compiler.js';
import { createMemoryService } from '../electron/main/memory-service.js';
import {
  createMemoryTools,
  formatRecall,
  RECALL_TOOL,
  REMEMBER_INTENT_RE,
  REMEMBER_TOOL,
  type MemoryToolsDeps,
} from '../electron/main/memory-tools.js';
import { MemoryWiki } from '../electron/main/memory-wiki.js';

const cleanups: string[] = [];
afterEach(() => {
  for (const p of cleanups.splice(0)) rmSync(p, { recursive: true, force: true });
});

function tools(over: Partial<MemoryToolsDeps> & { prefs?: Record<string, unknown> } = {}) {
  const notes: Array<[string, string]> = [];
  const t = createMemoryTools({
    getPrefs: () =>
      ({
        'privacy.longTermMemory': true,
        'memory.recallTool': true,
        'memory.rememberTool': true,
        ...over.prefs,
      }) as unknown as Prefs,
    toolCapable: over.toolCapable ?? (() => true),
    sessionAllowed: over.sessionAllowed ?? ((sid) => !sid.startsWith('im:qq:group')),
    recall: over.recall ?? (async () => []),
    addNote: over.addNote ?? ((sid, text) => notes.push([sid, text])),
  });
  return { t, notes };
}
const names = (defs: Array<{ name: string }>) => defs.map((d) => d.name);

describe('㉔ memory-tools 挂载条件', () => {
  it('recall 常挂；remember 只在用户说了「记住」一类的话时出现', () => {
    const { t } = tools();
    expect(names(t.activeToolDefs({ sessionId: 's', userText: '今天好累' }))).toEqual([
      RECALL_TOOL,
    ]);
    expect(names(t.activeToolDefs({ sessionId: 's', userText: '记住，我下周三面试' }))).toEqual([
      RECALL_TOOL,
      REMEMBER_TOOL,
    ]);
    for (const s of [
      '帮我记一下',
      '别忘了我生日',
      '不要忘记',
      "don't forget milk",
      'Please remember this',
      'keep in mind',
    ])
      expect(REMEMBER_INTENT_RE.test(s), s).toBe(true);
    for (const s of ['今天天气不错', '你记得我吗', '我忘了带伞'])
      expect(REMEMBER_INTENT_RE.test(s), s).toBe(false);
  });

  it('总闸关 / 模型没勾 tool → 都不挂；各自开关独立', () => {
    const ctx = { sessionId: 's', userText: '记住这个' };
    expect(tools({ prefs: { 'privacy.longTermMemory': false } }).t.activeToolDefs(ctx)).toEqual([]);
    expect(tools({ toolCapable: () => false }).t.activeToolDefs(ctx)).toEqual([]);
    expect(names(tools({ prefs: { 'memory.recallTool': false } }).t.activeToolDefs(ctx))).toEqual([
      REMEMBER_TOOL,
    ]);
    expect(names(tools({ prefs: { 'memory.rememberTool': false } }).t.activeToolDefs(ctx))).toEqual(
      [RECALL_TOOL],
    );
  });

  it('不进记忆的会话（IM 群聊）不挂 remember；无上下文不挂 remember', () => {
    const { t } = tools();
    expect(names(t.activeToolDefs({ sessionId: 'im:qq:group:1', userText: '记住' }))).toEqual([
      RECALL_TOOL,
    ]);
    expect(names(t.activeToolDefs())).toEqual([RECALL_TOOL]);
  });
});

describe('㉔ memory-tools 执行', () => {
  it('recall：参数进检索（单元 6 / 字数 2000 / 记被想起）→ 纯文本；无命中给一句话；空 query 报错', async () => {
    const calls: unknown[] = [];
    const { t } = tools({
      recall: async (q, o) => {
        calls.push([q, o]);
        return q === '爬山'
          ? [
              {
                path: 'user/topics/爬山.md',
                title: '爬山',
                body: '和王小明去香山',
                via: 'keyword',
              },
              {
                path: 'characters/a/timeline.md',
                title: '更早的经历（我记下的）',
                body: '- 2026-03-01 第一次爬山',
                via: 'text',
              },
            ]
          : [];
      },
    });
    const out = await t.callTool(RECALL_TOOL, { query: ' 爬山 ' }, { sessionId: 's' });
    expect(calls[0]).toEqual(['爬山', { units: 6, chars: 2000, record: true }]);
    expect(out).toBe(
      '「爬山」想起了 2 条：\n\n### 爬山\n和王小明去香山\n\n### 更早的经历（我记下的）\n- 2026-03-01 第一次爬山',
    );
    expect(out).not.toContain('[[');
    expect(await t.callTool(RECALL_TOOL, { query: '火星' })).toBe('没有想起与「火星」相关的记忆。');
    await expect(t.callTool(RECALL_TOOL, {})).rejects.toThrow(/关键词/);
    expect(formatRecall('x', [])).toBe('没有想起与「x」相关的记忆。');
  });

  it('remember：写便签（带会话）并回执；空 / 超 200 字 / 不可用时报错', async () => {
    const { t, notes } = tools();
    await expect(
      t.callTool(REMEMBER_TOOL, { text: '用户 2026-09-30 有面试' }, { sessionId: 's1' }),
    ).resolves.toBe('已记下：用户 2026-09-30 有面试（稍后整理进长期记忆）');
    expect(notes).toEqual([['s1', '用户 2026-09-30 有面试']]);
    await expect(t.callTool(REMEMBER_TOOL, { text: '  ' }, { sessionId: 's1' })).rejects.toThrow(
      /1–200/,
    );
    await expect(
      t.callTool(REMEMBER_TOOL, { text: '长'.repeat(201) }, { sessionId: 's1' }),
    ).rejects.toThrow(/1–200/);
    await expect(
      t.callTool(REMEMBER_TOOL, { text: 'x' }, { sessionId: 'im:qq:group:1' }),
    ).rejects.toThrow(/不可用/);
    await expect(
      tools({ prefs: { 'privacy.longTermMemory': false } }).t.callTool(RECALL_TOOL, { query: 'x' }),
    ).rejects.toThrow(/关闭/);
    expect(t.ownsTool(RECALL_TOOL) && t.ownsTool(REMEMBER_TOOL) && !t.ownsTool('x')).toBe(true);
  });

  it('联调：remember 写便签 → 本轮结束编译器见到便签即整理（便签进 prompt，完成后删除）', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ds-mtools-'));
    cleanups.push(dir);
    const store = new MemoryStore();
    const wiki = new MemoryWiki(dir, { now: () => Date.UTC(2026, 8, 23, 12) });
    const prefs = {
      'privacy.longTermMemory': true,
      'memory.recallTool': true,
      'memory.rememberTool': true,
      'chat.activeSessions': {},
    } as unknown as Prefs;
    const svc = createMemoryService({
      store,
      wiki,
      embed: async () => {
        throw new Error('no embedding');
      },
      getPrefs: () => prefs,
      character: () => ({ id: 'default' }),
    });
    const bodies: string[] = [];
    const compiler = createMemoryCompiler({
      store,
      wiki,
      fetchImpl: async (_u, init) => {
        bodies.push(String(init?.body ?? ''));
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content:
                    '[{"op":"upsert_section","page":"user/profile.md","section":"近况","content":"2026-09-30 有面试"}]',
                },
              },
            ],
          }),
        );
      },
      getPrefs: () => prefs,
      resolveTarget: () => ({ apiBase: 'x', model: 'm', key: '', adapter: 'openai' }),
      character: () => ({ id: 'default' }),
    });
    const t = createMemoryTools({
      getPrefs: () => prefs,
      toolCapable: () => true,
      sessionAllowed: () => true,
      recall: (q, o) => svc.recall(q, o),
      addNote: (sid, text) => store.memoryNoteAdd('default', sid, text, 1),
    });
    store.appendMessage({
      characterId: 'default',
      sessionId: 's1',
      role: 'user',
      text: '记住，我下周三面试',
      ts: 1,
    });
    await t.callTool(REMEMBER_TOOL, { text: '用户 2026-09-30 有面试' }, { sessionId: 's1' });
    store.appendMessage({
      characterId: 'default',
      sessionId: 's1',
      role: 'assistant',
      text: '记下啦',
      ts: 2,
    });
    await compiler.onTurnEnd('s1'); // 只有 2 条（< 16），但有便签 → 立即整理
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain('用户 2026-09-30 有面试');
    expect(store.memoryNotes('default', 's1')).toEqual([]);
    expect(wiki.readRaw('user/profile.md')).toContain('2026-09-30 有面试');
    // 刚写进的档案节马上能被主动回想到
    expect(await t.callTool(RECALL_TOOL, { query: '面试' })).toContain('### 用户档案 · 近况');
  });
});
