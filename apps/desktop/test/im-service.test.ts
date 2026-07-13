// im-service 单测 —— fakeAdapter 注入，零真网络。
import { describe, it, expect, vi } from 'vitest';
import { createImService } from '../electron/main/im/im-service.js';
import { DEFAULT_PREFS, imOrigin } from '@openpet/protocol';
import type { ImIncoming } from '@openpet/protocol';

// 回发用平台（reload 后注册进 adapters；adapterFactory 拦截，不建真适配器）。
const P1 = {
  id: 'p1',
  type: 'telegram',
  name: 'P1',
  enable: true,
  wsUrl: '',
  accessToken: '',
  botToken: 't',
  apiBase: 'x',
} as const;

function harness(
  prefsOverride: Record<string, unknown> = {},
  opts: { imDelayMs?: (chars: number) => number } = {},
) {
  const sent: Array<{ kind: string; chatId: string; text: string }> = [];
  const chatCalls: Array<{ sessionId: string; text: string }> = [];
  const broadcasts: Array<{ ch: string; p: unknown }> = [];
  let resolveSend: (() => void) | null = null;
  const svc = createImService({
    getPrefs: () => ({ ...DEFAULT_PREFS, 'im.platforms': [P1], ...prefsOverride }) as never,
    chat: {
      send: (sessionId, text) => {
        chatCalls.push({ sessionId, text });
        return new Promise((r) => {
          resolveSend = () => r({ ok: true });
        });
      },
    },
    broadcast: (ch, p) => broadcasts.push({ ch, p }),
    ...(opts.imDelayMs ? { imDelayMs: opts.imDelayMs } : {}),
    adapterFactory: () => ({
      start: () => {},
      stop: async () => {},
      send: async (kind, chatId, text) => {
        sent.push({ kind, chatId, text });
      },
      status: () => ({ platformId: 'p1', status: 'running', errorCount: 0 }),
    }),
  });
  void svc.reload(); // 注册 P1 适配器（工厂假体，同步完成）
  const incoming = (over: Partial<ImIncoming>): ImIncoming => ({
    platformId: 'p1',
    kind: 'private',
    chatId: '42',
    senderId: '42',
    senderName: 'Ann',
    text: 'hi',
    atMe: false,
    replyToMe: false,
    ts: 1,
    ...over,
  });
  return { svc, sent, chatCalls, broadcasts, incoming, done: () => resolveSend?.() };
}

describe('im-service 唤醒/白名单', () => {
  it('私聊默认唤醒；群聊未 @ 不唤醒、@ 后唤醒', () => {
    const h = harness();
    h.svc.handleIncoming(h.incoming({}));
    expect(h.chatCalls.length).toBe(1);
    h.svc.handleIncoming(h.incoming({ kind: 'group', chatId: 'g1', text: '大家好' }));
    expect(h.chatCalls.length).toBe(1); // 未唤醒
    h.svc.handleIncoming(h.incoming({ kind: 'group', chatId: 'g1', text: '在吗', atMe: true }));
    expect(h.chatCalls.length).toBe(2);
    expect(h.chatCalls[1]).toMatchObject({
      sessionId: imOrigin('p1', 'group', 'g1'),
      text: 'Ann：在吗',
    });
  });
  it('wakePrefix 命中剥前缀；friendNeedsWake 开启后私聊无前缀不醒', () => {
    const h = harness({ 'im.wakePrefixes': ['/'], 'im.friendNeedsWake': true });
    h.svc.handleIncoming(h.incoming({ text: '你好' }));
    expect(h.chatCalls.length).toBe(0);
    h.svc.handleIncoming(h.incoming({ text: '/你好' }));
    expect(h.chatCalls[0]!.text).toBe('你好');
  });
  it('白名单开启：不在名单静默拦截，chatId 命中放行', () => {
    const h = harness({ 'im.whitelistEnabled': true, 'im.whitelist': ['42'] });
    h.svc.handleIncoming(h.incoming({ chatId: '99', senderId: '99' }));
    expect(h.chatCalls.length).toBe(0);
    h.svc.handleIncoming(h.incoming({}));
    expect(h.chatCalls.length).toBe(1);
  });
  it('admin 私聊豁免白名单；群聊仍按名单', () => {
    const h = harness({
      'im.whitelistEnabled': true,
      'im.whitelist': ['someoneelse'],
      'im.admins': ['42'],
    });
    h.svc.handleIncoming(h.incoming({}));
    expect(h.chatCalls.length).toBe(1);
    h.svc.handleIncoming(h.incoming({ kind: 'group', chatId: 'g9', atMe: true }));
    expect(h.chatCalls.length).toBe(1); // 群聊不豁免
  });
});

