// OneBot v11 正向 WS 客户端（连 NapCat/Lagrange）。
// 与 AstrBot aiocqhttp（反向 WS 服务端）同协议不同连法：桌面 App 不开监听端口；
// 重连照 mcp-manager #6 backoff——attempt 连续失败逐级退避、open 成功归零、走完序列
// gaveUp→error。全依赖注入（wsFactory/delay），单测零真网络。
import type { ImIncoming, ImPlatform, ImStatus } from '@openpet/protocol';
import type { ImAdapter, ImAdapterCallbacks, WsFactory, WsLike } from './adapter-types.js';

const BACKOFF = [1000, 2000, 4000, 8000, 16000];

interface Seg {
  type: string;
  data: Record<string, unknown>;
}
const SEG_PLACEHOLDER: Record<string, string> = {
  image: '[图片]',
  record: '[语音]',
  video: '[视频]',
  face: '[表情]',
  forward: '[合并转发]',
  json: '[卡片]',
  file: '[文件]',
};

export function createOnebotAdapter(
  platform: ImPlatform,
  cb: ImAdapterCallbacks,
  deps: { wsFactory?: WsFactory; delay?: (ms: number) => Promise<void>; now?: () => number } = {},
): ImAdapter {
  const wsFactory: WsFactory = deps.wsFactory ?? ((url) => new WebSocket(url) as unknown as WsLike);
  const delay = deps.delay ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  let ws: WsLike | null = null;
  let selfId = '';
  let stopped = false;
  let attempt = 0;
  let echoSeq = 0;
  const st: ImStatus = { platformId: platform.id, status: 'pending', errorCount: 0 };

  const setStatus = (s: ImStatus['status'], err?: string): void => {
    st.status = s;
    if (err !== undefined) {
      st.errorCount += 1;
      st.lastError = err;
    }
    cb.onStatus({ ...st });
  };

  const url = platform.accessToken
    ? `${platform.wsUrl}${platform.wsUrl.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(platform.accessToken)}`
    : platform.wsUrl;

  function normalize(ev: Record<string, unknown>): ImIncoming | null {
    if (ev['post_type'] !== 'message') return null;
    const kind = ev['message_type'] === 'group' ? 'group' : 'private';
    const raw = ev['message'];
    let text = '';
    let atMe = false;
    let replyToMe = false;
    if (Array.isArray(raw)) {
      for (const seg of raw as Seg[]) {
        if (seg.type === 'text') text += String(seg.data['text'] ?? '');
        else if (seg.type === 'at') {
          if (String(seg.data['qq']) === selfId || String(seg.data['qq']) === 'all') atMe = true;
        } else if (seg.type === 'reply') replyToMe = true; // 引用消息：宽松视作提及（拿不到被引者需再查）
        else text += (text && !text.endsWith(' ') ? ' ' : '') + (SEG_PLACEHOLDER[seg.type] ?? '');
      }
    } else if (typeof raw === 'string') {
      text = raw
        .replace(/\[CQ:at,qq=(\d+)[^\]]*\]/g, (_, qq: string) => {
          if (qq === selfId) atMe = true;
          return '';
        })
        .replace(/\[CQ:[^\]]+\]/g, '');
    }
    text = text.trim();
    if (!text) return null;
    const sender = (ev['sender'] ?? {}) as Record<string, unknown>;
    return {
      platformId: platform.id,
      kind,
      chatId: String(kind === 'group' ? ev['group_id'] : ev['user_id']),
      senderId: String(ev['user_id'] ?? ''),
      senderName: String(sender['card'] || sender['nickname'] || ev['user_id'] || ''),
      text,
      atMe,
      replyToMe,
      ts: Number(ev['time'] ?? 0) * 1000 || (deps.now ?? Date.now)(),
    };
  }

  function scheduleReconnect(): void {
    if (stopped) return;
    if (attempt >= BACKOFF.length) {
      setStatus('error', 'reconnect gave up');
      return;
    }
    const ms = BACKOFF[attempt]!;
    attempt += 1;
    setStatus('reconnecting');
    void delay(ms).then(() => {
      if (stopped) return;
      if (!connect()) scheduleReconnect();
    });
  }

  function connect(): boolean {
    try {
      ws = wsFactory(url);
    } catch (e) {
      setStatus('error', String(e));
      return false;
    }
    let opened = false;
    ws.addEventListener('open', () => {
      opened = true;
      attempt = 0;
      setStatus('running');
    });
    ws.addEventListener('message', (e) => {
      try {
        const ev = JSON.parse(String(e.data)) as Record<string, unknown>;
        if (ev['post_type'] === 'meta_event' && ev['self_id'] !== undefined)
          selfId = String(ev['self_id']);
        const msg = normalize(ev);
        if (msg) cb.onMessage(msg);
      } catch {
        /* 非 JSON 帧忽略 */
      }
    });
    ws.addEventListener('close', () => {
      ws = null;
      if (stopped) return;
      if (!opened) setStatus('error', 'connect failed');
      scheduleReconnect();
    });
    ws.addEventListener('error', () => {
      /* close 会跟着来，统一在 close 处理 */
    });
    return true;
  }

  return {
    start() {
      stopped = false;
      attempt = 0;
      connect();
    },
    async stop() {
      stopped = true;
      ws?.close();
      ws = null;
      setStatus('stopped');
    },
    async send(kind, chatId, text) {
      if (!ws) throw new Error(`onebot ${platform.id} not connected`);
      const idNum = Number(chatId);
      ws.send(
        JSON.stringify({
          action: kind === 'group' ? 'send_group_msg' : 'send_private_msg',
          params: {
            ...(kind === 'group' ? { group_id: idNum } : { user_id: idNum }),
            message: [{ type: 'text', data: { text } }],
          },
          echo: `ds-${(echoSeq += 1)}`,
        }),
      );
    },
    status: () => ({ ...st }),
  };
}
