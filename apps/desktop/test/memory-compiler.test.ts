import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Prefs } from '@openpet/protocol';
import { MemoryStore } from '../electron/main/db/index.js';
import { createMemoryCompiler, systemPrompt } from '../electron/main/memory-compiler.js';
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

/** 追加 n 条消息（user / assistant 交替），返回行 id。 */
function say(store: MemoryStore, n: number, opts: { sid?: string; cid?: string; text?: string } = {}): number[] {
  const ids: number[] = [];
  for (let i = 0; i < n; i++)
    ids.push(
      store.appendMessage({
        characterId: opts.cid ?? 'default',
        sessionId: opts.sid ?? 's1',
        role: i % 2 === 0 ? 'user' : 'assistant',
        text: `${opts.text ?? '话'}${i}`,
        ts: 10 + i,
      }),
    );
  return ids;
}

function userOf(body: string): string {
  return (JSON.parse(body) as { messages: Array<{ content: string }> }).messages[1]!.content;
}

describe('⑲ memory-compiler v3', () => {
  it('㉔ 按库里未整理消息数触发（阈值 2 × turnsPerCompile）：合法 ops 落盘（剥 codefence）+ index 重生成 + reindex/changed 回调 + status ok', async () => {
    const reindexed: string[] = [];
    const changed: string[] = [];
    const { compiler, read, store } = make(
      fakeCompletion(
        '```json\n[{"op":"create_page","kind":"people","slug":"nian-gao","title":"年糕","keys":["年糕"],"content":"用户的猫"},{"op":"upsert_section","page":"user/profile.md","section":"一句话档案","content":"养猫的人"}]\n```',
      ),
      { reindexed, changed },
    );
    await compiler.onTurnEnd('s1');
    expect(compiler.status()).toBeNull(); // 1 条 < 4
    say(store, 3);
    await compiler.onTurnEnd('s1');
    expect(read('user/people/年糕.md')).toContain('用户的猫');
    expect(read('user/profile.md')).toContain('养猫的人');
    expect(read('.openpet/index.md')).toContain('[[年糕]]');
    expect(reindexed.sort()).toEqual(['user/people/年糕.md', 'user/profile.md']);
    expect(changed).toHaveLength(2);
    expect(compiler.status()).toMatchObject({ ok: true, ops: 2 });
    expect(store.compileStateGet('default', 's1')).toMatchObject({ upto: 4, pendingTo: null });
    expect(compiler.backlog('default', 's1')).toBeNull();
  });

  it('非法整批丢弃：页不变 + 无 .prev + status 记失败原因；开关关不编译', async () => {
    const { compiler, read, dir, store } = make(
      fakeCompletion(
        '[{"op":"upsert_section","page":"user/profile.md","section":"身份","content":"学生"},{"op":"create_page","kind":"secrets","slug":"a","title":"a","content":"x"}]',
      ),
    );
    say(store, 3);
    await compiler.onTurnEnd('s1');
    expect(read('user/profile.md')).not.toContain('学生');
    expect(existsSync(path.join(dir, 'user/profile.md.prev'))).toBe(false);
    expect(compiler.status()).toMatchObject({ ok: false });
    expect(compiler.status()?.error).toMatch(/非法/);

    const calls = { n: 0, bodies: [] as string[] };
    const off = make(fakeCompletion('[]', calls), { ltm: false });
    say(off.store, 5);
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

  it('㉔ flush：有未整理 → 立即整理；60s 防抖内跳过；没有未整理不发', async () => {
    let t = 1_000_000;
    const calls = { n: 0, bodies: [] as string[] };
    const { compiler, store } = make(fakeCompletion('[]', calls), { now: () => t });
    await compiler.compileNow('s1'); // 消化种子消息
    expect(calls.n).toBe(1);
    await compiler.onTurnEnd('s1'); // 记下活跃会话（无积压不整理）
    await compiler.flush();
    expect(calls.n).toBe(1);
    say(store, 1);
    await compiler.flush();
    expect(calls.n).toBe(2);
    say(store, 1);
    await compiler.flush(); // 防抖内跳过
    expect(calls.n).toBe(2);
    t += 61_000;
    await compiler.flush();
    expect(calls.n).toBe(3);
    expect(compiler.backlog('default', 's1')).toBeNull();
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
            title: `话题${i}`,
            aliases: [`猫${i}`],
            tags: [],
            content: `内容${i}`,
          },
        ],
        'default',
      );
    store.sessionSummarySet('default', 's1', '之前聊过猫', 1);
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

describe('㉒ memory-compiler v3.1', () => {
  it('systemPrompt：链接 / 时间 / 口吻规则 + set_props 格式；角色名与截断后的人设；无人设只给名字', () => {
    const p = systemPrompt(
      { id: 'furina', name: '芙宁娜', persona: '水神。' + '戏'.repeat(700), userName: '阿明' },
      'chat',
    );
    expect(p).toContain('[[页面名]]');
    expect(p).toContain('[[页面名|别名]]');
    expect(p).toContain('相对时间');
    expect(p).toContain('换算成具体日期');
    expect(p).toContain('"op":"set_props"');
    expect(p).toContain('"title":"王小明","aliases":["小王"],"tags":["同事"]');
    expect(p).not.toContain('slug');
    expect(p).toContain('你是 芙宁娜，下面是你的人设摘要');
    expect(p).toContain('水神。');
    expect(p).not.toContain('戏'.repeat(600)); // 人设截 600 字（含前缀「水神。」）
    expect(p).toContain('戏'.repeat(590));
    expect(p).toContain('经历条目（append_timeline / merge_timeline）和关系页「亲密度叙事」节用你（芙宁娜）本人的第一人称');
    expect(p).toContain('user/ 下的档案/人物/话题页所有角色共用，保持中性客观');
    expect(p).toContain('> 「阿明」 > 「ta」');
    expect(p).toContain('characters/furina/timeline.md');
    const bare = systemPrompt({ id: 'furina', name: '芙宁娜' }, 'migrate');
    expect(bare).toContain('你是 芙宁娜。');
    expect(bare).not.toContain('人设摘要');
    expect(bare).toContain('初始化整理');
    expect(bare).toContain('关系页「称呼」节里的叫法 > 「ta」');
  });

  it('prompt 用 deps.character 的名字与人设；常驻块标题「最近经历（我记下的）」', async () => {
    const calls = { n: 0, bodies: [] as string[] };
    const { compiler, wiki } = make(fakeCompletion('[]', calls));
    await compiler.compileNow('s1');
    const sys = (JSON.parse(calls.bodies[0]!) as { messages: Array<{ content: string }> })
      .messages[0]!.content;
    expect(sys).toContain('你是 default。'); // 测试桩只给 id
    wiki.applyOps([{ op: 'append_timeline', date: '2026-09-20', text: '我陪 ta 聊猫' }], 'default');
    expect(wiki.residentBlocks('default').join('\n')).toContain('### 最近经历（我记下的）');
  });

  it('LLM 输出含 [[别名]] / 悬空链接 / 本批新建页链接 → 落盘经规范化；撞名 create_page 并入且 lastCompile.merged 有记录', async () => {
    const { wiki, read } = make(fakeCompletion('[]'));
    wiki.ensureLayout('default');
    wiki.applyOps(
      [{ op: 'create_page', kind: 'people', title: '王小明', aliases: ['小王'], tags: [], content: '室友' }],
      'default',
    );
    const out = JSON.stringify([
      {
        op: 'upsert_section',
        page: 'user/profile.md',
        section: '近况',
        content: '和[[小王]]去[[火星]]，认识了[[李雷]]',
      },
      { op: 'create_page', kind: 'people', title: '李雷', aliases: [], content: '新朋友' },
      { op: 'create_page', kind: 'people', slug: 'xiao-wang', title: '小王', keys: ['王工'], content: '升职了' },
    ]);
    const c2 = createMemoryCompiler({
      store: new MemoryStore(),
      wiki,
      fetchImpl: fakeCompletion(out),
      getPrefs: () =>
        ({ 'privacy.longTermMemory': true, 'chat.activeSessions': {} }) as unknown as Prefs,
      resolveTarget: () => ({ apiBase: 'https://x/v1', model: 'gpt', key: 'k', adapter: 'openai' }),
      character: () => ({ id: 'default' }),
    });
    const r = await c2.compileFacts('default', ['x']);
    expect(r).toMatchObject({ ok: true, ops: 3 });
    expect(read('user/profile.md')).toContain('和[[王小明|小王]]去火星，认识了[[李雷]]');
    expect(existsSync(path.join(wiki.root, 'user/people/小王.md'))).toBe(false);
    const wm = wiki.readPage('user/people/王小明.md')!;
    expect(wm.frontmatter.aliases).toEqual(['小王', '王工']);
    expect(wm.body).toContain('升职了');
    expect(c2.status()).toMatchObject({ ok: true, merged: [['小王', 'user/people/王小明.md']] });
  });
});

describe('㉔ memory-compiler 编译水位 / 失败重试 / 串行 / 便签 / 来源日志', () => {
  const OPS_OK = '[{"op":"append_timeline","date":"2026-09-20","text":"我陪 ta 聊猫"}]';

  function build(
    store: MemoryStore,
    wiki: MemoryWiki,
    fetchImpl: ReturnType<typeof fakeCompletion>,
    opts: { now?: () => number; cid?: () => string; ltm?: () => boolean } = {},
  ) {
    return createMemoryCompiler({
      store,
      wiki,
      fetchImpl,
      getPrefs: () =>
        ({
          'privacy.longTermMemory': opts.ltm?.() ?? true,
          'chat.activeSessions': {},
        }) as unknown as Prefs,
      resolveTarget: () => ({ apiBase: 'https://x/v1', model: 'gpt', key: 'k', adapter: 'openai' }),
      character: () => ({ id: opts.cid?.() ?? 'default' }),
      turnsPerCompile: 2,
      ...(opts.now ? { now: opts.now } : {}),
    });
  }

  it('计数从库里来：新实例接着数（重启不丢）', async () => {
    const calls = { n: 0, bodies: [] as string[] };
    const { store, wiki } = make(fakeCompletion('[]', calls)); // 种子 1 条
    say(store, 2);
    await build(store, wiki, fakeCompletion('[]', calls)).onTurnEnd('s1'); // 3 条 < 4
    expect(calls.n).toBe(0);
    say(store, 1);
    await build(store, wiki, fakeCompletion('[]', calls)).onTurnEnd('s1'); // 新实例：4 条
    expect(calls.n).toBe(1);
    expect(store.compileStateGet('default', 's1').upto).toBe(4);
  });

  it('调 LLM 前先锁段落库；成功推进水位、清段，只删本次读到的便签', async () => {
    const { store, wiki } = make(fakeCompletion('[]'));
    say(store, 3);
    store.memoryNoteAdd('default', 's1', '用户 2026-09-30 面试', 1);
    let seenDuring: unknown = null;
    const fetchImpl = async (u: string, init?: RequestInit): Promise<Response> => {
      seenDuring = store.compileStateGet('default', 's1');
      store.memoryNoteAdd('default', 's1', '编译途中新写的', 2);
      return fakeCompletion(OPS_OK)(u, init);
    };
    const r = await build(store, wiki, fetchImpl, { now: () => 5000 }).compileNow('s1');
    expect(r).toMatchObject({ ok: true, ops: 1 });
    expect(seenDuring).toMatchObject({ upto: 0, pendingTo: 4, lastAttemptAt: 5000 });
    expect(store.compileStateGet('default', 's1')).toMatchObject({
      upto: 4,
      pendingTo: null,
      retries: 0,
      lastError: null,
    });
    expect(store.memoryNotes('default', 's1').map((n) => n.text)).toEqual(['编译途中新写的']);
  });

  it('暂时类失败（HTTP 500 / 网络 / 模型不可用）不计次、段保持锁定；60s 后原段重试', async () => {
    let t = 1_000_000;
    let fail = true;
    const bodies: string[] = [];
    const fetchImpl = async (_u: string, init?: RequestInit): Promise<Response> => {
      bodies.push(String(init?.body ?? ''));
      if (fail) return new Response('boom', { status: 500 });
      return new Response(JSON.stringify({ choices: [{ message: { content: '[]' } }] }), {
        status: 200,
      });
    };
    const { store, wiki } = make(fakeCompletion('[]'));
    say(store, 3); // 4 条
    const c = build(store, wiki, fetchImpl, { now: () => t });
    await c.onTurnEnd('s1');
    expect(bodies).toHaveLength(1);
    expect(store.compileStateGet('default', 's1')).toMatchObject({
      upto: 0,
      pendingTo: 4,
      retries: 0,
      lastError: 'LLM HTTP 500',
    });
    expect(c.backlog('default', 's1')).toEqual({ messages: 4, retries: 0, error: 'LLM HTTP 500' });
    say(store, 4); // 积压涨到 8 条，但距上次尝试 < 60s → 不重试
    await c.onTurnEnd('s1');
    expect(bodies).toHaveLength(1);
    t += 61_000;
    fail = false;
    await c.onTurnEnd('s1');
    // 原段（前 4 条）重试成功，剩余 4 条 ≥ 阈值 → 追赶下一段
    expect(bodies).toHaveLength(3);
    expect(userOf(bodies[1]!)).toContain('我养了只猫叫年糕');
    expect(userOf(bodies[1]!)).not.toContain('话3');
    expect(store.compileStateGet('default', 's1')).toMatchObject({ upto: 8, lastError: null });

    // 网络异常同属暂时类
    const net = make(fakeCompletion('[]'));
    const c2 = build(net.store, net.wiki, async () => {
      throw new Error('ECONNRESET');
    });
    expect((await c2.compileNow('s1')).error).toMatch(/网络错误/);
    expect(net.store.compileStateGet('default', 's1').retries).toBe(0);
  });

  it('输出类失败计次，满 3 次放弃该段：推进水位、删本段便签、记 gaveUp', async () => {
    const { store, wiki } = make(fakeCompletion('[]'));
    say(store, 3);
    store.memoryNoteAdd('default', 's1', '记住这个', 1);
    const c = build(store, wiki, fakeCompletion('不是 JSON'));
    await c.compileNow('s1');
    await c.compileNow('s1');
    expect(store.compileStateGet('default', 's1')).toMatchObject({ upto: 0, pendingTo: 4, retries: 2 });
    expect(c.gaveUp()).toBeNull();
    const r = await c.compileNow('s1');
    expect(r.ok).toBe(false);
    expect(store.compileStateGet('default', 's1')).toMatchObject({
      upto: 4,
      pendingTo: null,
      retries: 0,
      lastError: null,
    });
    expect(store.memoryNotes('default', 's1')).toEqual([]);
    expect(c.gaveUp()).toMatchObject({ messages: 4, error: 'LLM 输出不是 JSON' });
    expect(c.backlog('default', 's1')).toBeNull();
  });

  it('串行：并发触发同一会话只编译一次；不同会话依次执行不交叠', async () => {
    const { store, wiki } = make(fakeCompletion('[]'));
    say(store, 3);
    say(store, 4, { sid: 's2' });
    let active = 0;
    let maxActive = 0;
    let calls = 0;
    const fetchImpl = async (u: string, init?: RequestInit): Promise<Response> => {
      calls++;
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return fakeCompletion('[]')(u, init);
    };
    const c = build(store, wiki, fetchImpl);
    await Promise.all([c.onTurnEnd('s1'), c.onTurnEnd('s1'), c.onTurnEnd('s2'), c.compileNow('s1')]);
    expect(calls).toBe(2);
    expect(maxActive).toBe(1);
  });

  it('便签立即触发（不等阈值）并进 prompt；前情 / 本段分开标注', async () => {
    const calls = { n: 0, bodies: [] as string[] };
    const { store, wiki } = make(fakeCompletion('[]', calls));
    const c = build(store, wiki, fakeCompletion('[]', calls));
    say(store, 5, { text: '旧' }); // 6 条
    await c.onTurnEnd('s1');
    expect(calls.n).toBe(1);
    say(store, 1, { text: '记住我下周三面试' });
    store.memoryNoteAdd('default', 's1', '用户 2026-09-30 有面试', 1);
    await c.onTurnEnd('s1'); // 未整理 1 条 < 4，但有便签
    expect(calls.n).toBe(2);
    const user = userOf(calls.bodies[1]!);
    expect(user).toContain('用户明确要求记住（必须写进记忆）：\n- 用户 2026-09-30 有面试');
    expect(user).toContain('此前对话（已整理过，只用来理解上下文）：\n助手: 旧1\n用户: 旧2\n助手: 旧3\n用户: 旧4');
    expect(user).toContain('本段新对话（整理这一段）：\n用户: 记住我下周三面试0');
    const sys = (JSON.parse(calls.bodies[1]!) as { messages: Array<{ content: string }> }).messages[0]!
      .content;
    expect(sys).toContain('「用户明确要求记住」里的内容必须写进记忆');
    expect(store.memoryNotes('default', 's1')).toEqual([]);
  });

  it('单条消息截 800 字；一段最多 24 条，积压按段追赶（一段一次调用）', async () => {
    const calls = { n: 0, bodies: [] as string[] };
    const { store, wiki } = make(fakeCompletion('[]', calls));
    store.appendMessage({ characterId: 'default', sessionId: 's1', role: 'user', text: '长'.repeat(900), ts: 2 });
    say(store, 58); // 共 60 条
    await build(store, wiki, fakeCompletion('[]', calls)).onTurnEnd('s1');
    expect(calls.n).toBe(3); // 24 + 24 + 12
    expect(userOf(calls.bodies[0]!)).toContain('长'.repeat(800));
    expect(userOf(calls.bodies[0]!)).not.toContain('长'.repeat(801));
    expect(store.compileStateGet('default', 's1').upto).toBe(60);
  });

  it('compileNow 无积压 = idle（连点不重复整理）', async () => {
    const calls = { n: 0, bodies: [] as string[] };
    const { compiler } = make(fakeCompletion(OPS_OK, calls));
    expect(await compiler.compileNow('s1')).toMatchObject({ ok: true, ops: 1 });
    expect(await compiler.compileNow('s1')).toEqual({ ok: true, ops: 0, changed: [], idle: true });
    expect(calls.n).toBe(1);
  });

  it('不进记忆的轮（总闸关 / skip）推进水位；重新打开后不补整理', async () => {
    let on = false;
    const calls = { n: 0, bodies: [] as string[] };
    const { store, wiki } = make(fakeCompletion('[]', calls));
    const c = build(store, wiki, fakeCompletion('[]', calls), { ltm: () => on });
    say(store, 5);
    await c.onTurnEnd('s1'); // 总闸关：跳过
    expect(store.compileStateGet('default', 's1').upto).toBe(6);
    on = true;
    say(store, 1);
    await c.onTurnEnd('s1');
    expect(calls.n).toBe(0); // 只剩 1 条新的
    say(store, 5, { sid: 'im:qq:group:1' });
    await c.skip('im:qq:group:1');
    expect(c.backlog('default', 'im:qq:group:1')).toBeNull();
  });

  it('切角色 flush 落在旧角色（入队前同步捕获 cid / sid）', async () => {
    let cid = 'aa';
    const calls = { n: 0, bodies: [] as string[] };
    const { store, wiki } = make(fakeCompletion('[]', calls));
    say(store, 2, { cid: 'aa', sid: 'sa' });
    const c = build(store, wiki, fakeCompletion('[]', calls), { cid: () => cid });
    await c.onTurnEnd('sa');
    const p = c.flush();
    cid = 'bb';
    await p;
    expect(calls.n).toBe(1);
    expect(store.compileStateGet('aa', 'sa').upto).toBe(3);
    expect(store.compileStateGet('bb', 'sa').upto).toBe(0);
  });

  it('来源日志：同一次编译同一个 at + 消息区间；撞名并入记 merge_page；迁移记 NULL 会话', async () => {
    let t = 100;
    const { store, wiki } = make(fakeCompletion('[]'));
    wiki.ensureLayout('default');
    wiki.applyOps(
      [{ op: 'create_page', kind: 'people', title: '王小明', aliases: ['小王'], tags: [], content: '室友' }],
      'default',
    );
    say(store, 3);
    const out = JSON.stringify([
      { op: 'upsert_section', page: 'user/profile.md', section: '近况', content: '在找工作' },
      { op: 'create_page', kind: 'people', title: '小王', aliases: [], content: '升职了' },
      { op: 'append_timeline', date: '2026-09-20', text: '我陪 ta 聊猫' },
    ]);
    const c = build(store, wiki, fakeCompletion(out), { now: () => t });
    await c.compileNow('s1');
    expect(store.opLogForPath('user/profile.md', 10)).toEqual([
      expect.objectContaining({
        at: 100,
        characterId: 'default',
        sessionId: 's1',
        msgFrom: 0,
        msgTo: 4,
        op: 'upsert_section',
        detail: '近况',
      }),
    ]);
    expect(store.opLogForPath('user/people/王小明.md', 10)[0]).toMatchObject({
      op: 'merge_page',
      detail: '小王',
    });
    expect(store.opLogForPath('characters/default/timeline.md', 10)[0]).toMatchObject({
      op: 'append_timeline',
      detail: '2026-09-20',
    });
    t = 200;
    const m = build(
      store,
      wiki,
      fakeCompletion('[{"op":"upsert_section","page":"user/profile.md","section":"身份","content":"学生"}]'),
      { now: () => t },
    );
    await m.compileFacts('default', ['用户是学生']);
    expect(store.opLogForPath('user/profile.md', 10)[0]).toMatchObject({
      at: 200,
      sessionId: null,
      msgFrom: null,
      detail: '身份',
    });
  });

  it('编译途中删消息（重试 / 编辑重发）作废本段：不推进水位，剩下的消息重新整理', async () => {
    const { store, wiki } = make(fakeCompletion('[]'));
    const ids = say(store, 3);
    const bodies: string[] = [];
    const fetchImpl = async (u: string, init?: RequestInit): Promise<Response> => {
      bodies.push(String(init?.body ?? ''));
      if (bodies.length === 1) {
        store.deleteMessagesFrom('default', 's1', ids[2]!);
        expect(store.compileStateGet('default', 's1')).toMatchObject({ upto: 0, pendingTo: null });
      }
      return fakeCompletion('[]')(u, init);
    };
    await build(store, wiki, fetchImpl).compileNow('s1');
    expect(bodies).toHaveLength(2); // 作废段不推进 → 幸存的 3 条重整一次
    expect(userOf(bodies[1]!)).not.toContain('话2');
    expect(store.compileStateGet('default', 's1')).toMatchObject({ upto: ids[1]!, pendingTo: null });
  });

  it('拼输入阶段抛错（如角色 id 非法）按暂时类记错误，不卡死、不计次', async () => {
    const { store, wiki } = make(fakeCompletion('[]'));
    const ids = say(store, 2, { cid: 'Bad', sid: 'x' });
    const c = build(store, wiki, fakeCompletion('[]'), { cid: () => 'Bad' });
    const r = await c.compileNow('x');
    expect(r.ok).toBe(false);
    expect(store.compileStateGet('Bad', 'x')).toMatchObject({ retries: 0, pendingTo: ids[1]! });
    expect(c.backlog('Bad', 'x')?.error).toMatch(/非法/);
  });
});

describe('㉔ 编译器相关页（spec §3.4）', () => {
  it('名字路（查询 = 本段对话）∪ 块混合映射回的页；块检索抛错只剩名字路', async () => {
    const calls = { n: 0, bodies: [] as string[] };
    const { store, wiki } = make(fakeCompletion('[]', calls));
    wiki.ensureLayout('default');
    wiki.applyOps(
      [
        { op: 'create_page', kind: 'topics', title: '爬山', aliases: [], tags: [], content: '香山' },
        { op: 'create_page', kind: 'people', title: '老张', aliases: [], tags: [], content: '驴友' },
        { op: 'create_page', kind: 'topics', title: '无关', aliases: [], tags: [], content: '别的' },
      ],
      'default',
    );
    say(store, 1, { text: '周末去爬山' });
    const probes: string[] = [];
    const mk = (related: (cid: string, probe: string) => Promise<string[]>) =>
      createMemoryCompiler({
        store,
        wiki,
        fetchImpl: fakeCompletion('[]', calls),
        getPrefs: () =>
          ({ 'privacy.longTermMemory': true, 'chat.activeSessions': {} }) as unknown as Prefs,
        resolveTarget: () => ({ apiBase: 'https://x/v1', model: 'gpt', key: 'k', adapter: 'openai' }),
        character: () => ({ id: 'default' }),
        relatedPaths: related,
      });
    await mk(async (_c, probe) => {
      probes.push(probe);
      return ['user/people/老张.md'];
    }).compileNow('s1');
    const user = userOf(calls.bodies.at(-1)!);
    expect(probes[0]).toContain('周末去爬山');
    expect(user).toContain('<<< user/topics/爬山.md'); // 名字路
    expect(user).toContain('<<< user/people/老张.md'); // 块路
    expect(user).not.toContain('<<< user/topics/无关.md');

    say(store, 1, { text: '又去爬山' });
    await mk(async () => {
      throw new Error('no embedding');
    }).compileNow('s1');
    const user2 = userOf(calls.bodies.at(-1)!);
    expect(user2).toContain('<<< user/topics/爬山.md');
    expect(user2).not.toContain('<<< user/people/老张.md');
  });
});