describe('im-service 回复捕获/串行化/到桌提示', () => {
  it('chat.stream 累积 + done(stop) 整段回发；done 后队列放行下一条', async () => {
    const h = harness();
    h.svc.handleIncoming(h.incoming({}));
    h.svc.handleIncoming(h.incoming({ text: '第二句' })); // 在途 → 入队
    expect(h.chatCalls.length).toBe(1);
    const sid = imOrigin('p1', 'private', '42');
    h.svc.handleNotify('chat.stream', { sessionId: sid, text: '你好' });
    h.svc.handleNotify('chat.stream', { sessionId: sid, text: '呀' });
    h.done();
    h.svc.handleNotify('chat.done', { sessionId: sid, finishReason: 'stop' });
    await vi.waitFor(() =>
      expect(h.sent).toEqual([{ kind: 'private', chatId: '42', text: '你好呀' }]),
    );
    await vi.waitFor(() => expect(h.chatCalls.length).toBe(2)); // 队列放行
  });
  it('done(error) 静默不回发，但队列照常放行', async () => {
    const h = harness();
    h.svc.handleIncoming(h.incoming({}));
    const sid = imOrigin('p1', 'private', '42');
    h.svc.handleNotify('chat.stream', { sessionId: sid, text: '半截' });
    h.done();
    h.svc.handleNotify('chat.done', { sessionId: sid, finishReason: 'error' });
    h.svc.handleIncoming(h.incoming({ text: '再来' }));
    await vi.waitFor(() => expect(h.chatCalls.length).toBe(2));
    expect(h.sent).toEqual([]);
  });
  it('队列容量 3：溢出丢弃', () => {
    const h = harness();
    for (let i = 0; i < 6; i += 1) h.svc.handleIncoming(h.incoming({ text: `m${i}` }));
    // 1 条在途 + 队列 3 条，第 5/6 条丢弃
    expect(h.chatCalls.length).toBe(1);
    const sid = imOrigin('p1', 'private', '42');
    for (let i = 0; i < 5; i += 1) {
      h.done();
      h.svc.handleNotify('chat.done', { sessionId: sid, finishReason: 'stop' });
    }
    expect(h.chatCalls.length).toBe(4);
  });
  it('handleNotify 只认领 im: 会话的 chat.*；default 会话与非 chat 通道不吞', () => {
    const h = harness();
    expect(h.svc.handleNotify('chat.stream', { sessionId: 'default', text: 'x' })).toBe(false);
    expect(h.svc.handleNotify('trace.record', { sessionId: imOrigin('p1', 'private', '1') })).toBe(
      false,
    );
    expect(
      h.svc.handleNotify('chat.reasoning', { sessionId: imOrigin('p1', 'private', '1'), text: 'r' }),
    ).toBe(true);
  });
  it('唤醒消息广播 im.activity；notifyDesktop 关则不广播', () => {
    const h = harness();
    h.svc.handleIncoming(h.incoming({}));
    expect(h.broadcasts.some((b) => b.ch === 'im.activity')).toBe(true);
    const h2 = harness({ 'im.notifyDesktop': false });
    h2.svc.handleIncoming(h2.incoming({}));
    expect(h2.broadcasts.some((b) => b.ch === 'im.activity')).toBe(false);
  });
  it('⑭ 自然节奏开：newBubble 分段多条回发且段间延迟，全发完才放行队列', async () => {
    const h = harness({}, { imDelayMs: () => 30 });
    h.svc.handleIncoming(h.incoming({}));
    h.svc.handleIncoming(h.incoming({ text: '排队消息' })); // 在途 → 入队
    const sid = imOrigin('p1', 'private', '42');
    h.svc.handleNotify('chat.stream', { sessionId: sid, text: '第一段。' });
    h.svc.handleNotify('chat.stream', { sessionId: sid, text: '第二段。', newBubble: true });
    h.done();
    h.svc.handleNotify('chat.done', { sessionId: sid, finishReason: 'stop' });
    // 第一段立发；第二段 30ms 延迟中；busy 未解 → 排队消息不 dispatch
    expect(h.sent).toEqual([{ kind: 'private', chatId: '42', text: '第一段。' }]);
    expect(h.chatCalls.length).toBe(1);
    await vi.waitFor(() =>
      expect(h.sent).toEqual([
        { kind: 'private', chatId: '42', text: '第一段。' },
        { kind: 'private', chatId: '42', text: '第二段。' },
      ]),
    );
    await vi.waitFor(() => expect(h.chatCalls.length).toBe(2)); // 全发完才放行
  });
  it('⑭ 自然节奏关：newBubble 段 join 单条回发', async () => {
    const h = harness({ 'chat.naturalRhythm': false });
    h.svc.handleIncoming(h.incoming({}));
    const sid = imOrigin('p1', 'private', '42');
    h.svc.handleNotify('chat.stream', { sessionId: sid, text: '第一段。' });
    h.svc.handleNotify('chat.stream', { sessionId: sid, text: '第二段。', newBubble: true });
    h.done();
    h.svc.handleNotify('chat.done', { sessionId: sid, finishReason: 'stop' });
    await vi.waitFor(() =>
      expect(h.sent).toEqual([{ kind: 'private', chatId: '42', text: '第一段。\n第二段。' }]),
    );
  });
  it('shouldExtractMemory：私聊 true，群聊默认 false、开关放开 true', () => {
    const h = harness();
    expect(h.svc.shouldExtractMemory(imOrigin('p1', 'private', '1'))).toBe(true);
    expect(h.svc.shouldExtractMemory(imOrigin('p1', 'group', '1'))).toBe(false);
    expect(h.svc.shouldExtractMemory('default')).toBe(true);
    const h2 = harness({ 'im.groupIntoMemory': true });
    expect(h2.svc.shouldExtractMemory(imOrigin('p1', 'group', '1'))).toBe(true);
  });
  it('reload 只起 enable 平台；dispose 全停', async () => {
    const started: string[] = [];
    const stopped: string[] = [];
    const svc = createImService({
      getPrefs: () =>
        ({
          ...DEFAULT_PREFS,
          'im.platforms': [P1, { ...P1, id: 'p2', enable: false }],
        }) as never,
      chat: { send: async () => ({ ok: true as const }) },
      broadcast: () => {},
      adapterFactory: (p) => ({
        start: () => started.push(p.id),
        stop: async () => {
          stopped.push(p.id);
        },
        send: async () => {},
        status: () => ({ platformId: p.id, status: 'running', errorCount: 0 }),
      }),
    });
    await svc.reload();
    expect(started).toEqual(['p1']);
    await svc.dispose();
    expect(stopped).toEqual(['p1']);
  });
});
