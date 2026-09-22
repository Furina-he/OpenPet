import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Prefs } from '@openpet/protocol';
import { MemoryStore } from '../electron/main/db/index.js';
import { createMemoryCompiler } from '../electron/main/memory-compiler.js';
import { MemoryWiki } from '../electron/main/memory-wiki.js';

const cleanups: string[] = [];
afterEach(() => {
  for (const p of cleanups.splice(0)) rmSync(p, { recursive: true, force: true });
});

function fakeCompletion(content: string, calls?: { n: number; bodies: string[] }) {
  return async (_url: string, init?: RequestInit): Promise<Response> => {
    if (calls) {
      calls.n++;
      calls.bodies.push(String(init?.body ?? ''));
    }
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  };
}
const embed = async (inputs: string[]): Promise<number[][]> =>
  inputs.map((t) => (t.includes('猫') ? [1, 0] : [0, 1]));

function make(
  fetchImpl: ReturnType<typeof fakeCompletion>,
  opts: { ltm?: boolean; now?: () => number; reindexed?: string[]; changed?: string[] } = {},
) {
  const dir = mkdtempSync(path.join(tmpdir(), 'ds-mc-'));
  cleanups.push(dir);
  const store = new MemoryStore();
  const wiki = new MemoryWiki(dir, { now: opts.now ?? (() => Date.UTC(2026, 8, 22, 12)) });
  const compiler = createMemoryCompiler({
    store,
    wiki,
    embed,
    fetchImpl,
    getPrefs: () =>
      ({
        'privacy.longTermMemory': opts.ltm ?? true,
        'chat.activeSessions': {},
      }) as unknown as Prefs,
    resolveTarget: () => ({ apiBase: 'https://x/v1', model: 'gpt', key: 'k', adapter: 'openai' }),
    character: () => ({ id: 'default' }),
    reindex: async (paths) => {
      opts.reindexed?.push(...paths);
    },
    onChanged: (pages) => opts.changed?.push(...pages),
    turnsPerCompile: 2,
    ...(opts.now ? { now: opts.now } : {}),
  });
  store.appendMessage({
    characterId: 'default',
    sessionId: 's1',
    role: 'user',
    text: '我养了只猫叫年糕',
    ts: 1,
  });
  return {
    store,
    wiki,
    compiler,
    read: (rel: string) => readFileSync(path.join(dir, rel), 'utf8'),
    dir,
  };
}

