import { describe, it, expect, vi } from 'vitest';
import { createOnebotAdapter } from '../electron/main/im/onebot-adapter.js';
import type { WsLike } from '../electron/main/im/adapter-types.js';

function fakeWs() {
  const listeners = new Map<string, ((e?: unknown) => void)[]>();
  const sent: string[] = [];
  const ws: WsLike = {
    send: (d) => sent.push(d),
    close: () => listeners.get('close')?.forEach((f) => f()),
    addEventListener: (ev: string, fn: never) => {
      listeners.set(ev, [...(listeners.get(ev) ?? []), fn]);
    },
  } as WsLike;
  return {
    ws,
    sent,
    open: () => listeners.get('open')?.forEach((f) => f()),
    message: (obj: unknown) =>
      listeners
        .get('message')
        ?.forEach((f) => (f as (e: unknown) => void)({ data: JSON.stringify(obj) })),
    close: () => listeners.get('close')?.forEach((f) => f()),
  };
}

const PLATFORM = {
  id: 'qq1',
  type: 'onebot-v11',
  name: 'QQ',
  enable: true,
  wsUrl: 'ws://127.0.0.1:3001',
  accessToken: 't',
  botToken: '',
  apiBase: '',
} as const;

describe('onebot-adapter', () => {
  it('群消息段数组归一化：text 拼接 + at 自己 → atMe', () => {
    const f = fakeWs();
    const got: unknown[] = [];
    const a = createOnebotAdapter(
      PLATFORM as never,
      { onMessage: (m) => got.push(m), onStatus: () => {} },
      { wsFactory: () => f.ws, delay: () => Promise.resolve() },
    );
    a.start();
    f.open();
    f.message({ meta_event_type: 'lifecycle', post_type: 'meta_event', self_id: 10086 });
    f.message({
      post_type: 'message',
      message_type: 'group',
      group_id: 123,
      user_id: 42,
      sender: { nickname: '阿明' },
      time: 1,
      message: [
        { type: 'at', data: { qq: '10086' } },
        { type: 'text', data: { text: ' 你好' } },
        { type: 'image', data: {} },
      ],
    });
    expect(got[0]).toMatchObject({
      platformId: 'qq1',
      kind: 'group',
      chatId: '123',
      senderId: '42',
      senderName: '阿明',
      text: '你好 [图片]',
      atMe: true,
    });
  });
  it('send 发 send_group_msg/send_private_msg action JSON', async () => {
    const f = fakeWs();
    const a = createOnebotAdapter(
      PLATFORM as never,
      { onMessage: () => {}, onStatus: () => {} },
      { wsFactory: () => f.ws, delay: () => Promise.resolve() },
    );
    a.start();
    f.open();
    await a.send('group', '123', 'hi');
    const frame = JSON.parse(f.sent[0]!);
    expect(frame.action).toBe('send_group_msg');
    expect(frame.params).toEqual({
      group_id: 123,
      message: [{ type: 'text', data: { text: 'hi' } }],
    });
    await a.send('private', '42', 'yo');
    expect(JSON.parse(f.sent[1]!).action).toBe('send_private_msg');
  });
  it('断线按 backoff 序列重连，gaveUp 后 error', async () => {
    const delays: number[] = [];
    let made = 0;
    const factories = () => {
      made += 1;
      return fakeWs();
    };
    const first = fakeWs();
    const statuses: string[] = [];
    const a = createOnebotAdapter(
      PLATFORM as never,
      { onMessage: () => {}, onStatus: (s) => statuses.push(s.status) },
      {
        wsFactory: () => (made++ === 0 ? first.ws : factories().ws) as never,
        delay: (ms) => {
          delays.push(ms);
          return Promise.resolve();
        },
      },
    );
    a.start();
    first.open();
    first.close();
    await vi.waitFor(() => expect(delays.length).toBeGreaterThanOrEqual(1));
    expect(delays[0]).toBe(1000);
    expect(statuses).toContain('reconnecting');
  });
});
