// Telegram Bot API 长轮询适配器（apiBase 可指自建代理网关——国内网络现实）。
// getMe 缓存 bot id/username（@提及与 reply 判定）；getUpdates offset 递推；发送 sendMessage。
// fetch/delay 依赖注入，单测零真网络（maxLoops 限轮数）。
import type { ImIncoming, ImPlatform, ImStatus } from '@openpet/protocol';
import type { ImAdapter, ImAdapterCallbacks } from './adapter-types.js';

type FetchLike = (
  url: string,
  init?: RequestInit,
) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

export function createTelegramAdapter(
  platform: ImPlatform,
  cb: ImAdapterCallbacks,
  deps: { fetchImpl?: FetchLike; delay?: (ms: number) => Promise<void>; maxLoops?: number } = {},
): ImAdapter {
  const f: FetchLike = deps.fetchImpl ?? (fetch as unknown as FetchLike);
  const delay = deps.delay ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const api = (method: string): string => `${platform.apiBase}/bot${platform.botToken}/${method}`;
  let running = false;
  let offset = 0;
  let botId = '';
  let botUsername = '';
  const st: ImStatus = { platformId: platform.id, status: 'pending', errorCount: 0 };
  const setStatus = (s: ImStatus['status'], err?: string): void => {
    st.status = s;
    if (err !== undefined) {
      st.errorCount += 1;
      st.lastError = err;
    }
    cb.onStatus({ ...st });
  };

  function normalize(m: Record<string, unknown>): ImIncoming | null {
    const chat = m['chat'] as Record<string, unknown> | undefined;
    let text = typeof m['text'] === 'string' ? m['text'] : '';
    if (!chat || !text) return null;
    const kind = chat['type'] === 'private' ? 'private' : 'group';
    let atMe = false;
    if (botUsername && text.includes(`@${botUsername}`)) {
      atMe = true;
      text = text.replaceAll(`@${botUsername}`, '').trim();
    }
    const reply = m['reply_to_message'] as Record<string, unknown> | undefined;
    const replyToMe = String((reply?.['from'] as Record<string, unknown>)?.['id'] ?? '') === botId;
    const from = (m['from'] ?? {}) as Record<string, unknown>;
    return {
      platformId: platform.id,
      kind,
      chatId: String(chat['id']),
      senderId: String(from['id'] ?? ''),
      senderName: String(from['first_name'] || from['username'] || from['id'] || ''),
      text: text.trim(),
      atMe,
      replyToMe,
      ts: Number(m['date'] ?? 0) * 1000,
    };
  }

  async function loop(): Promise<void> {
    let loops = 0;
    try {
      const me = (await (await f(api('getMe'))).json()) as {
        ok: boolean;
        result?: { id: number; username?: string };
      };
      if (me.ok && me.result) {
        botId = String(me.result.id);
        botUsername = me.result.username ?? '';
      }
      setStatus('running');
    } catch (e) {
      setStatus('error', `getMe failed: ${String(e)}`);
    }
    while (running && (deps.maxLoops === undefined || loops < deps.maxLoops)) {
      loops += 1;
      try {
        const res = (await (await f(api(`getUpdates?timeout=30&offset=${offset}`))).json()) as {
          ok: boolean;
          result?: Array<{ update_id: number; message?: Record<string, unknown> }>;
        };
        for (const u of res.result ?? []) {
          offset = Math.max(offset, u.update_id + 1);
          if (!u.message) continue;
          const msg = normalize(u.message);
          if (msg && msg.text) cb.onMessage(msg);
        }
        if (st.status !== 'running') setStatus('running');
      } catch (e) {
        setStatus('reconnecting', String(e));
        await delay(3000);
      }
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      void loop();
    },
    async stop() {
      running = false;
      setStatus('stopped');
    },
    async send(_kind, chatId, text) {
      const res = await f(api('sendMessage'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text }),
      });
      if (!res.ok) throw new Error('sendMessage failed');
    },
    status: () => ({ ...st }),
  };
}