describe('⑲ memory-compiler v3', () => {
  it('每 N 轮触发：合法 ops 落盘（剥 codefence）+ index 重生成 + reindex/changed 回调 + status ok', async () => {
    const reindexed: string[] = [];
    const changed: string[] = [];
    const { compiler, read } = make(
      fakeCompletion(
        '```json\n[{"op":"create_page","kind":"people","slug":"nian-gao","title":"年糕","keys":["年糕"],"content":"用户的猫"},{"op":"upsert_section","page":"user/profile.md","section":"一句话档案","content":"养猫的人"}]\n```',
      ),
      { reindexed, changed },
    );
    await compiler.onTurnEnd('s1');
    expect(compiler.status()).toBeNull(); // 第 1 轮不触发
    await compiler.onTurnEnd('s1');
    expect(read('user/people/nian-gao.md')).toContain('用户的猫');
    expect(read('user/profile.md')).toContain('养猫的人');
    expect(read('index.md')).toContain('user/people/nian-gao.md');
    expect(reindexed.sort()).toEqual(['user/people/nian-gao.md', 'user/profile.md']);
    expect(changed).toHaveLength(2);
    expect(compiler.status()).toMatchObject({ ok: true, ops: 2 });
  });

  it('非法整批丢弃：页不变 + 无 .prev + status 记失败原因；开关关不编译', async () => {
    const { compiler, read, dir } = make(
      fakeCompletion(
        '[{"op":"upsert_section","page":"user/profile.md","section":"身份","content":"学生"},{"op":"create_page","kind":"secrets","slug":"a","title":"a","content":"x"}]',
      ),
    );
    await compiler.onTurnEnd('s1');
    await compiler.onTurnEnd('s1');
    expect(read('user/profile.md')).not.toContain('学生');
    expect(existsSync(path.join(dir, 'user/profile.md.prev'))).toBe(false);
    expect(compiler.status()).toMatchObject({ ok: false });
    expect(compiler.status()?.error).toMatch(/非法/);

    const calls = { n: 0, bodies: [] as string[] };
    const off = make(fakeCompletion('[]', calls), { ltm: false });
    await off.compiler.onTurnEnd('s1');
    await off.compiler.onTurnEnd('s1');
    expect(calls.n).toBe(0);
    expect(await off.compiler.compileNow('s1')).toMatchObject({ ok: false });
  });

  it('锁定节端到端：LLM 试图改锁定节 → 整批拒绝、用户内容保留；非 JSON 输出 → 失败', async () => {
    const { compiler, wiki, read } = make(
      fakeCompletion(
        '[{"op":"upsert_section","page":"user/profile.md","section":"杂项","content":"改掉"}]',
      ),
    );
    wiki.ensureLayout('default');
    wiki.writeRaw(
      'user/profile.md',
      read('user/profile.md').replace('## 杂项\n', '## 杂项\n\n<!-- locked -->\n用户手写'),
    );
    const r = await compiler.compileNow('s1');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/锁定/);
    expect(read('user/profile.md')).toContain('用户手写');

    const junk = make(fakeCompletion('我觉得没什么要记的'));
    expect((await junk.compiler.compileNow('s1')).error).toMatch(/JSON/);
  });

  it('flush：计数>0 立即编译并清零；60s 防抖内跳过（计数保留）；无计数不发', async () => {
    let t = 1_000_000;
    const calls = { n: 0, bodies: [] as string[] };
    const { compiler } = make(fakeCompletion('[]', calls), { now: () => t });
    await compiler.flush(); // 无计数
    expect(calls.n).toBe(0);
    await compiler.onTurnEnd('s1'); // 计数 1
    await compiler.flush();
    expect(calls.n).toBe(1);
    await compiler.onTurnEnd('s1'); // 计数 1
    await compiler.flush(); // 防抖内跳过
    expect(calls.n).toBe(1);
    t += 61_000;
    await compiler.flush();
    expect(calls.n).toBe(2);
  });

  it('输入拼装：最近对话 + 摘要 + 索引 + 相关页（固定三页 + 关键词/向量命中，≤5 页非固定）', async () => {
    const calls = { n: 0, bodies: [] as string[] };
    const { compiler, wiki, store } = make(fakeCompletion('[]', calls));
    wiki.ensureLayout('default');
    for (let i = 0; i < 8; i++)
      wiki.applyOps(
        [
          {
            op: 'create_page',
            kind: 'topics',
            slug: `t${i}`,
            title: `话题${i}`,
            keys: [`猫${i}`],
            content: `内容${i}`,
          },
        ],
        'default',
      );
    store.sessionSummarySet('s1', '之前聊过猫', 1);
    store.appendMessage({
      characterId: 'default',
      sessionId: 's1',
      role: 'user',
      text: '猫0 猫1 猫2 猫3 猫4 猫5 猫6 猫7',
      ts: 2,
    });
    await compiler.compileNow('s1');
    const body = JSON.parse(calls.bodies[0]!) as {
      messages: Array<{ role: string; content: string }>;
    };
    const user = body.messages[1]!.content;
    expect(user).toContain('会话摘要：之前聊过猫');
    expect(user).toContain('记忆索引');
    expect(user).toContain('<<< user/profile.md');
    expect(user).toContain('<<< characters/default/timeline.md');
    const nonFixed = (user.match(/<<< user\/topics\//g) ?? []).length;
    expect(nonFixed).toBeGreaterThan(0);
    expect(nonFixed).toBeLessThanOrEqual(5);
    expect(body.messages[0]!.content).toContain('upsert_section');
  });

  it('迁移模式 compileFacts：prompt 为初始化整理，事实列表进输入，ops 落盘', async () => {
    const calls = { n: 0, bodies: [] as string[] };
    const { compiler, read } = make(
      fakeCompletion(
        '[{"op":"upsert_section","page":"user/profile.md","section":"工作学习","content":"深圳前端"}]',
        calls,
      ),
    );
    const r = await compiler.compileFacts('default', ['用户在深圳做前端', '用户养猫']);
    expect(r).toMatchObject({ ok: true, ops: 1 });
    expect(read('user/profile.md')).toContain('深圳前端');
    const body = JSON.parse(calls.bodies[0]!) as { messages: Array<{ content: string }> };
    expect(body.messages[0]!.content).toContain('初始化整理');
    expect(body.messages[1]!.content).toContain('1. 用户在深圳做前端');
    expect(await compiler.compileFacts('default', [])).toMatchObject({ ok: true, ops: 0 });
  });
});
