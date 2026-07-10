import { describe, it, expect, vi } from 'vitest';
import { createTelegramAdapter } from '../electron/main/im/telegram-adapter.js';

const PLATFORM = {
  id: 'tg1',
  type: 'telegram',
  name: 'TG',
  enable: true,
  wsUrl: '',
  accessToken: '',
  botToken: 'TOK',
  apiBase: 'https://api.telegram.org',
} as const;

function fetchScript(script: Array<{ match: string; body: unknown }>) {
  const calls: string[] = [];
  const fetchImpl = vi.fn(async (url: string, init?: { body?: string }) => {
    calls.push(url + (init?.body ?? ''));
    const hit = script.find((s) => url.includes(s.match));
    return { ok: true, json: async () => hit?.body ?? { ok: true, result: [] } } as never;
  });
  return { fetchImpl, calls };
}

describe('telegram-adapter', () => {
  it('getMe 后轮询 getUpdates，私聊归一化 + @提及判 atMe', async () => {
    const { fetchImpl } = fetchScript([
      { match: '/getMe', body: { ok: true, result: { id: 7, username: 'dsbot' } } },
      {
        match: '/getUpdates',
        body: {
          ok: true,
          result: [
            {
              update_id: 1,
              message: {
                message_id: 1,
                date: 2,
                text: 'hi',
                chat: { id: 42, type: 'private' },
                from: { id: 42, first_name: 'Ann' },
              },
            },
            {
              update_id: 2,
              message: {
                message_id: 2,
                date: 3,
                text: '@dsbot 在吗',
                chat: { id: -100, type: 'supergroup' },
                from: { id: 42, first_name: 'Ann' },
              },
            },
          ],
        },
      },
    ]);
    const got: unknown[] = [];
    const a = createTelegramAdapter(
      PLATFORM as never,
      { onMessage: (m) => got.push(m), onStatus: () => {} },
      { fetchImpl: fetchImpl as never, delay: () => Promise.resolve(), maxLoops: 1 },
    );
    a.start();
    await vi.waitFor(() => expect(got.length).toBe(2));
    expect(got[0]).toMatchObject({
      kind: 'private',
      chatId: '42',
      senderName: 'Ann',
      text: 'hi',
      atMe: false,
    });
    expect(got[1]).toMatchObject({ kind: 'group', chatId: '-100', atMe: true, text: '在吗' });
    await a.stop();
  });
  it('send 调 sendMessage 且 offset 随 update_id 递推', async () => {
    const { fetchImpl, calls } = fetchScript([
      { match: '/getMe', body: { ok: true, result: { id: 7, username: 'dsbot' } } },
      {
        match: '/getUpdates',
        body: {
          ok: true,
          result: [
            {
              update_id: 9,
              message: {
                message_id: 1,
                date: 2,
                text: 'x',
                chat: { id: 1, type: 'private' },
                from: { id: 1 },
              },
            },
          ],
        },
      },
    ]);
    const a = createTelegramAdapter(
      PLATFORM as never,
      { onMessage: () => {}, onStatus: () => {} },
      { fetchImpl: fetchImpl as never, delay: () => Promise.resolve(), maxLoops: 2 },
    );
    a.start();
    await a.send('private', '42', 'hello');
    expect(
      calls.some(
        (c) => c.includes('/sendMessage') && c.includes('"chat_id":"42"') && c.includes('"text":"hello"'),
      ),
    ).toBe(true);
    await vi.waitFor(() =>
      expect(calls.filter((c) => c.includes('offset=10')).length).toBeGreaterThanOrEqual(1),
    );
    await a.stop();
  });
});
